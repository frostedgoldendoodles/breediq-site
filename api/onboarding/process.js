// BreedIQ Onboarding — AI Processing with Tool Use + Streaming
// Uses Claude Sonnet 4.6 with tool use and extended thinking to extract
// structured breeding data. Streams tool calls to the client via NDJSON.
// Writes NOTHING to the database — /api/onboarding/confirm handles that.
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

const MODEL = 'claude-sonnet-4-6';

// Tool definitions — the model calls these; we just stream them to the client.
const TOOLS = [
    {
        name: 'create_dog',
        description: 'Record a dog found in the breeding records. Use ONCE per unique dog. If the same dog (same name + sex) appears multiple times across sources, call this once with the merged data.',
        input_schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The dog\'s registered / primary name' },
                call_name: { type: 'string', description: 'Nickname or call name, if different from registered name' },
                sex: { type: 'string', enum: ['female', 'male'], description: 'Biological sex' },
                breed: { type: 'string', description: 'Breed (e.g., "Goldendoodle", "Standard Poodle", "Labrador Retriever"). Default to Goldendoodle if unclear.' },
                date_of_birth: { type: 'string', description: 'YYYY-MM-DD format. Omit if unknown — do not guess.' },
                color: { type: 'string', description: 'Coat color' },
                weight_lbs: { type: 'number', description: 'Adult weight in pounds' },
                registration_number: { type: 'string', description: 'AKC/UKC or other registry number' },
                microchip: { type: 'string', description: 'Microchip ID' },
                embark_id: { type: 'string', description: 'Embark DNA profile ID or URL' },
                role: { type: 'string', enum: ['dam', 'stud', 'prospect'], description: 'Role in the program — dam (breeding female), stud (breeding male), or prospect (evaluation)' },
                is_intact: { type: 'boolean', description: 'Whether the dog is intact (not spayed/neutered). Default true for breeding dogs.' },
                status: { type: 'string', enum: ['active', 'retired', 'guardian', 'sold', 'deceased'], description: 'Current status' },
                last_heat_date: { type: 'string', description: 'YYYY-MM-DD of last heat cycle, if recorded' },
                health_notes: { type: 'string', description: 'Health clearances, OFA results, genetic test notes' },
                notes: { type: 'string', description: 'Any other relevant info' }
            },
            required: ['name']
        }
    },
    {
        name: 'create_litter',
        description: 'Record a litter — past, current, or planned. Identify by dam name and breed/whelp date. If dam/sire are dogs that also need to be recorded, call create_dog for them separately.',
        input_schema: {
            type: 'object',
            properties: {
                dam_name: { type: 'string', description: 'Name of the dam (mother). Must match a dog recorded via create_dog.' },
                sire_name: { type: 'string', description: 'Name of the sire (father). Must match a dog recorded via create_dog, or can be an outside stud.' },
                breed_date: { type: 'string', description: 'YYYY-MM-DD of breeding/mating' },
                due_date: { type: 'string', description: 'YYYY-MM-DD of expected whelping. Gestation is ~63 days from breed_date if known.' },
                whelp_date: { type: 'string', description: 'YYYY-MM-DD of actual whelping, if already born' },
                puppy_count: { type: 'number', description: 'Total puppies born, or expected count for planned litters' },
                status: { type: 'string', enum: ['planned', 'confirmed', 'born', 'available', 'placed', 'archived'], description: 'Litter status' },
                notes: { type: 'string', description: 'Any other relevant details' }
            },
            required: ['dam_name']
        }
    },
    {
        name: 'create_guardian',
        description: 'Record a guardian family (a home that keeps one of the breeder\'s breeding dogs as a pet in exchange for reduced/free cost). Different from a puppy buyer.',
        input_schema: {
            type: 'object',
            properties: {
                family_name: { type: 'string', description: 'Family/last name, e.g., "Smith", "Johnson Family"' },
                contact_name: { type: 'string', description: 'Primary contact person\'s full name' },
                email: { type: 'string', description: 'Email address' },
                phone: { type: 'string', description: 'Phone number' },
                dog_name_if_known: { type: 'string', description: 'Name of the dog this family guards, if mentioned' },
                notes: { type: 'string', description: 'Any other relevant details' }
            },
            required: ['family_name']
        }
    },
    {
        name: 'link_guardian_to_dog',
        description: 'Create a link between an already-recorded guardian and an already-recorded dog. Only call this if create_guardian did not already include dog_name_if_known.',
        input_schema: {
            type: 'object',
            properties: {
                guardian_name: { type: 'string', description: 'The guardian\'s family_name' },
                dog_name: { type: 'string', description: 'The dog\'s name' }
            },
            required: ['guardian_name', 'dog_name']
        }
    },
    {
        name: 'ask_user',
        description: 'Ask the breeder a clarifying question when data is ambiguous, conflicting, or critically missing. Prefer accuracy over coverage — if you see the same name with conflicting DOBs, ASK rather than guess.',
        input_schema: {
            type: 'object',
            properties: {
                question: { type: 'string', description: 'The question to ask, written conversationally' },
                context: { type: 'string', description: 'What you saw that prompted the question, e.g., "I see \'Luna\' mentioned twice with different DOBs (2020-03-15 and 2021-03-15)."' }
            },
            required: ['question', 'context']
        }
    },
    {
        name: 'finish',
        description: 'Call this once when you have extracted everything you can. No more tool calls will follow.',
        input_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'A one-sentence summary of what you extracted, e.g., "Found 3 dams, 1 stud, 2 active litters, and 1 guardian family."' }
            },
            required: ['summary']
        }
    }
];

