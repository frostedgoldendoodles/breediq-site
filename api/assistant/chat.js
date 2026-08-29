// BreedIQ Assistant — unified chat endpoint
// Streams NDJSON of { text_delta | tool_use | tool_result | done | error }
// to the frontend. Loops the model ↔ tool executor up to MAX_TOOL_TURNS
// times, then emits a `done` event with token usage.
//
// Request body:
// {
//   messages: [{ role: 'user' | 'assistant', content: string | ContentBlock[] }, ...],
//   page_context: { page, entity_id?, entity_snapshot? },
//   confirm?: { tool_name: string, target_id: string }
// }
//
// `confirm` is the human-in-the-loop signal for destructive tools. It is set
// only by the client's Confirm button, from the target the server itself
// returned on the preceding `requires_confirmation` result, and it must name
// both the tool and that exact record. The model has no way to produce it:
// confirm_delete is not in any tool schema and tool input is never consulted.
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, getServiceClient } from '../../lib/supabase.js';
import { enforce, LIMITS } from '../../lib/rate-limit.js';
import { SYSTEM_PROMPT, formatPageContext } from '../../lib/assistant/system-prompt.js';
import { TOOL_SCHEMAS, DESTRUCTIVE_TOOLS, executeTool, isDestructiveCallConfirmed } from '../../lib/assistant/tools.js';

// Opus 5 — Anthropic's top generally-available model. The assistant is the
// product's flagship feature, so it runs the flagship model. Thinking is on
// by default (adaptive) on Opus 5; do NOT send a `thinking` param — explicit
// configs are restricted on this model family. Depth is controlled with
// output_config.effort instead. If API spend ever needs trimming, the
// step-down is claude-sonnet-5 ($2/$10 per MTok vs $5/$25) — one line here.
const MODEL = 'claude-opus-5';
const EFFORT = 'high';
// Refusal fallbacks: if a safety classifier declines a request, the API
// re-runs it on a fallback model inside the same call instead of surfacing
// a refusal to the breeder. Exact header + scalar form per current API docs.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_TOOL_TURNS = 10;
// Soft time budget — must stay comfortably under vercel.json's maxDuration
// for this function (120s) so we can close the stream cleanly before Vercel
// kills the process. A killed process produces FUNCTION_INVOCATION_FAILED
// for the client; this budget lets us emit a graceful timeout event instead.
const SOFT_TIME_BUDGET_MS = 100_000;

// Request-shape ceilings. `messages` is whatever the client posts and every
// token of it is billed to us on each of up to MAX_TOOL_TURNS calls, so an
// unbounded body is an unmetered charge on the Anthropic account — reachable
// by any signed-in user, including a free-tier one.
const MAX_MESSAGES = 60;
const MAX_TOTAL_CHARS = 200_000;   // ~50k tokens of conversation
const MAX_BLOCKS_PER_MESSAGE = 40;

// Rough size of a normalized conversation, counting only what we can measure
// cheaply. Non-text blocks (images) are charged their base64 length.
function conversationChars(messages) {
    let n = 0;
    for (const m of messages) {
        const blocks = Array.isArray(m.content) ? m.content : [];
        for (const b of blocks) {
            if (typeof b?.text === 'string') n += b.text.length;
            else if (typeof b?.content === 'string') n += b.content.length;
            else if (typeof b?.source?.data === 'string') n += b.source.data.length;
            else n += 200; // structural block — nominal charge
        }
    }
    return n;
}

