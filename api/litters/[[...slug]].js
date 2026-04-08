// BreedIQ Litters API — Combined catch-all handler
// Handles both /api/litters (list, create) and /api/litters/:id (get, update, delete)
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getServiceClient();
    const userId = auth.user.id;

    // Determine if this is a single-item request
    const slug = req.query.slug;
    const id = slug && slug.length > 0 ? slug[0] : null;

    // ═══════════════════════════════════════════════════════════
    // SINGLE LITTER OPERATIONS (when ID is provided)
    // ═══════════════════════════════════════════════════════════
    if (id) {
        // ── GET: Single litter ──────────────────────────────────
        if (req.method === 'GET') {
            try {
                const { data: litter, error } = await supabase
                    .from('litters')
                    .select(`
                        *,
                        dam:dogs!litters_dam_id_fkey(id, name, call_name, photo_url, color, breed, embark_id),
                        sire:dogs!litters_sire_id_fkey(id, name, call_name, photo_url, color, breed, embark_id)
                    `)
                    .eq('id', id)
                    .eq('user_id', userId)
                    .single();

                if (error || !litter) {
                    return res.status(404).json({ error: 'Litter not found' });
                }

                // Add gestation tracking for active pregnancies
                if (litter.breed_date && !litter.whelp_date) {
                    const breedDate = new Date(litter.breed_date);
                    const today = new Date();
                    litter.computed_gestation_day = Math.floor((today - breedDate) / (24 * 60 * 60 * 1000));
                    litter.days_remaining = Math.max(0, 61 - litter.computed_gestation_day);
                    litter.gestation_progress = Math.min(Math.round((litter.computed_gestation_day / 61) * 100), 100);
                }

                return res.status(200).json({ litter });
            } catch (err) {
                console.error('GET litter error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }

        // ── PUT: Update litter ──────────────────────────────────
        if (req.method === 'PUT') {
            try {
                const { data: existing } = await supabase
                    .from('litters')
                    .select('id, dam_id, status')
                    .eq('id', id)
                    .eq('user_id', userId)
                    .single();

                if (!existing) {
                    return res.status(404).json({ error: 'Litter not found' });
                }

                const allowedFields = [
                    'dam_id', 'sire_id', 'breed_date', 'due_date', 'whelp_date',
                    'status', 'puppy_count', 'males_count', 'females_count',
                    'ultrasound_date', 'xray_date', 'go_home_date',
                    'price_per_puppy', 'notes'
                ];

                const updates = {};
                for (const field of allowedFields) {
                    if (req.body[field] !== undefined) {
                        updates[field] = req.body[field];
                    }
                }

                if (Object.keys(updates).length === 0) {
                    return res.status(400).json({ error: 'No valid fields to update' });
                }

                updates.updated_at = new Date().toISOString();

                // Auto-calculate due date if breed_date changed and no due_date provided
                if (updates.breed_date && !updates.due_date) {
                    const bd = new Date(updates.breed_date);
                    bd.setDate(bd.getDate() + 61);
                    updates.due_date = bd.toISOString().split('T')[0];
                }

                const { data: litter, error } = await supabase
                    .from('litters')
                    .update(updates)
                    .eq('id', id)
                    .eq('user_id', userId)
                    .select()
                    .single();

                if (error) {
                    console.error('Update litter error:', error);
                    return res.status(500).json({ error: 'Failed to update litter', details: error.message });
                }

                // Update dam heat_status based on litter status changes
                if (updates.status && existing.dam_id) {
                    const heatStatusMap = {
                        'confirmed': 'pregnant',
                        'born': 'nursing',
                        'placed': 'none',
                        'archived': 'none'
                    };
                    if (heatStatusMap[updates.status]) {
                        await supabase
                            .from('dogs')
                            .update({
                                heat_status: heatStatusMap[updates.status],
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', existing.dam_id)
                            .eq('user_id', userId);
                    }
                }

                return res.status(200).json({ success: true, litter });
            } catch (err) {
                console.error('PUT litter error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }

        // ── DELETE: Archive litter ───────────────────────────────
        if (req.method === 'DELETE') {
            try {
                const { error } = await supabase
                    .from('litters')
                    .update({ status: 'archived', updated_at: new Date().toISOString() })
                    .eq('id', id)
                    .eq('user_id', userId);

                if (error) {
                    return res.status(500).json({ error: 'Failed to archive litter' });
                }

                return res.status(200).json({ success: true });
            } catch (err) {
                console.error('DELETE litter error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }

        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ═══════════════════════════════════════════════════════════
    // COLLECTION OPERATIONS (no ID — /api/litters)
    // ═══════════════════════════════════════════════════════════

    // ── GET: List litters ───────────────────────────────────
    if (req.method === 'GET') {
        try {
            const { status } = req.query;

            let query = supabase
                .from('litters')
                .select(`
                    *,
                    dam:dogs!litters_dam_id_fkey(id, name, call_name, photo_url, color),
                    sire:dogs!litters_sire_id_fkey(id, name, call_name, photo_url, color)
                `)
                .eq('user_id', userId)
                .order('breed_date', { ascending: false });

            if (status) query = query.eq('status', status);

            const { data: litters, error } = await query;

            if (error) {
                console.error('List litters error:', error);
                return res.status(500).json({ error: 'Failed to fetch litters' });
            }

            // Add computed gestation info for active pregnancies
            const enriched = (litters || []).map(l => {
                if (l.breed_date && !l.whelp_date && ['confirmed'].includes(l.status)) {
                    const breedDate = new Date(l.breed_date);
                    const today = new Date();
                    const gestationDay = Math.floor((today - breedDate) / (24 * 60 * 60 * 1000));
                    const dueDate = l.due_date || new Date(breedDate.getTime() + 61 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    const daysRemaining = Math.max(0, 61 - gestationDay);

                    return {
                        ...l,
                        computed_gestation_day: gestationDay,
                        computed_due_date: dueDate,
                        days_remaining: daysRemaining,
                        gestation_progress: Math.min(Math.round((gestationDay / 61) * 100), 100)
                    };
                }
                return l;
            });

            return res.status(200).json({ litters: enriched, count: enriched.length });
        } catch (err) {
            console.error('GET litters error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // ── POST: Create litter ─────────────────────────────────
    if (req.method === 'POST') {
        try {
            const {
                dam_id, sire_id, breed_date, due_date, whelp_date,
                status, puppy_count, males_count, females_count,
                ultrasound_date, xray_date, go_home_date,
                price_per_puppy, notes
            } = req.body;

            // Auto-calculate due date if breed_date given (61-day gestation)
            let computedDueDate = due_date;
            if (breed_date && !due_date) {
                const bd = new Date(breed_date);
                bd.setDate(bd.getDate() + 61);
                computedDueDate = bd.toISOString().split('T')[0];
            }

            const { data: litter, error } = await supabase
                .from('litters')
                .insert({
                    user_id: userId,
                    dam_id: dam_id || null,
                    sire_id: sire_id || null,
                    breed_date: breed_date || null,
                    due_date: computedDueDate || null,
                    whelp_date: whelp_date || null,
                    status: status || 'planned',
                    puppy_count: puppy_count || null,
                    males_count: males_count || null,
                    females_count: females_count || null,
                    ultrasound_date: ultrasound_date || null,
                    xray_date: xray_date || null,
                    go_home_date: go_home_date || null,
                    price_per_puppy: price_per_puppy || null,
                    notes: notes || null
                })
                .select(`
                    *,
                    dam:dogs!litters_dam_id_fkey(id, name, call_name),
                    sire:dogs!litters_sire_id_fkey(id, name, call_name)
                `)
                .single();

            if (error) {
                console.error('Create litter error:', error);
                return res.status(500).json({ error: 'Failed to create litter', details: error.message });
            }

            // Update dam's heat_status to 'bred' if breed_date is set
            if (dam_id && breed_date) {
                await supabase
                    .from('dogs')
                    .update({ heat_status: 'bred', last_heat_date: breed_date, updated_at: new Date().toISOString() })
                    .eq('id', dam_id)
                    .eq('user_id', userId);
            }

            return res.status(201).json({ success: true, litter });
        } catch (err) {
            console.error('POST litter error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
