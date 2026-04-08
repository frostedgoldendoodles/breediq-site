// BreedIQ — Supabase client for Vercel serverless functions
// Used by all API routes for database queries and auth verification
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

// Service client — full admin access, used server-side only
export function getServiceClient() {
    return createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
}

// Anon client — respects RLS, used when acting as a specific user
export function getAnonClient() {
    return createClient(supabaseUrl, supabaseAnonKey);
}

// Create a client authenticated as a specific user (for RLS)
export function getUserClient(accessToken) {
    return createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } }
    });
}

// Extract and verify user from request (cookie or Authorization header)
export async function getUser(req) {
    // Check for access token in cookie or Authorization header
    let token = null;

    // Try Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }

    // Fall back to cookie
    if (!token) {
        const cookies = parseCookies(req.headers.cookie);
        token = cookies['breediq_access_token'];
    }

    if (!token) return { user: null, error: 'No authentication token found' };

    const supabase = getServiceClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        return { user: null, error: error?.message || 'Invalid or expired token' };
    }

    return { user, token, error: null };
}

// Require authentication — returns user or sends 401
export async function requireAuth(req, res) {
    const { user, token, error } = await getUser(req);
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
