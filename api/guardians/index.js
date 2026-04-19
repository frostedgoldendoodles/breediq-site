// BreedIQ Guardians CRUD API
// GET: List guardians with their linked dogs
// POST: Create a new guardian
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getServiceClient();
    const userId = auth.user.id;

    // GET: List guardians
    if (req.method === 'GET') {
        try {
            const { data: guardians, error } = await supabase
                .from('guardians').select('*').eq('user_id', userId)
                .order('family_name', { ascending: true });
            if (error) {
                console.error('List guardians error:', error);
                return res.status(500).json({ error: 'Failed to fetch guardians' });
            }
            const { data: relationships } = await supabase
                .from('breeder_relationships').select('breeder_id')
                .eq('owner_id', userId).eq('status', 'active');
            const breederIds = (relationships || []).map(r => r.breeder_id);
            const allUserIds = [userId, ...breederIds];
            const { data: guardianDogs, error: dogsError } = await supabase
                .from('dogs')
                .select('id, name, call_name, status, sex, color, photo_url, guardian_id, heat_status, user_id')
                .in('user_id', allUserIds).not('guardian_id', 'is', null);
            if (dogsError) console.error('Fetch guardian dogs error:', dogsError);
            const dogsByGuardian = {};
            (guardianDogs || []).forEach(dog => {
                if (!dogsByGuardian[dog.guardian_id]) dogsByGuardian[dog.guardian_id] = [];
                dogsByGuardian[dog.guardian_id].push(dog);
            });
            const enriched = (guardians || []).map(g => ({
                ...g, dogs: dogsByGuardian[g.id] || [],
                dog_count: (dogsByGuardian[g.id] || []).length
            }));
            return res.status(200).json({ guardians: enriched, count: enriched.length });
        } catch (err) {
            console.error('GET guardians error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // POST: Create guardian
    if (req.method === 'POST') {
        try {
            const { family_name, contact_name, email, phone, address, city, state, zip, checkin_frequency_days, status, notes } = req.body;
            if (!family_name) return res.status(400).json({ error: 'Family name is required' });
            const { data: guardian, error } = await supabase
                .from('guardians').insert({
                    user_id: userId, family_name,
                    contact_name: contact_name || null, email: email || null,
                    phone: phone || null, address: address || null,
                    city: city || null, state: state || null, zip: zip || null,
                    checkin_frequency_days: checkin_frequency_days || 30,
                    status: status || 'active', notes: notes || null
                }).select().single();
            if (error) {
                console.error('Create guardian error:', error);
                return res.status(500).json({ error: 'Failed to create guardian', details: error.message });
            }
            return res.status(201).json({ success: true, guardian });
        } catch (err) {
            console.error('POST guardian error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
