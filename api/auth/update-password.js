// BreedIQ Auth — Update Password (Supabase)
// Called from the reset-password page after user clicks the email link
import { getAnonClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { access_token, password } = req.body;
    if (!access_token) return res.status(400).json({ error: 'Missing access token' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    try {
        // Create a Supabase client authenticated with the recovery token
        const supabase = getAnonClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token,
            refresh_token: '' // Not needed for password update
        });

        if (sessionError) {
            console.error('Session error:', sessionError);
            return res.status(401).json({ error: 'Invalid or expired reset link. Please request a new one.' });
        }

        // Update the user's password
        const { error: updateError } = await supabase.auth.updateUser({ password });

        if (updateError) {
            console.error('Password update error:', updateError);
            return res.status(400).json({ error: updateError.message });
        }

        return res.status(200).json({ success: true, message: 'Password updated successfully.' });
    } catch (err) {
        console.error('Update password error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