const SYSTEM_PROMPT = `You are BreedIQ's onboarding extractor. A dog breeder has pasted or uploaded their records — anything from Apple Notes to text messages to spreadsheet dumps to vet records — and you will extract structured data by calling tools.

# Your job

Read the content carefully, then call tools to record each distinct dog, litter, and guardian family you find. Call tools AS YOU READ — don't wait to batch them. Each tool call streams to the user's screen and makes them feel seen.

# Rules

1. **Accuracy over coverage.** If a field is ambiguous, missing, or conflicting, OMIT it. Do not guess. If it's critical and ambiguous, call ask_user instead.
2. **One entity per call.** Call create_dog once per unique dog. If "Poppy" is mentioned five times, merge those mentions into ONE call with the combined data.
3. **Name matching for litters.** When calling create_litter, use the EXACT same dam_name and sire_name you used in create_dog (so we can link them). If a sire is an outside stud not in the records, use their name anyway.
4. **Dates are YYYY-MM-DD.** If you see "March 14, 2022" write "2022-03-14". If you see "3/14/22" assume US MM/DD/YY → "2022-03-14". If the year is ambiguous, omit the date.
5. **Gestation math.** Canine gestation is ~63 days. If you see a breed_date but no due_date, you may compute due_date = breed_date + 63 days. If you see a whelp_date, don't compute anything.
6. **Sex/role inference.** "Dam", "queen", "mom", "had a litter" → sex: female, role: dam. "Stud", "sire", "dad of the litter" → sex: male, role: stud.
7. **Call finish last.** When you've extracted everything, call the finish tool with a brief summary.

# Database schema reference

- dogs: name, call_name, sex (female|male), breed, date_of_birth, color, weight_lbs, registration_number, microchip, embark_id, role (dam|stud|prospect), is_intact, status (active|retired|guardian|sold|deceased), last_heat_date, health_notes, notes
- litters: dam_name (→ dogs.name), sire_name (→ dogs.name), breed_date, due_date, whelp_date, puppy_count, status (planned|confirmed|born|available|placed|archived), notes
- guardians: family_name, contact_name, email, phone, dog_name_if_known, notes

# Style

Pretend you are reading the records over the breeder's shoulder. Be quick, careful, and professional. The breeder is trusting you with the raw mess of their program. Earn that trust by being accurate.`;

