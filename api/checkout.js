// BreedIQ - Create Stripe Checkout session for plan upgrades
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

function verifyJWT(token) {
    try {
        const [header, body, signature] = token.split('.');
        const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
        if (signature !== expected) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(c => {
        const [key, ...val] = c.trim().split('=');
        cookies[key] = val.join('=');
    });
    return cookies;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Verify auth
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.breediq_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const user = verifyJWT(token);
    if (!user) return res.status(401).json({ error: 'Session expired' });

    const { priceId } = req.body;
    if (!priceId) return res.status(400).json({ error: 'Price ID required' });

    try {
        // Create Stripe Checkout session
        const params = new URLSearchParams({
            'customer': user.sub,
            'mode': 'subscription',
            'success_url': `${req.headers.origin || 'https://breediq.ai'}/dashboard?upgraded=true`,
            'cancel_url': `${req.headers.origin || 'https://breediq.ai'}/dashboard`,
            'line_items[0][price]': priceId,
            'line_items[0][quantity]': '1',
            'subscription_data[trial_period_days]': '14'
        });

        const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${STRIPE_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        const session = await resp.json();
        if (session.error) {
            return res.status(500).json({ error: session.error.message });
        }

        return res.status(200).json({ url: session.url });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error', message: err.message });
    }
}
