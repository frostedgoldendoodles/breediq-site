// BreedIQ — Supabase client for Vercel serverless functions
// Used by all API routes for database queries and auth verification
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Service client — full admin access, used server-side only
export function getServiceClient() {
    return createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
}

// Anon client — respects RLS, used when acting as a specific user
export function getAnonClient() {
    return createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
}

// Create a client authenticated as a specific user (for RLS)
export function getUserClient(accessToken) {
    return createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } }
    });
}

// Write fresh auth cookies on the outgoing response. Used by the silent
// refresh path in getUser() so clients never notice an expired access token.
function setAuthCookies(res, accessToken, refreshToken) {
    if (!res || typeof res.setHeader !== 'function') return;
    res.setHeader('Set-Cookie', [
        `breediq_access_token=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}; Secure`,
        `breediq_refresh_token=${refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}; Secure`
    ]);
}

// Extract and verify user from request (cookie or Authorization header).
// If the access token is expired but a refresh_token cookie is present,
// transparently refresh the session and rewrite the cookies on `res`.
export async function getUser(req, res) {
    const cookies = parseCookies(req.headers.cookie);
    let token = null;

    // Try Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }

    // Fall back to cookie
    if (!token) {
        token = cookies['breediq_access_token'];
    }

    if (!token && !cookies['breediq_refresh_token']) {
        return { user: null, error: 'No authentication token found' };
    }

    const supabase = getServiceClient();
    let user = null;
    let error = null;

    if (token) {
        const result = await supabase.auth.getUser(token);
        user = result.data?.user || null;
        error = result.error || null;
    }

    // Silent refresh: if access token is missing/invalid/expired and we have
    // a refresh_token cookie, trade it in for a new session.
    if ((!user || error) && cookies['breediq_refresh_token']) {
        const refreshClient = getAnonClient();
        const { data: refreshData, error: refreshError } =
            await refreshClient.auth.refreshSession({ refresh_token: cookies['breediq_refresh_token'] });

        if (!refreshError && refreshData?.session?.access_token && refreshData?.user) {
            token = refreshData.session.access_token;
            user = refreshData.user;
            error = null;
            setAuthCookies(res, refreshData.session.access_token, refreshData.session.refresh_token);
        }
    }

    if (error || !user) {
        return { user: null, error: error?.message || 'Invalid or expired token' };
    }

    return { user, token, error: null };
}

// Require authentication — returns user or sends 401
export async function requireAuth(req, res) {
    const { user, token, error } = await getUser(req, res);
    if (!user) {
        res.status(401).json({ error: error || 'Authentication required' });
        return null;
    }
    return { user, token };
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
