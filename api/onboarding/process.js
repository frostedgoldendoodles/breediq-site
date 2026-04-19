// BreedIQ Onboarding — AI Processing
// Takes uploaded files, sends to AI for extraction, returns structured breeding data
// User reviews and confirms before data is saved to the database
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const EXTRACTION_PROMPT = `You are BreedIQ's AI onboarding assistant. You are analyzing uploaded breeding records to extract structured data about a dog breeding program.

Extract the following information from the provided content. Return ONLY valid JSON with this structure:

{
  "dogs": [
    {
      "name": "string",
      "call_name": "string or null",
      "breed": "string",
      "sex": "female" or "male",
      "color": "string or null",
      "weight_lbs": number or null,
      "date_of_birth": "YYYY-MM-DD or null",
      "status": "active" | "retired" | "guardian" | "sold" | "deceased",
      "role": "dam" | "stud" | "prospect",
      "is_intact": true or false,
      "embark_id": "string or null",
      "health_notes": "string or null",
      "last_heat_date": "YYYY-MM-DD or null",
      "notes": "string or null"
    }
  ],
  "litters": [
    {
      "dam_name": "string",
      "sire_name": "string",
      "breed_date": "YYYY-MM-DD or null",
      "due_date": "YYYY-MM-DD or null",
      "whelp_date": "YYYY-MM-DD or null",
      "puppy_count": number or null,
      "status": "planned" | "confirmed" | "born" | "available" | "placed" | "archived",
      "notes": "string or null"
    }
  ],
  "guardians": [
    {
      "family_name": "string",
      "contact_name": "string or null",
      "email": "string or null",
      "phone": "string or null",
      "dogs": ["names of dogs with this guardian"],
      "notes": "string or null"
    }
  ],
  "confidence": 0.0 to 1.0,
  "notes": "Any observations or things you're unsure about"
}

Be thorough but only include data you can actually extract. Use null for fields you can't determine. If content is an image, describe what you see and extract any visible data. Set confidence based on how clear and complete the source data is.`;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = await requireAuth(req, res);
    if (!auth) return;

    try {
        const { file_ids } = req.body;

        if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
            return res.status(400).json({ error: 'file_ids array is required' });
        }

        const supabase = getServiceClient();
        const userId = auth.user.id;

        // Get file records
        const { data: files, error: filesError } = await supabase
            .from('files')
            .select('*')
            .in('id', file_ids)
            .eq('user_id', userId);

        if (filesError || !files || files.length === 0) {
            return res.status(404).json({ error: 'No files found' });
        }

        // Mark files as processing
        await supabase
            .from('files')
            .update({ processing_status: 'processing' })
            .in('id', file_ids);

        // Download file contents from storage
        const fileContents = [];
        for (const file of files) {
            const { data: fileData, error: dlError } = await supabase.storage
                .from('uploads')
                .download(file.storage_path);

            if (dlError) {
                console.error(`Failed to download ${file.filename}:`, dlError.message);
                continue;
            }

            if (file.file_type === 'image') {
                // Convert to base64 for vision API
                const buffer = Buffer.from(await fileData.arrayBuffer());
                fileContents.push({
                    type: 'image',
                    filename: file.filename,
                    media_type: file.mime_type || 'image/jpeg',
                    data: buffer.toString('base64')
                });
            } else {
                // Text-based files
                const text = await fileData.text();
                fileContents.push({
                    type: 'text',
                    filename: file.filename,
                    content: text
                });
            }
        }

        if (fileContents.length === 0) {
            return res.status(400).json({ error: 'No file contents could be read' });
        }

        // Build Claude API messages
        const contentBlocks = [];
        for (const fc of fileContents) {
            if (fc.type === 'image') {
                contentBlocks.push({
                    type: 'image',
                    source: { type: 'base64', media_type: fc.media_type, data: fc.data }
                });
                contentBlocks.push({ type: 'text', text: `[Image file: ${fc.filename}]` });
            } else {
                contentBlocks.push({
                    type: 'text',
                    text: `--- File: ${fc.filename} ---\n${fc.content}\n--- End of ${fc.filename} ---`
                });
            }
        }

        // Call Claude API for extraction
        const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4096,
                system: EXTRACTION_PROMPT,
                messages: [{
                    role: 'user',
                    content: [
                        ...contentBlocks,
                        { type: 'text', text: 'Please analyze these breeding records and extract all structured data. Return only valid JSON.' }
                    ]
                }]
            })
        });

        if (!claudeResp.ok) {
            const errData = await claudeResp.json().catch(() => ({}));
            console.error('Claude API error:', errData);
            await supabase.from('files').update({ processing_status: 'failed' }).in('id', file_ids);
            return res.status(500).json({ error: 'AI processing failed', details: errData.error?.message });
        }

        const claudeData = await claudeResp.json();
        const aiText = claudeData.content[0]?.text || '';

        // Parse JSON from AI response (handle markdown code blocks)
        let extractedData;
        try {
            const jsonMatch = aiText.match(/```json\n?([\s\S]*?)\n?```/) || aiText.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : aiText;
            extractedData = JSON.parse(jsonStr);
        } catch (parseErr) {
            console.error('Failed to parse AI response:', aiText.substring(0, 500));
            await supabase.from('files').update({ processing_status: 'failed' }).in('id', file_ids);
            return res.status(500).json({ error: 'AI returned unparseable data', raw: aiText.substring(0, 500) });
        }

        // Update file records with extracted data
        for (const fileId of file_ids) {
            await supabase.from('files').update({
                processing_status: 'completed',
                extracted_data: extractedData,
                extraction_confidence: extractedData.confidence || 0.5
            }).eq('id', fileId);
        }

        return res.status(200).json({
            success: true,
            extracted: extractedData,
            file_count: files.length,
            message: 'Review the extracted data below. Confirm to save to your program.'
        });
    } catch (err) {
        console.error('Process error:', err);
        return res.status(500).json({ error: 'Internal server error', message: err.message });
    }
}
