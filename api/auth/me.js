// BreedIQ Auth - Get current user
import crypto from 'crypto';
const JWT_SECRET = process.env.JWT_SECRET;

function verifyJWT(token) {
    try {
        const [header, body, signature] = token.split('.');
        const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
        if (signature !== expected) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (e) { return null; }
}

function parseCookies(h) {
    const c = {};
    if (!h) return c;
    h.split(';').forEach(s => { const [k, ...v] = s.trim().split('='); c[k] = v.join('='); });
    return c;
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.breediq_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const user = verifyJWT(token);
    if (!user) {
        res.setHeader('Set-Cookie', 'breediq_token=; Path=/; HttpOnly; Max-Age=0');
        return res.status(401).json({ error: 'Session expired' });
    }
    return res.status(200).json({ user: { id: user.sub, email: user.email, name: user.name, plan: user.plan } });
}
