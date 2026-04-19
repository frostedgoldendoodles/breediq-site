// BreedIQ Litters — Single litter operations
// GET: Get litter with full details
// PUT: Update litter (status changes, add puppy count, etc.)
// DELETE: Archive litter
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getServiceClient();
    const userId = auth.user.id;
    const { id } = req.query;

    if (!id) return res.status(400).json({ error: 'Litter ID is required' });

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
                // Distinguish "doesn't exist" from "exists but is owned by a sub-breeder
                // in your program" (the dashboard list endpoint surfaces those, but this
                // PUT path correctly does not allow cross-account writes). Only return 403
                // when the litter actually belongs to one of the user's sub-breeders \u2014
                // never reveal the existence of unrelated rows.
                const { data: relationships } = await supabase
                    .from('breeder_relationships')
                    .select('breeder_id')
                    .eq('owner_id', userId)
                    .eq('status', 'active');
                const subBreederIds = (relationships || []).map(r => r.breeder_id);
                if (subBreederIds.length > 0) {
                    const { data: sharedLitter } = await supabase
                        .from('litters')
                        .select('id')
                        .eq('id', id)
                        .in('user_id', subBreederIds)
                        .maybeSingle();
                    if (sharedLitter) {
                        return res.status(403).json({
                            error: 'This litter belongs to a breeder in your program. Only they can edit it from their own login.'
                        });
                    }
                }
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
