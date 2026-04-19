// BreedIQ Auth — Delete Account
// Permanently deletes the authenticated user's Supabase Auth entry,
// which cascades to the public.profiles row (ON DELETE CASCADE),
// which cascades to all their dogs, litters, guardians, files, and scores.
// Stripe customer is left intact for billing history; subscription should be
// cancelled by the user via the billing portal before calling this.
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    // Accept POST (with confirmation in body) to avoid accidental DELETEs via prefetch
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = await requireAuth(req, res);
    if (!auth) return;

    const { confirm_email } = req.body || {};
    if (!confirm_email || confirm_email.toLowerCase().trim() !== (auth.user.email || '').toLowerCase().trim()) {
        return res.status(400).json({ error: 'Email confirmation does not match.' });
    }

    try {
        const supabase = getServiceClient();

        // Delete the auth user — cascades via FK to the profile and all child rows
        const { error } = await supabase.auth.admin.deleteUser(auth.user.id);
        if (error) {
            console.error('Delete user error:', error);
            return res.status(500).json({ error: error.message || 'Could not delete account' });
        }

        // Clear cookies
        res.setHeader('Set-Cookie', [
            'breediq_access_token=; Path=/; HttpOnly; Max-Age=0; Secure',
            'breediq_refresh_token=; Path=/; HttpOnly; Max-Age=0; Secure'
        ]);

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('Delete account error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
