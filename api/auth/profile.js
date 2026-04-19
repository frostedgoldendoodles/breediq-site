// BreedIQ Auth — Update Profile (Supabase)
// Allows authenticated users to update their own profile fields
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

// Fields users are allowed to update
const ALLOWED_FIELDS = ['full_name', 'kennel_name', 'phone', 'timezone', 'onboarding_completed'];

export default async function handler(req, res) {
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

    const auth = await requireAuth(req, res);
    if (!auth) return; // 401 already sent

    try {
        const supabase = getServiceClient();

        // Filter to only allowed fields
        const updates = {};
        for (const field of ALLOWED_FIELDS) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update. Allowed: ' + ALLOWED_FIELDS.join(', ') });
        }

        // Always set updated_at
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
                updated_at: profile.updated_at
            }
        });
    } catch (err) {
        console.error('Profile update error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
