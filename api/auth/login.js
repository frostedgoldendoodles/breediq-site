// BreedIQ Auth - Login
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
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    try {
        const searchResp = await fetch(`https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(email)}'`, {
            headers: { 'Authorization': `Bearer ${STRIPE_KEY}` }
        });
        const searchData = await searchResp.json();
        if (!searchData.data || searchData.data.length === 0) {
            return res.status(401).json({ error: 'No account found with this email. Please sign up first.' });
        }
        const customer = searchData.data[0];
        const salt = customer.metadata?.password_salt;
        const storedHash = customer.metadata?.password_hash;
        if (!salt || !storedHash) return res.status(401).json({ error: 'Account setup incomplete. Please sign up again.' });
        const hash = await hashPassword(password, salt);
        if (hash !== storedHash) return res.status(401).json({ error: 'Incorrect password. Please try again.' });
        const subsResp = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=active&limit=1`, {
            headers: { 'Authorization': `Bearer ${STRIPE_KEY}` }
        });
        const subsData = await subsResp.json();
        const plan = subsData.data && subsData.data.length > 0 ? customer.metadata.plan || 'pro' : customer.metadata.plan || 'starter';
        const token = createJWT({ sub: customer.id, email: customer.email, name: customer.name || '', plan });
        res.setHeader('Set-Cookie', `breediq_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60*60*24*30}; Secure`);
        return res.status(200).json({ success: true, user: { id: customer.id, email: customer.email, name: customer.name, plan } });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error', message: err.message });
    }
}
