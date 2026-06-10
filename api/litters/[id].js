// BreedIQ Litters — Single litter operations
// GET: Get litter with full details
// PUT: Update litter (status changes, add puppy count, etc.)
// DELETE: Archive litter
import { requireAuth, getServiceClient, getProgramUserIds, attachSignedPhotoUrls } from '../../lib/supabase.js';
import { computeDueDate, gestationProgress } from '../../lib/gestation.js';

export default async function handler(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getServiceClient();
    const userId = auth.user.id;
    const { id } = req.query;

    if (!id) return res.status(400).json({ error: 'Litter ID is required' });

    // Program-owner scope: caller's own user_id + active sub-breeders.
    const programUserIds = await getProgramUserIds(supabase, userId);

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
                .in('user_id', programUserIds)
                .single();

            if (error || !litter) {
                return res.status(404).json({ error: 'Litter not found' });
            }

            // Add gestation tracking for active pregnancies
            if (litter.breed_date && !litter.whelp_date) {
                Object.assign(litter, gestationProgress(litter.breed_date));
            }

            // Sign embedded dam/sire photo URLs.
            const embeddedDogs = [litter.dam, litter.sire].filter(Boolean);
            await attachSignedPhotoUrls(supabase, embeddedDogs);

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
                .in('user_id', programUserIds)
                .maybeSingle();

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
                updates.due_date = computeDueDate(updates.breed_date);
            }

            const { data: litter, error } = await supabase
                .from('litters')
                .update(updates)
                .eq('id', id)
                .in('user_id', programUserIds)
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
                        .in('user_id', programUserIds);
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
                .in('user_id', programUserIds);

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
