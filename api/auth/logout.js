// BreedIQ Auth — Logout
//
// Two things this has to do, and previously did neither:
//
//  1. Require POST. With no method check, `<img src="/api/auth/logout">` on
//     any page signed the user out — small-stakes CSRF, but free to close.
//  2. Actually revoke the session. Clearing the cookies only removed the
//     browser's copy; the refresh token stayed valid on Supabase, so a copy
//     captured beforehand still minted access tokens after "signing out".
import { getAnonClient } from '../../lib/supabase.js';

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    header.split(';').forEach(c => {
        const [k, ...v] = c.trim().split('=');
        out[k] = v.join('=');
    });
    return out;
}

const EXPIRED = [
    'breediq_access_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure',
    'breediq_refresh_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure'
];

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = cookies['breediq_refresh_token'];

    // Revoke server-side. Best-effort: a failure here must not leave the user
    // stuck signed in locally, so the cookies are cleared either way.
    if (refreshToken) {
        try {
            const supabase = getAnonClient();
            await supabase.auth.setSession({ access_token: cookies['breediq_access_token'] || '', refresh_token: refreshToken });
            await supabase.auth.signOut();
        } catch (err) {
            console.error('Logout revoke failed:', err?.message);
        }
    }

    res.setHeader('Set-Cookie', EXPIRED);
    return res.status(200).json({ success: true });
}
