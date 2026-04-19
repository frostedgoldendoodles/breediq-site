// BreedIQ Onboarding — Confirm & Save
// Takes AI-extracted tool calls (after user review/edit) and saves to database tables.
// Also marks onboarding as completed on the user's profile.
//
// Accepts two payload shapes:
//   1. NEW (preferred): { tool_calls: [{ tool_name, input }, ...], file_ids }
//   2. LEGACY: { dogs: [...], litters: [...], guardians: [...], file_ids }
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

// Translate the new tool-call payload into the legacy {dogs, litters, guardians} shape
function translateToolCalls(toolCalls) {
    const dogs = [];
    const litters = [];
    const guardians = [];
    const links = []; // { guardian_name, dog_name }

    for (const tc of toolCalls || []) {
        const name = tc.tool_name || tc.name;
        const input = tc.input || {};
        if (!name) continue;

        switch (name) {
            case 'create_dog': {
                dogs.push({
                    name: input.name,
                    call_name: input.call_name,
                    breed: input.breed || 'Goldendoodle',
                    sex: input.sex,
                    color: input.color,
                    weight_lbs: input.weight_lbs,
                    date_of_birth: input.date_of_birth,
                    status: input.status || 'active',
                    role: input.role,
                    is_intact: input.is_intact !== false,
                    embark_id: input.embark_id,
                    health_notes: input.health_notes,
                    last_heat_date: input.last_heat_date,
                    notes: [input.notes, input.registration_number ? `Reg #: ${input.registration_number}` : null, input.microchip ? `Microchip: ${input.microchip}` : null].filter(Boolean).join(' | ') || null
                });
                break;
            }
            case 'create_litter': {
                litters.push({
                    dam_name: input.dam_name,
                    sire_name: input.sire_name,
                    breed_date: input.breed_date,
                    due_date: input.due_date,
                    whelp_date: input.whelp_date,
                    puppy_count: input.puppy_count,
                    status: input.status || (input.whelp_date ? 'born' : input.due_date ? 'confirmed' : 'planned'),
                    notes: input.notes
                });
                break;
            }
            case 'create_guardian': {
                guardians.push({
                    family_name: input.family_name,
                    contact_name: input.contact_name,
                    email: input.email,
                    phone: input.phone,
                    dogs: input.dog_name_if_known ? [input.dog_name_if_known] : [],
                    notes: input.notes
                });
                break;
            }
            case 'link_guardian_to_dog': {
                if (input.guardian_name && input.dog_name) {
                    links.push({ guardian_name: input.guardian_name, dog_name: input.dog_name });
                }
                break;
            }
            // finish / ask_user do not produce DB writes
            default:
                break;
        }
    }

    // Merge link_guardian_to_dog into guardians[].dogs
    for (const link of links) {
        const g = guardians.find(x => (x.family_name || '').toLowerCase() === link.guardian_name.toLowerCase());
        if (g) {
            if (!g.dogs) g.dogs = [];
            if (!g.dogs.includes(link.dog_name)) g.dogs.push(link.dog_name);
        }
    }

    return { dogs, litters, guardians };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = await requireAuth(req, res);
    if (!auth) return;

    try {
        const body = req.body || {};
        const { tool_calls, file_ids } = body;

        let dogs, litters, guardians;
        if (Array.isArray(tool_calls)) {
            ({ dogs, litters, guardians } = translateToolCalls(tool_calls));
        } else {
            dogs = body.dogs || [];
            litters = body.litters || [];
            guardians = body.guardians || [];
        }

        const supabase = getServiceClient();
        const userId = auth.user.id;

        const results = { dogs: [], litters: [], guardians: [], errors: [] };

        // ── 1. Insert Guardians first ───────────────────────────
        const guardianNameToId = {};
        for (const g of guardians) {
            if (!g.family_name) continue;
            const { data, error } = await supabase
                .from('guardians')
                .insert({
                    user_id: userId,
                    family_name: g.family_name,
                    contact_name: g.contact_name || null,
                    email: g.email || null,
                    phone: g.phone || null,
                    notes: g.notes || null,
                    status: 'active'
                })
                .select()
                .single();

            if (error) {
                results.errors.push({ type: 'guardian', name: g.family_name, error: error.message });
            } else {
                results.guardians.push(data);
                guardianNameToId[g.family_name.toLowerCase()] = data.id;
            }
        }

        // ── 2. Insert Dogs ──────────────────────────────────────
        const dogNameToId = {};
        for (const d of dogs) {
            if (!d.name) continue;
            const { data, error } = await supabase
                .from('dogs')
                .insert({
                    user_id: userId,
                    name: d.name,
                    call_name: d.call_name || null,
                    breed: d.breed || 'Goldendoodle',
                    sex: d.sex || null,
                    color: d.color || null,
                    weight_lbs: d.weight_lbs || null,
                    date_of_birth: d.date_of_birth || null,
                    status: d.status || 'active',
                    role: d.role || null,
                    is_intact: d.is_intact !== false,
                    embark_id: d.embark_id || null,
                    health_notes: d.health_notes || null,
                    last_heat_date: d.last_heat_date || null,
                    notes: d.notes || null,
                    source: 'ai_onboarding'
                })
                .select()
                .single();

            if (error) {
                results.errors.push({ type: 'dog', name: d.name, error: error.message });
            } else {
                results.dogs.push(data);
                dogNameToId[d.name.toLowerCase()] = data.id;
            }
        }

        // ── 3. Insert Litters (link dam/sire by name) ───────────
        for (const l of litters) {
            const damId = l.dam_name ? dogNameToId[l.dam_name.toLowerCase()] || null : null;
            const sireId = l.sire_name ? dogNameToId[l.sire_name.toLowerCase()] || null : null;

            const { data, error } = await supabase
                .from('litters')
                .insert({
                    user_id: userId,
                    dam_id: damId,
                    sire_id: sireId,
                    breed_date: l.breed_date || null,
                    due_date: l.due_date || null,
                    whelp_date: l.whelp_date || null,
                    puppy_count: l.puppy_count || null,
                    status: l.status || 'planned',
                    notes: [l.notes, !damId && l.dam_name ? `Dam: ${l.dam_name} (not in system)` : null, !sireId && l.sire_name ? `Sire: ${l.sire_name} (not in system)` : null].filter(Boolean).join(' | ') || null
                })
                .select()
                .single();

            if (error) {
                results.errors.push({ type: 'litter', dam: l.dam_name, error: error.message });
            } else {
                results.litters.push(data);
            }
        }

        // ── 4. Link guardian dogs ───────────────────────────────
        for (const g of guardians) {
            if (g.dogs && g.dogs.length > 0) {
                const guardianId = guardianNameToId[(g.family_name || '').toLowerCase()];
                if (!guardianId) continue;

                for (const dogName of g.dogs) {
                    const dogId = dogNameToId[dogName.toLowerCase()];
                    if (dogId) {
                        await supabase
                            .from('dogs')
                            .update({ guardian_id: guardianId, status: 'guardian' })
                            .eq('id', dogId)
                            .eq('user_id', userId);
                    }
                }
            }
        }

        // ── 5. Mark files as confirmed ──────────────────────────
        if (file_ids && file_ids.length > 0) {
            await supabase
                .from('files')
                .update({ processing_status: 'confirmed' })
                .in('id', file_ids)
                .eq('user_id', userId);
        }

        // ── 6. Mark onboarding as completed ─────────────────────
        await supabase
            .from('profiles')
            .update({ onboarding_completed: true, updated_at: new Date().toISOString() })
            .eq('id', userId);

        const dogCount = results.dogs.length;
        const litterCount = results.litters.length;
        const guardianCount = results.guardians.length;

        return res.status(200).json({
            success: true,
            summary: {
                dogs_created: dogCount,
                litters_created: litterCount,
                guardians_created: guardianCount,
                errors: results.errors
            },
            message: results.errors.length > 0
                ? `Imported ${dogCount} dogs, ${litterCount} litters, ${guardianCount} guardians. ${results.errors.length} item(s) had issues.`
                : `Successfully imported ${dogCount} dogs, ${litterCount} litters, and ${guardianCount} guardians. Welcome to BreedIQ!`
        });
    } catch (err) {
        console.error('Confirm error:', err);
        return res.status(500).json({ error: 'Internal server error', message: err.message });
    }
}
