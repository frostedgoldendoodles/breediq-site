// BreedIQ — best-effort in-process rate limiting for serverless routes.
//
// This was living inline in api/contact.js, which meant contact was the only
// endpoint in the codebase with any throttle at all: /api/auth/login accepted
// unlimited password guesses, /api/auth/reset-password could be used to mail-
// bomb an address, and the two Anthropic-backed routes could be driven in a
// loop by any signed-in account.
//
// Scope and honesty about it: Vercel reuses a warm instance across requests,
// so this catches bursts from one caller against one instance. It does NOT
// hold across regions, cold starts, or concurrent instances. It raises the
// bar on casual abuse; it is not a substitute for a shared store (Upstash /
// Vercel KV) or a WAF rule if this ever needs a real guarantee.

const BUCKETS = new Map();

// Keep the process from growing without bound on a long-lived warm instance.
const MAX_KEYS = 5000;

function prune(now) {
    if (BUCKETS.size <= MAX_KEYS) return;
    for (const [k, rec] of BUCKETS) {
        if (now > rec.reset) BUCKETS.delete(k);
    }
    // Still oversized (all windows live) — drop oldest-resetting entries.
    if (BUCKETS.size > MAX_KEYS) {
        const sorted = [...BUCKETS.entries()].sort((a, b) => a[1].reset - b[1].reset);
        for (let i = 0; i < sorted.length - MAX_KEYS; i++) BUCKETS.delete(sorted[i][0]);
    }
}

// Caller identity for throttling. Prefer the authenticated user id when the
// route has one; fall back to the client IP. x-forwarded-for is spoofable in
// general, but on Vercel the platform appends the real peer, so the LAST
// entry is the trustworthy one — taking the first (as the old inline limiter
// did) lets a caller rotate the header and skip the limit entirely.
export function clientKey(req, userId) {
    if (userId) return `u:${userId}`;
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
        const parts = xff.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length) return `ip:${parts[parts.length - 1]}`;
    }
    return `ip:${req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown'}`;
}

// Returns { limited, retryAfter } — retryAfter in whole seconds.
export function hit(key, { windowMs, max }) {
    const now = Date.now();
    prune(now);
    const rec = BUCKETS.get(key);
    if (!rec || now > rec.reset) {
        BUCKETS.set(key, { count: 1, reset: now + windowMs });
        return { limited: false, retryAfter: 0 };
    }
    rec.count += 1;
    if (rec.count > max) {
        return { limited: true, retryAfter: Math.max(1, Math.ceil((rec.reset - now) / 1000)) };
    }
    return { limited: false, retryAfter: 0 };
}

// Convenience wrapper: throttles and writes the 429 itself.
// Returns true when the request was rejected — callers should `return`.
export function enforce(req, res, { name, windowMs, max, userId }) {
    const { limited, retryAfter } = hit(`${name}:${clientKey(req, userId)}`, { windowMs, max });
    if (!limited) return false;
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
        retry_after_seconds: retryAfter
    });
    return true;
}

// Shared budgets, in one place so they're reviewable together.
export const LIMITS = {
    // Credential endpoints — tight. Password guessing and mail-bombing.
    login:          { windowMs: 15 * 60_000, max: 10 },
    signup:         { windowMs: 60 * 60_000, max: 5 },
    passwordReset:  { windowMs: 60 * 60_000, max: 5 },
    passwordUpdate: { windowMs: 15 * 60_000, max: 10 },
    // Unauthenticated mail relay.
    contact:        { windowMs: 60_000, max: 5 },
    // Anthropic-backed routes — these cost real money per call.
    assistant:      { windowMs: 60_000, max: 15 },
    quickUpdate:    { windowMs: 60_000, max: 15 },
    onboarding:     { windowMs: 60_000, max: 5 }
};
