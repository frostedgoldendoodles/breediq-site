// BreedIQ Auth — Get current user (Supabase)
// Returns user profile from session cookie or Authorization header
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const auth = await requireAuth(req, res);
    if (!auth) return; // 401 already sent

    try {
        const supabase = getServiceClient();

        // Get full profile
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', auth.user.id)
            .single();

        if (error || !profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        // Get dog count
        const { count: dogCount } = await supabase
            .from('dogs')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', auth.user.id);

        // Get active litter count
        const { count: litterCount } = await supabase
            .from('litters')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', auth.user.id)
            .in('status', ['confirmed', 'born', 'available']);

        // Get guardian count
        const { count: guardianCount } = await supabase
            .from('guardians')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', auth.user.id)
            .eq('status', 'active');

        return res.status(200).json({
            user: {
                id: profile.id,
                email: profile.email,
                name: profile.full_name,
                kennel_name: profile.kennel_name,
                plan: profile.plan,
                onboarding_completed: profile.onboarding_completed,
                created_at: profile.created_at
            },
            stats: {
                dogs: dogCount || 0,
                active_litters: litterCount || 0,
                guardians: guardianCount || 0
            }
        });
    } catch (err) {
        console.error('Get user error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
