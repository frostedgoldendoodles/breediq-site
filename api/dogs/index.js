// BreedIQ Dogs CRUD API
// GET: List all dogs for current user (with optional filters)
// POST: Create a new dog
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getServiceClient();
    const userId = auth.user.id;

    // ── GET: List dogs ──────────────────────────────────────────────
    if (req.method === 'GET') {
        try {
            const { status, role, sex, search } = req.query;

            // Check if user is a program owner with sub-breeders
            const { data: relationships } = await supabase
                .from('breeder_relationships')
                .select('breeder_id, profiles!breeder_relationships_breeder_id_fkey(email, kennel_name, full_name)')
                .eq('owner_id', userId)
                .eq('status', 'active');

            const breederIds = (relationships || []).map(r => r.breeder_id);
            const allUserIds = [userId, ...breederIds];

            // Build breeder lookup map
            const breederMap = {};
            (relationships || []).forEach(r => {
                breederMap[r.breeder_id] = {
                    kennel_name: r.profiles?.kennel_name,
                    full_name: r.profiles?.full_name,
                    email: r.profiles?.email
                };
            });

            let query = supabase
                .from('dogs')
                .select('*, guardian:guardians(id, family_name, contact_name)')
                .in('user_id', allUserIds)
                .order('name', { ascending: true });

            if (status) query = query.eq('status', status);
            if (role) query = query.eq('role', role);
            if (sex) query = query.eq('sex', sex);
            if (search) query = query.or(`name.ilike.%${search}%,call_name.ilike.%${search}%`);

            const { data: dogs, error } = await query;

            if (error) {
                console.error('List dogs error:', error);
                return res.status(500).json({ error: 'Failed to fetch dogs' });
            }

            // Tag each dog with breeder info if it belongs to a sub-breeder
            const enrichedDogs = (dogs || []).map(dog => ({
                ...dog,
                is_shared: dog.user_id !== userId,
                breeder: dog.user_id !== userId ? breederMap[dog.user_id] || null : null
            }));

            return res.status(200).json({ dogs: enrichedDogs, count: enrichedDogs.length });
        } catch (err) {
            console.error('GET dogs error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // ── POST: Create dog ────────────────────────────────────────────
    if (req.method === 'POST') {
        try {
            const {
                name, call_name, breed, sex, color, weight_lbs,
                date_of_birth, status, role, is_intact,
                embark_id, embark_url, coi_percentage, genetic_tests,
                ofa_clearances, vet_records_current, vet_last_visit, health_notes,
                last_heat_date, avg_heat_cycle_days, heat_status,
                guardian_id, photo_url, pedigree_url, notes, source
            } = req.body;

            if (!name) {
                return res.status(400).json({ error: 'Dog name is required' });
            }

            const { data: dog, error } = await supabase
                .from('dogs')
                .insert({
                    user_id: userId,
                    name, call_name, breed: breed || 'Goldendoodle',
                    sex, color, weight_lbs,
                    date_of_birth, status: status || 'active',
                    role, is_intact: is_intact !== false,
                    embark_id, embark_url, coi_percentage, genetic_tests,
                    ofa_clearances, vet_records_current, vet_last_visit, health_notes,
                    last_heat_date, avg_heat_cycle_days, heat_status,
                    guardian_id, photo_url, pedigree_url, notes,
                    source: source || 'manual'
                })
                .select()
                .single();

            if (error) {
                console.error('Create dog error:', error);
                return res.status(500).json({ error: 'Failed to create dog', details: error.message });
            }

            return res.status(201).json({ success: true, dog });
        } catch (err) {
            console.error('POST dog error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
