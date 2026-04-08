// BreedIQ Auth — Login (Supabase)
// Authenticates user and sets session cookies
import { getAnonClient, getServiceClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    try {
        const supabase = getAnonClient();

        // Sign in with Supabase Auth
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            if (error.message.includes('Invalid login')) {
                return res.status(401).json({ error: 'Incorrect email or password. Please try again.' });
            }
            return res.status(401).json({ error: error.message });
        }

        const { user, session } = data;

        // Get profile data (plan, kennel name, etc.)
        const serviceClient = getServiceClient();
        const { data: profile } = await serviceClient
            .from('profiles')
            .select('plan, kennel_name, full_name, onboarding_completed')
            .eq('id', user.id)
            .single();

        // Set auth cookies
        const maxAge = 60 * 60 * 24 * 30; // 30 days
        res.setHeader('Set-Cookie', [
            `breediq_access_token=${session.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`,
            `breediq_refresh_token=${session.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`
        ]);

        return res.status(200).json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: profile?.full_name || user.user_metadata?.full_name || '',
                plan: profile?.plan || 'starter',
                kennel_name: profile?.kennel_name || '',
                onboarding_completed: profile?.onboarding_completed || false
            },
            access_token: session.access_token
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Internal server error', message: err.message });
    }
}
