// BreedIQ Auth — Get/Update current user (Supabase)
// GET: Returns user profile with stats
// PUT: Updates user profile fields
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

// Fields users are allowed to update via PUT
const ALLOWED_FIELDS = ['full_name', 'kennel_name', 'phone', 'timezone', 'onboarding_completed', 'notification_prefs'];

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'PUT') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = await requireAuth(req, res);
    if (!auth) return; // 401 already sent

    try {
        const supabase = getServiceClient();

        // --- PUT: Update profile ---
        if (req.method === 'PUT') {
            const updates = {};
            for (const field of ALLOWED_FIELDS) {
                if (req.body[field] !== undefined) {
                    updates[field] = req.body[field];
                }
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'No valid fields to update. Allowed: ' + ALLOWED_FIELDS.join(', ') });
            }

            updates.updated_at = new Date().toISOString();

            const { data: profile, error } = await supabase
                .from('profiles')
                .update(updates)
                .eq('id', auth.user.id)
                .select('*')
                .single();

            if (error) {
                console.error('Profile update error:', error);
                return res.status(400).json({ error: error.message });
            }

            return res.status(200).json({
                success: true,
                user: {
                    id: profile.id,
                    email: profile.email,
                    name: profile.full_name,
                    kennel_name: profile.kennel_name,
                    phone: profile.phone,
                    timezone: profile.timezone,
                    plan: profile.plan,
                    onboarding_completed: profile.onboarding_completed,
                    notification_prefs: profile.notification_prefs,
                    updated_at: profile.updated_at
                }
            });
        }

        // --- GET: Return profile + stats ---
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', auth.user.id)
            .single();

        if (error || !profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        const { count: dogCount } = await supabase
            .from('dogs')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', auth.user.id);

        const { count: litterCount } = await supabase
            .from('litters')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', auth.user.id)
            .in('status', ['confirmed', 'born', 'available']);

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
                phone: profile.phone,
                timezone: profile.timezone,
                plan: profile.plan,
                stripe_customer_id: profile.stripe_customer_id,
                onboarding_completed: profile.onboarding_completed,
                notification_prefs: profile.notification_prefs,
                created_at: profile.created_at
            },
            stats: {
                dogs: dogCount || 0,
                active_litters: litterCount || 0,
                guardians: guardianCount || 0
            }
        });
    } catch (err) {
        console.error('Auth me error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