async function fetchFileContents(supabase, userId, fileIds) {
    if (!fileIds || fileIds.length === 0) return [];
    const { data: files, error } = await supabase
        .from('files')
        .select('*')
        .in('id', fileIds)
        .eq('user_id', userId);
    if (error || !files) return [];

    const contents = [];
    for (const file of files) {
        const { data: fileData, error: dlError } = await supabase.storage
            .from('uploads')
            .download(file.storage_path);
        if (dlError) continue;

        if (file.file_type === 'image') {
            const buffer = Buffer.from(await fileData.arrayBuffer());
            contents.push({
                type: 'image',
                filename: file.filename,
                media_type: file.mime_type || 'image/jpeg',
                data: buffer.toString('base64')
            });
        } else {
            try {
                const text = await fileData.text();
                contents.push({ type: 'text', filename: file.filename, content: text });
            } catch {
                // skip unreadable binaries silently
            }
        }
    }
    return contents;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = await requireAuth(req, res);
    if (!auth) return;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const { text, file_ids, follow_up } = req.body || {};
    const pastedText = (text || '').trim();
    const fileIds = Array.isArray(file_ids) ? file_ids : [];

    if (!pastedText && fileIds.length === 0 && !follow_up) {
        return res.status(400).json({ error: 'Provide text or file_ids.' });
    }

    const supabase = getServiceClient();
    const userId = auth.user.id;

    // Fetch file contents (if any)
    let fileContents = [];
    try {
        fileContents = await fetchFileContents(supabase, userId, fileIds);
    } catch (err) {
        console.error('Failed to load files:', err);
    }

    // Mark files as processing
    if (fileIds.length > 0) {
        await supabase.from('files').update({ processing_status: 'processing' }).in('id', fileIds);
    }

    // Build user-turn content blocks
    const userContent = [];
    if (pastedText) {
        userContent.push({ type: 'text', text: `The breeder pasted the following:\n\n${pastedText}` });
    }
    for (const fc of fileContents) {
        if (fc.type === 'image') {
            userContent.push({
                type: 'image',
                source: { type: 'base64', media_type: fc.media_type, data: fc.data }
            });
            userContent.push({ type: 'text', text: `[Image file: ${fc.filename}]` });
        } else {
            userContent.push({
                type: 'text',
                text: `--- File: ${fc.filename} ---\n${fc.content}\n--- End of ${fc.filename} ---`
            });
        }
    }
    if (userContent.length === 0) {
        userContent.push({ type: 'text', text: 'No input provided.' });
    }

    // Set up NDJSON streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    // Flush headers early so the browser starts reading
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const emit = (obj) => {
        try {
            res.write(JSON.stringify(obj) + '\n');
        } catch (e) {
            console.error('Stream write failed:', e.message);
        }
    };

    const inputLength = pastedText.length + fileContents.reduce((n, f) => n + (f.type === 'text' ? f.content.length : 0), 0);
    const enableThinking = inputLength > 2000;

    const client = new Anthropic({ apiKey });

    try {
        emit({ type: 'start', model: MODEL, thinking: enableThinking });

        // Build the request. Prompt caching on system + tools via top-level cache_control.
        const requestParams = {
            model: MODEL,
            max_tokens: 8192,
            system: [
                { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }
            ],
            tools: TOOLS,
            // top-level cache_control auto-places on last cacheable block (tools tail)
            cache_control: { type: 'ephemeral' },
            messages: [{ role: 'user', content: userContent }]
        };
        if (enableThinking) {
            requestParams.thinking = { type: 'adaptive' };
        }

        // Stream — emit tool_use blocks as they complete
        const stream = client.messages.stream(requestParams);

        // Track tool uses in progress by index, so we can emit them on stop
        const toolUsesByIndex = {};
        let finishCalled = false;

        stream.on('streamEvent', (event) => {
            if (event.type === 'content_block_start') {
                if (event.content_block?.type === 'tool_use') {
                    toolUsesByIndex[event.index] = {
                        id: event.content_block.id,
                        name: event.content_block.name,
                        input: '' // accumulate partial_json
                    };
                } else if (event.content_block?.type === 'thinking') {
                    emit({ type: 'thinking_start' });
                }
            } else if (event.type === 'content_block_delta') {
                if (event.delta?.type === 'input_json_delta') {
                    const tu = toolUsesByIndex[event.index];
                    if (tu) tu.input += event.delta.partial_json || '';
                }
            } else if (event.type === 'content_block_stop') {
                const tu = toolUsesByIndex[event.index];
                if (tu) {
                    let parsedInput = {};
                    try {
                        parsedInput = tu.input ? JSON.parse(tu.input) : {};
                    } catch (e) {
                        console.error(`Failed to parse tool input for ${tu.name}:`, tu.input);
                    }
                    emit({
                        type: 'tool_call',
                        tool_use_id: tu.id,
                        tool_name: tu.name,
                        input: parsedInput
                    });
                    if (tu.name === 'finish') finishCalled = true;
                    delete toolUsesByIndex[event.index];
                }
            }
        });

        const finalMessage = await stream.finalMessage();

        // Update files to completed
        if (fileIds.length > 0) {
            await supabase.from('files').update({ processing_status: 'completed' }).in('id', fileIds);
        }

        emit({
            type: 'done',
            stop_reason: finalMessage.stop_reason,
            finish_called: finishCalled,
            usage: {
                input_tokens: finalMessage.usage?.input_tokens,
                output_tokens: finalMessage.usage?.output_tokens,
                cache_creation_input_tokens: finalMessage.usage?.cache_creation_input_tokens,
                cache_read_input_tokens: finalMessage.usage?.cache_read_input_tokens
            }
        });
        res.end();
    } catch (err) {
        console.error('Process stream error:', err);
        if (fileIds.length > 0) {
            await supabase.from('files').update({ processing_status: 'failed' }).in('id', fileIds).catch(() => {});
        }
        emit({ type: 'error', error: err.message || 'Unknown error' });
        try { res.end(); } catch {}
    }
}
