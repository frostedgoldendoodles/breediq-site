// BreedIQ Guardians — Single guardian operations
// GET: Get guardian with linked dogs
// PUT: Update guardian info
// PATCH: Assign/unassign dogs to guardian
// DELETE: Remove guardian (unlinks dogs first)
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const supabase = getServiceClient();
    const userId = auth.user.id;
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Guardian ID is required' });

    // GET: Single guardian with dogs
    if (req.method === 'GET') {
        try {
            const { data: guardian, error } = await supabase
                .from('guardians').select('*').eq('id', id).eq('user_id', userId).single();
            if (error || !guardian) return res.status(404).json({ error: 'Guardian not found' });
            const { data: dogs } = await supabase
                .from('dogs')
                .select('id, name, call_name, status, sex, color, photo_url, heat_status, date_of_birth, weight_lbs')
                .eq('guardian_id', id);
            return res.status(200).json({ guardian: { ...guardian, dogs: dogs || [] } });
        } catch (err) {
            console.error('GET guardian error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // PUT: Update guardian
    if (req.method === 'PUT') {
        try {
            const allowedFields = ['family_name','contact_name','email','phone','address','city','state','zip','last_checkin','checkin_frequency_days','checkin_notes','status','notes'];
            const updates = {};
            for (const field of allowedFields) { if (req.body[field] !== undefined) updates[field] = req.body[field]; }
            if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
            updates.updated_at = new Date().toISOString();
            const { data: guardian, error } = await supabase
                .from('guardians').update(updates).eq('id', id).eq('user_id', userId).select().single();
            if (error) {
                console.error('Update guardian error:', error);
                return res.status(500).json({ error: 'Failed to update guardian', details: error.message });
            }
            return res.status(200).json({ success: true, guardian });
        } catch (err) {
            console.error('PUT guardian error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // PATCH: Assign/unassign dogs
    if (req.method === 'PATCH') {
        try {
            const { assign_dog_ids, unassign_dog_ids } = req.body;
            const { data: guardian } = await supabase
                .from('guardians').select('id').eq('id', id).eq('user_id', userId).single();
            if (!guardian) return res.status(404).json({ error: 'Guardian not found' });
            const results = { assigned: 0, unassigned: 0 };
            if (assign_dog_ids && assign_dog_ids.length > 0) {
                const { error: assignError } = await supabase
                    .from('dogs').update({ guardian_id: id, status: 'guardian', updated_at: new Date().toISOString() })
                    .in('id', assign_dog_ids).eq('user_id', userId);
                if (assignError) { console.error('Assign dogs error:', assignError); return res.status(500).json({ error: 'Failed to assign dogs' }); }
                results.assigned = assign_dog_ids.length;
            }
            if (unassign_dog_ids && unassign_dog_ids.length > 0) {
                const { error: unassignError } = await supabase
                    .from('dogs').update({ guardian_id: null, status: 'active', updated_at: new Date().toISOString() })
                    .in('id', unassign_dog_ids).eq('guardian_id', id);
                if (unassignError) { console.error('Unassign dogs error:', unassignError); return res.status(500).json({ error: 'Failed to unassign dogs' }); }
                results.unassigned = unassign_dog_ids.length;
            }
            return res.status(200).json({ success: true, ...results });
        } catch (err) {
            console.error('PATCH guardian error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // DELETE: Remove guardian
    if (req.method === 'DELETE') {
        try {
            await supabase.from('dogs')
                .update({ guardian_id: null, status: 'active', updated_at: new Date().toISOString() })
                .eq('guardian_id', id);
            const { error } = await supabase.from('guardians').delete().eq('id', id).eq('user_id', userId);
            if (error) { console.error('Delete guardian error:', error); return res.status(500).json({ error: 'Failed to delete guardian' }); }
            return res.status(200).json({ success: true });
        } catch (err) {
            console.error('DELETE guardian error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
