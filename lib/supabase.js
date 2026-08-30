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

// Require authentication — returns user or sends 401.
//
// Also stamps Cache-Control: no-store on every authenticated response.
// Without it these routes inherit Vercel's default for functions, which
// makes per-user JSON revalidatable — production logs show real 304s on
// /api/auth/me, /api/litters/calendar and /api/calendar/subscription,
// meaning the browser was serving its own cached copy of one account's
// private data. At best that shows a breeder stale records after they add
// something; at worst a shared/proxied cache serves the wrong account.
// Setting it here covers every authenticated route at once, and leaves the
// public ICS feed (which is token-gated, not requireAuth'd, and *wants*
// private, max-age=3600) alone.
export async function requireAuth(req, res) {
    if (res && typeof res.setHeader === 'function' && !res.headersSent) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.setHeader('Vary', 'Cookie');
    }
    const { user, token, error } = await getUser(req, res);
    if (!user) {
        res.status(401).json({ error: error || 'Authentication required' });
        return null;
    }
    return { user, token };
}

// ─────────────────────────── Filter-input sanitizing ─────────────────────
// PostgREST treats commas, parens, dots, colons and asterisks as filter
// syntax. When user/model-supplied text is interpolated into an `.or()` or
// `.ilike()` string, those characters can corrupt the filter (400/500s) or
// rearrange the OR group. This strips them so the value is treated as a plain
// search term. Tenant isolation does NOT depend on this — every such query is
// AND-combined with a separate user-scope filter — but it removes the
// malformed-query / within-tenant filter-manipulation surface.
export function sanitizeFilterValue(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[,()*:.\\%]/g, ' ').trim().slice(0, 100);
}

// ─────────────────────────── Program-owner scope ─────────────────────────
// Returns the list of user_ids the caller should be able to read across:
// themselves plus any active sub-breeders linked via breeder_relationships.
// API routes use this to scope GET/list queries so a program owner can view
// their sub-breeders' dogs, litters, and guardians (matching the dashboard's
// combined view). Writes still target a unique row by id and the per-route
// authorization layer can decide whether the program owner is allowed to
// modify sub-breeder records.
//
// Always returns at least [ownerUserId]. On any error fetching relationships
// (network, schema), falls back to owner-only — fail-closed.
export async function getProgramUserIds(supabase, ownerUserId) {
    if (!ownerUserId) return [];
    try {
        const { data, error } = await supabase
            .from('breeder_relationships')
            .select('breeder_id')
            .eq('owner_id', ownerUserId)
            .eq('status', 'active');
        if (error) {
            console.error('getProgramUserIds error:', error.message);
            return [ownerUserId];
        }
        const ids = (data || []).map(r => r.breeder_id).filter(Boolean);
        return [ownerUserId, ...ids];
    } catch (e) {
        console.error('getProgramUserIds exception:', e.message);
        return [ownerUserId];
    }
}

// ─────────────────────────── Dog photo URL signing ────────────────────────
// The `dog-photos` bucket is private. Rows store either a storage path
// (`{user_id}/{dog_id}-{ts}.jpg`) or a legacy external URL. This helper mints
// short-lived signed URLs so the browser can render images without the
// bucket being publicly readable.
const DOG_PHOTOS_BUCKET = 'dog-photos';
// 7 days. Was 1 hour, which defeated the photos' 1-year storage cache-control:
// every API read minted a fresh signed URL with a new query string, so the
// browser cache missed and re-downloaded the full image on every refetch. A
// long TTL lets the same URL (and the browser cache) survive across reads.
const DOG_PHOTO_SIGNED_URL_EXPIRY = 60 * 60 * 24 * 7;

// Returns the storage path if the value points at our private bucket;
// returns null if it's an external URL (leave it unchanged in that case).
export function extractDogPhotoPath(photoUrl) {
    if (!photoUrl || typeof photoUrl !== 'string') return null;
    if (!/^https?:\/\//i.test(photoUrl)) return photoUrl; // already a path
    try {
        const u = new URL(photoUrl);
        const m = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/dog-photos\/(.+)$/);
        return m ? decodeURIComponent(m[1]) : null;
    } catch {
        return null;
    }
}

// Batch-sign photo URLs for a list of dog rows. Mutates each row's
// `photo_url` in place: private paths become signed URLs, external URLs pass
// through, unresolvable paths become null.
export async function attachSignedPhotoUrls(client, dogs) {
    if (!Array.isArray(dogs) || dogs.length === 0) return dogs;
    const pathsToSign = [];
    const slotByPath = new Map();

    dogs.forEach((dog, idx) => {
        if (!dog?.photo_url) return;
        const path = extractDogPhotoPath(dog.photo_url);
        if (path === null) return; // external URL — leave alone
        if (!slotByPath.has(path)) {
            slotByPath.set(path, []);
            pathsToSign.push(path);
        }
        slotByPath.get(path).push(idx);
    });

    if (pathsToSign.length === 0) return dogs;

    const { data, error } = await client.storage
        .from(DOG_PHOTOS_BUCKET)
        .createSignedUrls(pathsToSign, DOG_PHOTO_SIGNED_URL_EXPIRY);

    if (error) {
        console.error('Failed to sign dog photo URLs:', error);
        // Don't leak the private path to the client if signing failed.
        for (const indexes of slotByPath.values()) {
            indexes.forEach(i => { dogs[i].photo_url = null; });
        }
        return dogs;
    }

    const signedByPath = new Map();
    (data || []).forEach(row => {
        if (row?.path && row.signedUrl) signedByPath.set(row.path, row.signedUrl);
    });
    for (const [path, indexes] of slotByPath.entries()) {
        const signed = signedByPath.get(path) || null;
        indexes.forEach(i => { dogs[i].photo_url = signed; });
    }
    return dogs;
}

// Convenience single-dog version
export async function attachSignedPhotoUrl(client, dog) {
    if (!dog) return dog;
    await attachSignedPhotoUrls(client, [dog]);
    return dog;
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
