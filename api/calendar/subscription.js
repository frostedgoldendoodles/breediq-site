// BreedIQ — Calendar Subscription Management
//
// Manages the per-user token that gates the public ICS feed at
// /api/calendar/feed/:token.ics.
//
// GET    /api/calendar/subscription   → { connected, url, httpsUrl } (no token reveal if already set)
// POST   /api/calendar/subscription   → idempotent: creates token if missing, returns { url, httpsUrl }
// DELETE /api/calendar/subscription   → rotates: generates a new token, invalidates old subscribers
//
// The returned `url` is a webcal:// URL which most calendar apps (Apple,
// Outlook, Google with some nudging) treat as "add calendar subscription"
// when clicked. `httpsUrl` is the same URL over https:// as a fallback.

import crypto from 'node:crypto';
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

// 32 bytes of randomness → 43-char base64url string. Unguessable.
function generateToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function buildUrls(req, token) {
    // Prefer forwarded host (Vercel sets x-forwarded-host behind the proxy).
    const host =
        req.headers['x-forwarded-host'] ||
        req.headers.host ||
        'breediq.ai';
    const path = `/api/calendar/feed/${token}.ics`;
    return {
        url: `webcal://${host}${path}`,
        httpsUrl: `https://${host}${path}`
    };
}

export default async function handler(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getServiceClient();
    const userId = auth.user.id;

    try {
        if (req.method === 'GET') {
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('calendar_feed_token')
                .eq('id', userId)
                .maybeSingle();

            if (error) {
                console.error('Subscription GET error:', error);
                return res.status(500).json({ error: 'Failed to load subscription' });
            }

            if (!profile || !profile.calendar_feed_token) {
                return res.status(200).json({ connected: false });
            }

            const urls = buildUrls(req, profile.calendar_feed_token);
            return res.status(200).json({ connected: true, ...urls });
        }

        if (req.method === 'POST') {
            // Idempotent connect: return existing token if present, else create.
            const { data: existing, error: loadErr } = await supabase
                .from('profiles')
                .select('calendar_feed_token')
                .eq('id', userId)
                .maybeSingle();

            if (loadErr) {
                console.error('Subscription POST load error:', loadErr);
                return res.status(500).json({ error: 'Failed to load profile' });
            }

            let token = existing && existing.calendar_feed_token;
            if (!token) {
                token = generateToken();
                const { error: updateErr } = await supabase
                    .from('profiles')
                    .update({ calendar_feed_token: token, updated_at: new Date().toISOString() })
                    .eq('id', userId);

                if (updateErr) {
                    console.error('Subscription POST update error:', updateErr);
                    return res.status(500).json({ error: 'Failed to create subscription' });
                }
            }

            const urls = buildUrls(req, token);
            return res.status(200).json({ connected: true, ...urls });
        }

        if (req.method === 'DELETE') {
            // Rotate: always generate a new token, invalidating any existing subscribers.
            const token = generateToken();
            const { error: updateErr } = await supabase
                .from('profiles')
                .update({ calendar_feed_token: token, updated_at: new Date().toISOString() })
                .eq('id', userId);

            if (updateErr) {
                console.error('Subscription DELETE (rotate) error:', updateErr);
                return res.status(500).json({ error: 'Failed to rotate subscription' });
            }

            const urls = buildUrls(req, token);
            return res.status(200).json({ connected: true, rotated: true, ...urls });
        }

        res.setHeader('Allow', 'GET, POST, DELETE');
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('Subscription handler error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
