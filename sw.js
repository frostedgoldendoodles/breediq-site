// BreedIQ — service worker
// ---------------------------------------------------------
// Goal: make the site installable as a PWA + serve a usable
// offline shell. Live data (anything under /api/) MUST always
// hit the network so we never show stale dogs/litters.
//
// Strategy:
//   1. Pre-cache the core navigation pages on install so the
//      app opens immediately on a flaky connection.
//   2. /api/* requests bypass the cache entirely (network-only).
//   3. Same-origin GETs for static assets use stale-while-revalidate:
//      serve from cache if we have it, refresh in the background.
//   4. Bump CACHE_VERSION when we ship a new build to force
//      old caches to be cleaned up.

// Two independently-versioned caches:
//   SHELL  — HTML/JS that changes on most deploys. Bump SHELL_VERSION any
//            time PWA users need to drop their cached client bundle (e.g.
//            ask-breediq.js after a chat fix).
//   ASSET  — icons/fonts/immutable static files that rarely change. Bump
//            ASSET_VERSION only when those actually change. Keeping it
//            separate means a routine JS deploy no longer evicts the asset
//            cache, so icons/css don't re-download for every returning user
//            after every deploy.
const SHELL_VERSION = 'breediq-shell-v6';
const ASSET_VERSION = 'breediq-asset-v1';
const SHELL_CACHE = SHELL_VERSION;
const ASSET_CACHE = ASSET_VERSION;
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE];

// Pre-cached so the home screen icon → first paint works offline.
// Keep this list small — these load on install for everyone.
const SHELL_URLS = [
    '/',
    '/dashboard',
    '/login',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) =>
            // Use individual `add` calls so one 404 doesn't fail the whole install
            Promise.all(SHELL_URLS.map((url) =>
                cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
            ))
        )
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    // Delete only caches we no longer reference. A shell-version
                    // bump leaves the current asset cache intact and vice-versa.
                    .filter((k) => !CURRENT_CACHES.includes(k))
                    .map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Only handle GETs — POSTs go straight to the network.
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Same-origin only — don't intercept Supabase/Stripe/Anthropic, etc.
    if (url.origin !== self.location.origin) return;

    // API: always network. We never want to serve stale records.
    if (url.pathname.startsWith('/api/')) return;

    // Navigation requests (clicking a link, typing a URL) — try network
    // first so users get fresh HTML. Fall back to the cached shell so
    // the app still opens offline.
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
                    return res;
                })
                .catch(() =>
                    caches.match(req).then((cached) =>
                        cached || caches.match('/dashboard') || caches.match('/')
                    )
                )
        );
        return;
    }

    // Static assets — stale-while-revalidate.
    event.respondWith(
        caches.open(ASSET_CACHE).then((cache) =>
            cache.match(req).then((cached) => {
                const fetchPromise = fetch(req)
                    .then((res) => {
                        if (res && res.status === 200 && res.type === 'basic') {
                            cache.put(req, res.clone());
                        }
                        return res;
                    })
                    .catch(() => cached);
                return cached || fetchPromise;
            })
        )
    );
});
