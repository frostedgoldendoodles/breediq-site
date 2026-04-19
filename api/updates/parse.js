// BreedIQ Quick Update — AI Natural Language Parser
// POST: Parse natural language update requests into structured actions
// Uses Anthropic Claude API to understand intent and map to dog/litter updates
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getServiceClient();
    const userId = auth.user.id;
    const { message, conversationHistory } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        // Check for sub-breeder relationships (program owner sees all)
        const { data: relationships } = await supabase
            .from('breeder_relationships')
            .select('breeder_id')
            .eq('owner_id', userId)
            .eq('status', 'active');

        const breederIds = (relationships || []).map(r => r.breeder_id);
        const allUserIds = [userId, ...breederIds];

        // Fetch dogs and litters for user + sub-breeders
        const [dogsResult, littersResult] = await Promise.all([
            supabase.from('dogs').select('id, name, call_name, status, heat_status, last_heat_date, sex')
                .in('user_id', allUserIds).order('name'),
            supabase.from('litters').select(`
                id, status, breed_date, due_date, whelp_date, go_home_date,
                puppy_count, males_count, females_count,
                dam:dogs!litters_dam_id_fkey(id, name),
                sire:dogs!litters_sire_id_fkey(id, name)
            `).in('user_id', allUserIds).not('status', 'eq', 'archived').order('breed_date', { ascending: false })
        ]);

        const dogs = dogsResult.data || [];
        const litters = littersResult.data || [];

        // Build context for the AI
        const dogList = dogs.map(d =>
            `- ${d.name} (ID: ${d.id}, status: ${d.status}, heat: ${d.heat_status || 'none'}, sex: ${d.sex || 'unknown'})`
        ).join('\n');

        const litterList = litters.map(l =>
            `- ${l.dam?.name || 'Unknown'}'s litter (ID: ${l.id}, status: ${l.status}, bred: ${l.breed_date || '?'}, due: ${l.due_date || '?'}, whelp: ${l.whelp_date || '?'}, go_home: ${l.go_home_date || '?'}, pups: ${l.puppy_count || '?'})`
        ).join('\n');

        const today = new Date().toISOString().split('T')[0];

        const systemPrompt = `You are BreedIQ's update assistant for a dog breeding program. Today is ${today}.

The user's dogs:
${dogList || '(no dogs yet)'}

The user's active litters:
${litterList || '(no active litters)'}

Your job: parse the user's natural language message into a structured database update. You can update:
1. Dog fields via PUT /api/dogs/{id}: status (active/guardian/retired/sold/deceased), heat_status (none/in_heat/bred/pregnant/nursing), last_heat_date, notes
2. Litter fields via PUT /api/litters/{id}: status (planned/confirmed/bred/born/nursing/placed/archived), whelp_date, go_home_date, ultrasound_date, puppy_count, males_count, females_count, notes

IMPORTANT RULES:
- When a litter status changes to "placed", also note the go_home_date if mentioned
- When a litter status changes to "born", also note whelp_date and puppy counts if mentioned
- "Pups went home" = litter status "placed"
- "She whelped" or "puppies born" = litter status "born"
- "Yesterday" means ${new Date(Date.now() - 86400000).toISOString().split('T')[0]}
- "Today" means ${today}
- Match dog names case-insensitively and handle nicknames
- If the user's message is ambiguous (which dog? which litter? what date?), ask a follow-up question

RESPONSE FORMAT — respond with valid JSON only, one of:

1. If you need more info:
{"type":"followup","question":"Your clarifying question here"}

2. If you can construct the update:
{"type":"preview","summary":"Human-readable summary of what will be updated","actions":[{"endpoint":"/api/dogs/UUID or /api/litters/UUID","method":"PUT","changes":{"field":"value"}}]}

3. If the message doesn't relate to any update:
{"type":"error","message":"Friendly explanation"}

ONLY output valid JSON. No markdown, no code fences, no explanation outside the JSON.`;

        // Build messages array
        const messages = [];
        if (conversationHistory && conversationHistory.length > 0) {
            conversationHistory.forEach(m => {
                messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
            });
        }
        messages.push({ role: 'user', content: message });

        // Call Anthropic Claude API
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (!anthropicKey) {
            return res.status(200).json({
                type: 'error',
                message: 'AI assistant is not configured yet. Please use the manual update buttons above.'
            });
        }

        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                system: systemPrompt,
                messages: messages
            })
        });

        if (!claudeResponse.ok) {
            const errText = await claudeResponse.text();
            console.error('Claude API error:', errText);
            return res.status(200).json({
                type: 'error',
                message: 'AI assistant encountered an error. Please use the manual update buttons.'
            });
        }

        const claudeData = await claudeResponse.json();
        const responseText = claudeData.content?.[0]?.text || '';

        // Parse the JSON response from Claude
        try {
            const parsed = JSON.parse(responseText.trim());
            return res.status(200).json(parsed);
        } catch (parseErr) {
            // Try to extract JSON from the response if Claude wrapped it
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return res.status(200).json(parsed);
                } catch (e) { /* fall through */ }
            }
            console.error('Failed to parse Claude response:', responseText);
            return res.status(200).json({
                type: 'error',
                message: 'I had trouble understanding that. Could you rephrase? For example: "Update Poppy\'s litter status to placed" or "Record heat for Cookie starting today".'
            });
        }
    } catch (err) {
        console.error('Parse endpoint error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
