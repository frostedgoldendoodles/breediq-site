// BreedIQ Auth — Sign Up (Supabase)
// Creates user in Supabase Auth, auto-creates profile via DB trigger,
// then creates a Stripe customer and links them.
import { getServiceClient } from '../../lib/supabase.js';

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    try {
        const supabase = getServiceClient();

        // 1. Create user in Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // Auto-confirm for now (can add email verification later)
            user_metadata: { full_name: name || '' }
        });

        if (authError) {
            if (authError.message.includes('already been registered')) {
                return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
            }
            return res.status(400).json({ error: authError.message });
        }

        const userId = authData.user.id;

        // 2. Create Stripe customer (for future billing)
        if (STRIPE_KEY) {
            try {
                const stripeResp = await fetch('https://api.stripe.com/v1/customers', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${STRIPE_KEY}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams({
                        email,
                        name: name || '',
                        'metadata[supabase_user_id]': userId,
                        'metadata[plan]': 'starter'
                    }).toString()
                });
                const customer = await stripeResp.json();

                if (customer.id) {
                    // Link Stripe customer to profile
                    await supabase.from('profiles').update({
                        stripe_customer_id: customer.id,
                        full_name: name || ''
                    }).eq('id', userId);
                }
            } catch (stripeErr) {
                // Non-fatal — Stripe link can happen later
                console.error('Stripe customer creation failed:', stripeErr.message);
            }
        }

        // 3. Sign in to get session tokens
        const { data: signInData, error: signInError } = await supabase.auth.admin.generateLink({
            type: 'magiclink',
            email
        });

        // Use signInWithPassword to get proper session
        // We use the service client to create a session for the user
        const anonSupabase = (await import('../../lib/supabase.js')).getAnonClient();
        const { data: session, error: sessionError } = await anonSupabase.auth.signInWithPassword({
            email,
            password
        });

        if (sessionError) {
            // User was created but session failed — they can log in manually
            return res.status(200).json({
                success: true,
                message: 'Account created. Please sign in.',
                user: { id: userId, email, name: name || '', plan: 'starter' }
            });
        }

        // 4. Set auth cookies
        const accessToken = session.session.access_token;
        const refreshToken = session.session.refresh_token;
        const maxAge = 60 * 60 * 24 * 30; // 30 days

        res.setHeader('Set-Cookie', [
            `breediq_access_token=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`,
            `breediq_refresh_token=${refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`
        ]);

        return res.status(200).json({
            success: true,
            user: {
                id: userId,
                email,
                name: name || '',
                plan: 'starter'
            },
            access_token: accessToken
        });
    } catch (err) {
        console.error('Signup error:', err);
        return res.status(500).json({ error: 'Internal server error', message: err.message });
    }
}
