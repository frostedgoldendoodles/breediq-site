// BreedIQ Auth — Password Reset Request (Supabase)
// Sends a password reset email via Supabase Auth
import { getAnonClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const supabase = getAnonClient();

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: 'https://breediq.ai/reset-password'
        });

        if (error) {
            console.error('Password reset error:', error);
            // Don't reveal whether the email exists — always return success
            return res.status(200).json({ success: true, message: 'If an account exists with that email, a reset link has been sent.' });
        }

        return res.status(200).json({ success: true, message: 'If an account exists with that email, a reset link has been sent.' });
    } catch (err) {
        console.error('Password reset error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
