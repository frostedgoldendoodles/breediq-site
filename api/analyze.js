// BreedIQ Analyze API - deployed 2026-04-03T14:16:29.965Z
export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { notes } = req.body;

  if (!notes || notes.trim().length === 0) {
    return res.status(400).json({ error: 'No breeding notes provided' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const systemPrompt = `You are BreedIQ, an AI assistant that extracts structured dog breeding data from messy notes.

Given raw breeding notes (from Apple Notes, texts, spreadsheets, etc.), extract every dog you can find and return structured JSON.

For each dog, extract whatever is available:
- name
- breed/generation (e.g., F1b Goldendoodle)
- weight
- dob (date of birth)
- sex (M/F)
- status (e.g., "pregnant", "nursing", "active", "retired", "stud")
- last_heat_date
- breeding_date
- due_date (if pregnant, calculate using 63-day gestation if breeding_date is known)
- stud (name of stud used)
- expected_litter_size
- guardian_family
- embark_status (linked/not linked)
- microchip
- ofa_status
- notes (any other relevant info)
- confidence: "high" if multiple data points found, "medium" if some info but gaps, "low" if barely mentioned

Also produce a summary object with:
- total_dogs: number
- pregnant_count: number
- nursing_count: number
- stud_count: number
- guardian_families: array of {family_name, dog_name}
- missing_info: array of strings describing what's missing
- embark_linked_count: number

Return ONLY valid JSON in this exact format, no markdown, no explanation:
{
  "dogs": [
    {
      "name": "...",
      "info": "A one-line summary of the dog's key details",
      "confidence": "high|medium|low",
      "breed": "...",
      "weight": "...",
      "dob": "...",
      "sex": "...",
      "status": "...",
      "last_heat_date": "...",
      "breeding_date": "...",
      "due_date": "...",
      "stud": "...",
      "expected_litter_size": null,
      "guardian_family": "...",
      "embark_status": "...",
      "microchip": "...",
      "ofa_status": "...",
      "notes": "..."
    }
  ],
  "summary": {
    "total_dogs": 0,
    "pregnant_count": 0,
    "nursing_count": 0,
    "stud_count": 0,
    "guardian_families": [],
    "missing_info": [],
    "embark_linked_count": 0
  }
}

Use null for any field you cannot determine. Be thorough â breeders often hide data in casual language like "she's due any day" or "bred to Cooper on the 5th".`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Here are my breeding notes. Extract all dog profiles and data:\n\n${notes}`
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);
      return res.status(502).json({ error: 'AI analysis failed', details: errorText });
    }

    const data = await response.json();
    const content = data.content[0].text;

    // Parse the JSON response from Claude
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // Try to extract JSON from the response if it has extra text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        return res.status(500).json({ error: 'Failed to parse AI response', raw: content });
      }
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}
