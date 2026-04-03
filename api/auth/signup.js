// BreedIQ Auth - Signup
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

async function hashPassword(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derived) => {
            if (err) reject(err);
            resolve(derived.toString('hex'));
        });
    });
}

function createJWT(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 })).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    try {
        const searchResp = await fetch(`https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(email)}'`, {
            headers: { 'Authorization': `Bearer ${STRIPE_KEY}` }
        });
        const searchData = await searchResp.json();
        if (searchData.data && searchData.data.length > 0) {
            return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
        }
        const salt = crypto.randomBytes(32).toString('hex');
        const hash = await hashPassword(password, salt);
        const customerResp = await fetch('https://api.stripe.com/v1/customers', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ email, name: name || '', 'metadata[password_hash]': hash, 'metadata[password_salt]': salt, 'metadata[plan]': 'starter', 'metadata[created_at]': new Date().toISOString() }).toString()
        });
        const customer = await customerResp.json();
        if (customer.error) return res.status(500).json({ error: 'Failed to create account', details: customer.error.message });
        const token = createJWT({ sub: customer.id, email: customer.email, name: customer.name || '', plan: 'starter' });
        res.setHeader('Set-Cookie', `breediq_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60*60*24*30}; Secure`);
        return res.status(200).json({ success: true, user: { id: customer.id, email: customer.email, name: customer.name, plan: 'starter' } });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error', message: err.message });
    }
}
