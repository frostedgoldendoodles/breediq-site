// BreedIQ Dogs — Single dog operations
// GET: Get dog by ID
// PUT: Update dog
// DELETE: Soft-delete dog (set status to 'deceased' or hard delete)
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getServiceClient();
    const userId = auth.user.id;
    const { id } = req.query;

    if (!id) return res.status(400).json({ error: 'Dog ID is required' });

    // ── GET: Single dog ─────────────────────────────────────
    if (req.method === 'GET') {
        try {
            const { data: dog, error } = await supabase
                .from('dogs')
                .select('*, guardian:guardians(id, family_name, contact_name, email, phone)')
                .eq('id', id)
                .eq('user_id', userId)
                .single();

            if (error || !dog) {
                return res.status(404).json({ error: 'Dog not found' });
            }

            // Also fetch litters this dog is part of
            const { data: litters } = await supabase
                .from('litters')
                .select('id, breed_date, due_date, whelp_date, status, puppy_count')
                .eq('user_id', userId)
                .or(`dam_id.eq.${id},sire_id.eq.${id}`)
                .order('breed_date', { ascending: false });

            return res.status(200).json({ dog, litters: litters || [] });
        } catch (err) {
            console.error('GET dog error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // ── PUT: Update dog ─────────────────────────────────────
    if (req.method === 'PUT') {
        try {
            // Verify ownership
            const { data: existing } = await supabase
                .from('dogs')
                .select('id')
                .eq('id', id)
                .eq('user_id', userId)
                .single();

            if (!existing) {
                // Only reveal "exists but not yours" if the dog is owned by one of
                // your sub-breeders \u2014 never disclose unrelated rows.
                const { data: relationships } = await supabase
                    .from('breeder_relationships')
                    .select('breeder_id')
                    .eq('owner_id', userId)
                    .eq('status', 'active');
                const subBreederIds = (relationships || []).map(r => r.breeder_id);
                if (subBreederIds.length > 0) {
                    const { data: sharedDog } = await supabase
                        .from('dogs')
                        .select('id')
                        .eq('id', id)
                        .in('user_id', subBreederIds)
                        .maybeSingle();
                    if (sharedDog) {
                        return res.status(403).json({
                            error: 'This dog belongs to a breeder in your program. Only they can edit it from their own login.'
                        });
                    }
                }
                return res.status(404).json({ error: 'Dog not found' });
            }

            const allowedFields = [
                'name', 'call_name', 'breed', 'sex', 'color', 'weight_lbs',
                'date_of_birth', 'status', 'role', 'is_intact',
                'embark_id', 'embark_url', 'coi_percentage', 'genetic_tests',
                'ofa_clearances', 'vet_records_current', 'vet_last_visit', 'health_notes',
                'last_heat_date', 'avg_heat_cycle_days', 'heat_status',
                'guardian_id', 'photo_url', 'pedigree_url', 'notes'
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

            const { data: dog, error } = await supabase
                .from('dogs')
                .update(updates)
                .eq('id', id)
                .eq('user_id', userId)
                .select()
                .single();

            if (error) {
                console.error('Update dog error:', error);
                return res.status(500).json({ error: 'Failed to update dog', details: error.message });
            }

            return res.status(200).json({ success: true, dog });
        } catch (err) {
            console.error('PUT dog error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // ── DELETE: Remove dog ──────────────────────────────────
    if (req.method === 'DELETE') {
        try {
            const { hard } = req.query;

            if (hard === 'true') {
                // Hard delete
                const { error } = await supabase
                    .from('dogs')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', userId);

                if (error) {
                    return res.status(500).json({ error: 'Failed to delete dog' });
                }
            } else {
                // Soft delete — mark as deceased
                const { error } = await supabase
                    .from('dogs')
                    .update({ status: 'retired', updated_at: new Date().toISOString() })
                    .eq('id', id)
                    .eq('user_id', userId);

                if (error) {
                    return res.status(500).json({ error: 'Failed to archive dog' });
                }
            }

            return res.status(200).json({ success: true });
        } catch (err) {
            console.error('DELETE dog error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
