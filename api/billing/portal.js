// BreedIQ Billing — Create a Stripe Customer Portal session
// Requires the user to have a stripe_customer_id on their profile.
// If they don't (early accounts, stripe failure at signup), lazily create one.
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

// Where Stripe is allowed to send the user back to. The return_url used to be
// built from req.headers.origin, which any caller sets to anything — so the
// portal could be made to bounce a signed-in user to an attacker's page
// carrying Stripe's own referrer. Allowlist instead.
const ALLOWED_ORIGINS = new Set([
    'https://breediq.ai',
    'https://www.breediq.ai'
]);
const DEFAULT_ORIGIN = 'https://breediq.ai';

function safeOrigin(req) {
    const candidate = req.headers.origin;
    if (typeof candidate === 'string' && ALLOWED_ORIGINS.has(candidate)) return candidate;
    // Vercel preview deployments, so the portal is testable off production.
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (typeof host === 'string' && /^[a-z0-9-]+\.vercel\.app$/i.test(host)) {
        return `https://${host}`;
    }
    return DEFAULT_ORIGIN;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (!STRIPE_KEY) {
        return res.status(500).json({ error: 'Billing is not configured' });
    }

    const auth = await requireAuth(req, res);
    if (!auth) return;

    try {
        const supabase = getServiceClient();

        // Load profile to get (or create) the Stripe customer
        const { data: profile, error: profileErr } = await supabase
            .from('profiles')
            .select('id, email, full_name, stripe_customer_id')
            .eq('id', auth.user.id)
            .single();

        if (profileErr || !profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        let customerId = profile.stripe_customer_id;

        // Lazy-create a Stripe customer if missing
        if (!customerId) {
            const createResp = await fetch('https://api.stripe.com/v1/customers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${STRIPE_KEY}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    email: profile.email,
                    name: profile.full_name || '',
                    'metadata[supabase_user_id]': profile.id
                }).toString()
            });
            const customer = await createResp.json();
            if (!customer.id) {
                console.error('Stripe customer creation failed:', customer);
                return res.status(502).json({ error: 'Could not create billing account' });
            }
            customerId = customer.id;
            await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', profile.id);
        }

        // Create a portal session
        const returnUrl = `${safeOrigin(req)}/dashboard?view=settings`;

        const portalResp = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${STRIPE_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                customer: customerId,
                return_url: returnUrl
            }).toString()
        });

        const session = await portalResp.json();
        if (session.error) {
            console.error('Stripe portal session error:', session.error);
            return res.status(502).json({ error: session.error.message || 'Could not open billing portal' });
        }

        return res.status(200).json({ url: session.url });
    } catch (err) {
        console.error('Billing portal error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