export default async function handler(req, res) {
    // Top-level guard: every code path below is wrapped so any unexpected
    // throw (request-body parse error, SDK init failure, etc.) gets logged
    // with full context and returned as a structured JSON 500 instead of
    // Vercel's FUNCTION_INVOCATION_FAILED HTML page.
    let userId = null;
    let messageCount = 0;
    let headersSent = false;

    try {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const auth = await requireAuth(req, res);
        if (!auth) return;
        userId = auth.user.id;

        if (enforce(req, res, { name: 'assistant', userId, ...LIMITS.assistant })) return;

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
        }

        const supabase = getServiceClient();

        const { messages = [], page_context = {}, confirm = null } = req.body || {};
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'messages[] is required' });
        }
        if (messages.length > MAX_MESSAGES) {
            return res.status(413).json({ error: `Conversation too long (max ${MAX_MESSAGES} messages). Start a new chat.` });
        }
        if (messages.some(m => Array.isArray(m.content) && m.content.length > MAX_BLOCKS_PER_MESSAGE)) {
            return res.status(413).json({ error: 'Message has too many content blocks.' });
        }
        messageCount = messages.length;

        // Normalize user messages into Anthropic content block shape.
        // Accept strings (convert to text blocks) or arrays (pass through).
        const normalizedMessages = messages.map(m => {
            if (typeof m.content === 'string') {
                return { role: m.role, content: [{ type: 'text', text: m.content }] };
            }
            return { role: m.role, content: m.content };
        });

        const totalChars = conversationChars(normalizedMessages);
        if (totalChars > MAX_TOTAL_CHARS) {
            return res.status(413).json({ error: 'Conversation is too large to process. Start a new chat.' });
        }

        // Prepare NDJSON stream
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        headersSent = true;

    const emit = (obj) => {
        try { res.write(JSON.stringify(obj) + '\n'); }
        catch (e) { console.error('[assistant] stream write failed', e.message); }
    };

    // Build system prompt: static core (cacheable) + dynamic page context (cacheable per-convo)
    const systemBlocks = [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: formatPageContext(page_context), cache_control: { type: 'ephemeral' } }
    ];

    const client = new Anthropic({ apiKey });

    // Conversation state (mutated during the agent loop)
    const conversation = [...normalizedMessages];
    let totalUsage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
    const toolsUsed = [];
    let turns = 0;
    let stopReason = null;
    const startedAt = Date.now();

    emit({ type: 'start', model: MODEL, thinking: true });

    try {
        while (turns < MAX_TOOL_TURNS) {
            // Soft time-budget guard. If we're close to the Vercel maxDuration,
            // stop the loop, tell the user, and close cleanly. Beats getting
            // killed mid-turn (which produces FUNCTION_INVOCATION_FAILED).
            const elapsed = Date.now() - startedAt;
            if (elapsed > SOFT_TIME_BUDGET_MS) {
                console.warn('[assistant] soft time budget exceeded', { elapsed_ms: elapsed, turns, user_id: userId });
                emit({
                    type: 'error',
                    error: "That request is taking longer than expected on my end. Try simplifying it, or break it into smaller steps and tap Retry.",
                    reason: 'time_budget'
                });
                stopReason = 'time_budget';
                break;
            }
            turns++;

            const requestParams = {
                model: MODEL,
                max_tokens: 4096,
                betas: [FALLBACK_BETA],
                fallbacks: 'default',
                output_config: { effort: EFFORT },
                system: systemBlocks,
                tools: TOOL_SCHEMAS,
                messages: conversation,
                // Top-level cache_control auto-caches the last cacheable block,
                // i.e. the conversation tail. In a tool loop the whole prior
                // conversation is re-sent every iteration; without this each
                // turn re-bills it all at full input price. With it, turns 2+
                // read the prefix from cache (~10% of the cost, much faster).
                cache_control: { type: 'ephemeral' }
            };

            const stream = client.beta.messages.stream(requestParams);

            // Track incremental tool use input (partial_json) and assistant text
            const toolUsesByIndex = {};
            const textByIndex = {};

            stream.on('streamEvent', (event) => {
                // Defensive: any throw from inside the SDK's event dispatch
                // (bad partial_json, etc.) would otherwise become an uncaught
                // promise rejection at the worker level and crash the function
                // with FUNCTION_INVOCATION_FAILED. Swallow + log here.
                try {
                    if (event.type === 'content_block_start') {
                        if (event.content_block?.type === 'tool_use') {
                            toolUsesByIndex[event.index] = {
                                id: event.content_block.id,
                                name: event.content_block.name,
                                input: ''
                            };
                            emit({ type: 'tool_use_start', tool_use_id: event.content_block.id, tool_name: event.content_block.name });
                        } else if (event.content_block?.type === 'text') {
                            textByIndex[event.index] = '';
                        } else if (event.content_block?.type === 'thinking') {
                            emit({ type: 'thinking_start' });
                        }
                    } else if (event.type === 'content_block_delta') {
                        if (event.delta?.type === 'text_delta') {
                            const txt = event.delta.text || '';
                            if (textByIndex[event.index] !== undefined) textByIndex[event.index] += txt;
                            emit({ type: 'text_delta', text: txt });
                        } else if (event.delta?.type === 'input_json_delta') {
                            const tu = toolUsesByIndex[event.index];
                            if (tu) tu.input += event.delta.partial_json || '';
                        }
                    } else if (event.type === 'content_block_stop') {
                        const tu = toolUsesByIndex[event.index];
                        if (tu) {
                            let parsedInput = {};
                            try { parsedInput = tu.input ? JSON.parse(tu.input) : {}; }
                            catch (e) { console.error(`[assistant] bad tool JSON for ${tu.name}:`, tu.input); }
                            tu.parsedInput = parsedInput;
                            emit({ type: 'tool_use', tool_use_id: tu.id, tool_name: tu.name, input: parsedInput });
                        }
                    }
                } catch (handlerErr) {
                    console.error('[assistant] streamEvent handler threw', {
                        event_type: event?.type,
                        message: handlerErr?.message,
                        stack: handlerErr?.stack
                    });
                }
            });

            const finalMessage = await stream.finalMessage();
            stopReason = finalMessage.stop_reason;

            // Aggregate usage
            const u = finalMessage.usage || {};
            totalUsage.input_tokens += u.input_tokens || 0;
            totalUsage.output_tokens += u.output_tokens || 0;
            totalUsage.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
            totalUsage.cache_read_input_tokens += u.cache_read_input_tokens || 0;

            // Push assistant turn into history verbatim (content blocks from the API)
            conversation.push({ role: 'assistant', content: finalMessage.content });

            // If the model stopped for reasons other than tool_use, we're done
            if (stopReason !== 'tool_use') break;

            // Gather tool_use blocks from this turn and execute each
            const toolBlocks = finalMessage.content.filter(b => b.type === 'tool_use');
            const toolResultsContent = [];

            for (const tb of toolBlocks) {
                toolsUsed.push(tb.name);
                const isDestructive = DESTRUCTIVE_TOOLS.has(tb.name);

                // A destructive call executes only when the client confirmed
                // this exact tool against this exact record. Anything else —
                // including the model asking nicely — gets the proposal path.
                const effectiveConfirm = isDestructiveCallConfirmed(confirm, tb.name, tb.input);

                const result = await executeTool(tb.name, {
                    user_id: userId,
                    supabase,
                    input: tb.input || {},
                    confirm_delete: effectiveConfirm
                });

                // Emit a wire-compact result so the frontend can render it
                emit({
                    type: 'tool_result',
                    tool_use_id: tb.id,
                    tool_name: tb.name,
                    ok: !!result.ok,
                    requires_confirmation: result.requires_confirmation === true,
                    result: result.ok ? result.result : undefined,
                    error: result.ok ? undefined : result.error,
                    target: result.target,
                    destructive: isDestructive
                });

                // Build content to pass back to the model
                let resultText;
                if (result.ok) {
                    resultText = JSON.stringify(result.result || {});
                } else if (result.requires_confirmation) {
                    const targetId = result.target?.id || null;
                    resultText = `Not executed. ${tb.name} is destructive and needs the user to approve it in the UI; `
                        + `the approval is a signal only they can send, so repeating the call will not delete anything. `
                        + `Describe exactly what would be deleted${targetId ? ` (id ${targetId})` : ''} and wait. `
                        + `If they approve, call ${tb.name} once more with id "${targetId || '<the id above>'}".`;
                } else {
                    resultText = `Error: ${result.error || 'Unknown'}`;
                }

                toolResultsContent.push({
                    type: 'tool_result',
                    tool_use_id: tb.id,
                    content: resultText,
                    is_error: !result.ok
                });
            }

            // Feed tool results back as the next user turn and loop
            conversation.push({ role: 'user', content: toolResultsContent });
        }

        // Opus-family models can end a turn with stop_reason 'refusal' (a
        // safety classifier declined). fallbacks:'default' reroutes most of
        // these server-side; if the whole chain declined, say so plainly
        // instead of ending on a blank bubble.
        if (stopReason === 'refusal') {
            emit({ type: 'text_delta', text: "I can't help with that request. If this seems wrong, try rephrasing it." });
        }

        emit({
            type: 'done',
            stop_reason: stopReason,
            turns,
            tools_used: toolsUsed,
            usage: totalUsage
        });

        // One-line telemetry
        console.log(JSON.stringify({
            tag: 'assistant_turn',
            user_id: userId,
            model: MODEL,
            turns,
            tools_used: toolsUsed,
            stop_reason: stopReason,
            usage: totalUsage,
            page: page_context?.page
        }));

        res.end();
    } catch (err) {
        console.error('[assistant] stream error', err);
        emit({ type: 'error', error: 'Something went wrong on my end. Tap Retry.' });
        try { res.end(); } catch {}
    }

    } catch (outerErr) {
        // Outer guard: anything that escapes both the streaming try/catch
        // AND the pre-stream code path lands here. Most importantly, this
        // captures errors that happen BEFORE the response headers are sent
        // (e.g. SDK init, body parse, requireAuth crashes) so the client
        // sees a clean JSON 500 instead of Vercel's HTML wrapper.
        console.error('[assistant] handler outer error', {
            message: outerErr?.message,
            name: outerErr?.name,
            stack: outerErr?.stack,
            user_id: userId,
            message_count: messageCount,
            headers_sent: headersSent
        });
        if (!headersSent && !res.headersSent) {
            try {
                res.status(500).json({ error: 'Server error' });
            } catch { /* response may already be closed */ }
        } else {
            // Headers already streamed — try to emit a final NDJSON error event.
            try { res.write(JSON.stringify({ type: 'error', error: 'Server error' }) + '\n'); } catch {}
            try { res.end(); } catch {}
        }
    }
}
