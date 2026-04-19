// BreedIQ Litters CRUD API
// GET: List litters with dam/sire details  
// POST: Create a new litter
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getServiceClient();
    const userId = auth.user.id;

    if (req.method === 'GET') {
        try {
            const { status } = req.query;
            const { data: relationships } = await supabase
                .from('breeder_relationships')
                .select('breeder_id, profiles!breeder_relationships_breeder_id_fkey(email, kennel_name, full_name)')
                .eq('owner_id', userId)
                .eq('status', 'active');

            const breederIds = (relationships || []).map(r => r.breeder_id);
            const allUserIds = [userId, ...breederIds];

            const breederMap = {};
            (relationships || []).forEach(r => {
                breederMap[r.breeder_id] = {
                    kennel_name: r.profiles?.kennel_name,
                    full_name: r.profiles?.full_name
                };
            });

            let query = supabase
                .from('litters')
                .select('*, dam:dogs!litters_dam_id_fkey(id, name, call_name, photo_url, color), sire:dogs!litters_sire_id_fkey(id, name, call_name, photo_url, color)')
                .in('user_id', allUserIds)
                .order('breed_date', { ascending: false });

            if (status) query = query.eq('status', status);
            const { data: litters, error } = await query;

            if (error) {
                console.error('List litters error:', error);
                return res.status(500).json({ error: 'Failed to fetch litters' });
            }

            const enriched = (litters || []).map(l => {
                if (l.breed_date && !l.whelp_date && ['confirmed'].includes(l.status)) {
                    const breedDate = new Date(l.breed_date);
                    const today = new Date();
                    const gestationDay = Math.floor((today - breedDate) / (24 * 60 * 60 * 1000));
                    const dueDate = l.due_date || new Date(breedDate.getTime() + 61 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    const daysRemaining = Math.max(0, 61 - gestationDay);
                    return { ...l, computed_gestation_day: gestationDay, computed_due_date: dueDate, days_remaining: daysRemaining, gestation_progress: Math.min(Math.round((gestationDay / 61) * 100), 100) };
                }
                return l;
            });

            const taggedLitters = enriched.map(l => ({ ...l, is_shared: l.user_id !== userId, breeder: l.user_id !== userId ? breederMap[l.user_id] || null : null }));
            return res.status(200).json({ litters: taggedLitters, count: taggedLitters.length });
        } catch (err) {
            console.error('GET litters error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    if (req.method === 'POST') {
        try {
            const { dam_id, sire_id, breed_date, due_date, whelp_date, status, puppy_count, males_count, females_count, ultrasound_date, xray_date, go_home_date, price_per_puppy, notes } = req.body;
            let computedDueDate = due_date;
            if (breed_date && !due_date) {
                const bd = new Date(breed_date);
                bd.setDate(bd.getDate() + 61);
                computedDueDate = bd.toISOString().split('T')[0];
            }

            const { data: litter, error } = await supabase.from('litters').insert({ user_id: userId, dam_id: dam_id || null, sire_id: sire_id || null, breed_date: breed_date || null, due_date: computedDueDate || null, whelp_date: whelp_date || null, status: status || 'planned', puppy_count: puppy_count || null, males_count: males_count || null, females_count: females_count || null, ultrasound_date: ultrasound_date || null, xray_date: xray_date || null, go_home_date: go_home_date || null, price_per_puppy: price_per_puppy || null, notes: notes || null }).select('*, dam:dogs!litters_dam_id_fkey(id, name, call_name), sire:dogs!litters_sire_id_fkey(id, name, call_name)').single();

            if (error) {
                console.error('Create litter error:', error);
                return res.status(500).json({ error: 'Failed to create litter', details: error.message });
            }

            if (dam_id && breed_date) {
                await supabase.from('dogs').update({ heat_status: 'bred', last_heat_date: breed_date, updated_at: new Date().toISOString() }).eq('id', dam_id).eq('user_id', userId);
            }

            return res.status(201).json({ success: true, litter });
        } catch (err) {
            console.error('POST litter error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
