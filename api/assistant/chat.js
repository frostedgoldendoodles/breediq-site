// BreedIQ Assistant — unified chat endpoint
// Streams NDJSON of { text_delta | tool_use | tool_result | done | error }
// to the frontend. Loops the model ↔ tool executor up to MAX_TOOL_TURNS
// times, then emits a `done` event with token usage.
//
// Request body:
// {
//   messages: [{ role: 'user' | 'assistant', content: string | ContentBlock[] }, ...],
//   page_context: { page, entity_id?, entity_snapshot? },
//   confirm_delete?: boolean
// }
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, getServiceClient } from '../../lib/supabase.js';
import { SYSTEM_PROMPT, formatPageContext } from '../../lib/assistant/system-prompt.js';
import { TOOL_SCHEMAS, DESTRUCTIVE_TOOLS, executeTool } from '../../lib/assistant/tools.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_TURNS = 10;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = await requireAuth(req, res);
    if (!auth) return;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const userId = auth.user.id;
    const supabase = getServiceClient();

    const { messages = [], page_context = {}, confirm_delete = false } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages[] is required' });
    }

    // Normalize user messages into Anthropic content block shape.
    // Accept strings (convert to text blocks) or arrays (pass through).
    const normalizedMessages = messages.map(m => {
        if (typeof m.content === 'string') {
            return { role: m.role, content: [{ type: 'text', text: m.content }] };
        }
        return { role: m.role, content: m.content };
    });

    // Determine if thinking should be enabled — longer user input benefits from it
    const lastUser = [...normalizedMessages].reverse().find(m => m.role === 'user');
    let userLen = 0;
    if (lastUser) {
        for (const b of (lastUser.content || [])) {
            if (b.type === 'text') userLen += (b.text || '').length;
        }
    }
    const enableThinking = userLen > 1500;

    // Prepare NDJSON stream
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

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

    emit({ type: 'start', model: MODEL, thinking: enableThinking });

    try {
        while (turns < MAX_TOOL_TURNS) {
            turns++;

            const requestParams = {
                model: MODEL,
                max_tokens: 4096,
                system: systemBlocks,
                tools: TOOL_SCHEMAS,
                messages: conversation
            };
            if (enableThinking) requestParams.thinking = { type: 'adaptive' };

            const stream = client.messages.stream(requestParams);

            // Track incremental tool use input (partial_json) and assistant text
            const toolUsesByIndex = {};
            const textByIndex = {};

            stream.on('streamEvent', (event) => {
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
                const effectiveConfirm = confirm_delete === true || tb.input?.confirm_delete === true;

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
                    resultText = `Not executed: this ${tb.name} requires user confirmation first. Tell the user what will be deleted and wait for them to say "confirm".`;
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
        emit({ type: 'error', error: err.message || 'Unknown error' });
        try { res.end(); } catch {}
    }
}
