// BreedIQ Onboarding — Confirm & Save
// Takes AI-extracted data (after user review/edit) and saves to database tables
// Also marks onboarding as completed on the user's profile
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = await requireAuth(req, res);
    if (!auth) return;

    try {
        const { dogs, litters, guardians, file_ids } = req.body;
        const supabase = getServiceClient();
        const userId = auth.user.id;

        const results = { dogs: [], litters: [], guardians: [], errors: [] };

        // ── 1. Insert Guardians first (dogs may reference them) ─
        const guardianNameToId = {};
        if (guardians && guardians.length > 0) {
            for (const g of guardians) {
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
        }

        // ── 2. Insert Dogs ──────────────────────────────────────
        const dogNameToId = {};
        if (dogs && dogs.length > 0) {
            for (const d of dogs) {
                // Try to match guardian by name
                let guardianId = null;
                if (d.guardian_name) {
                    guardianId = guardianNameToId[d.guardian_name.toLowerCase()] || null;
                }

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
                        guardian_id: guardianId,
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
        }

        // ── 3. Insert Litters (link dam/sire by name) ───────────
        if (litters && litters.length > 0) {
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
                        notes: l.notes || null
                    })
                    .select()
                    .single();

                if (error) {
                    results.errors.push({ type: 'litter', dam: l.dam_name, error: error.message });
                } else {
                    results.litters.push(data);
                }
            }
        }

        // ── 4. Link guardian dogs (from AI extraction) ──────────
        if (guardians && guardians.length > 0) {
            for (const g of guardians) {
                if (g.dogs && g.dogs.length > 0) {
                    const guardianId = guardianNameToId[g.family_name.toLowerCase()];
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

        // ── 7. Calculate initial Breeding IQ Score ──────────────
        // Trigger initial score calculation
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
