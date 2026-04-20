// BreedIQ — Dog photo upload/delete
// The `dog-photos` bucket is private and requires authentication. The
// browser compresses the image and POSTs it here (base64); this endpoint
// verifies ownership, uploads using the service role, persists the storage
// path on the dog row, and returns a fresh signed URL for preview.
import {
    requireAuth,
    getServiceClient,
    extractDogPhotoPath,
    attachSignedPhotoUrl
} from '../../../lib/supabase.js';

export const config = {
    api: {
        bodyParser: { sizeLimit: '2mb' }
    }
};

const BUCKET = 'dog-photos';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_BY_MIME = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

export default async function handler(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Dog ID is required' });

    const supabase = getServiceClient();
    const userId = auth.user.id;

    // Verify ownership before touching storage — no cross-tenant writes.
    const { data: dog, error: ownerErr } = await supabase
        .from('dogs')
        .select('id, user_id, photo_url')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

    if (ownerErr || !dog) {
        return res.status(404).json({ error: 'Dog not found' });
    }

    if (req.method === 'POST') {
        try {
            const { content, contentType } = req.body || {};
            if (!content) return res.status(400).json({ error: 'content (base64) is required' });
            if (!contentType || !ALLOWED_MIME.has(contentType)) {
                return res.status(400).json({ error: 'Unsupported contentType. Use jpeg, png, webp, or gif.' });
            }

            const buffer = Buffer.from(content, 'base64');
            if (buffer.length === 0) return res.status(400).json({ error: 'Empty file' });
            if (buffer.length > 5 * 1024 * 1024) {
                return res.status(413).json({ error: 'File too large after compression (>5 MB).' });
            }

            const ext = EXT_BY_MIME[contentType];
            const path = `${userId}/${id}-${Date.now()}.${ext}`;

            const { error: uploadErr } = await supabase.storage
                .from(BUCKET)
                .upload(path, buffer, {
                    contentType,
                    cacheControl: '31536000',
                    upsert: false
                });

            if (uploadErr) {
                console.error('Dog photo upload failed:', uploadErr);
                return res.status(500).json({ error: 'Upload failed', details: uploadErr.message });
            }

            // Best-effort cleanup of the previous photo (ignore failures).
            const oldPath = extractDogPhotoPath(dog.photo_url);
            if (oldPath && !/^https?:/i.test(dog.photo_url)) {
                await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
            }

            const { data: updated, error: updateErr } = await supabase
                .from('dogs')
                .update({ photo_url: path, updated_at: new Date().toISOString() })
                .eq('id', id)
                .eq('user_id', userId)
                .select()
                .single();

            if (updateErr) {
                // Upload succeeded but DB write failed — roll back storage so we
                // don't orphan the blob.
                await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
                return res.status(500).json({ error: 'Failed to save photo record' });
            }

            await attachSignedPhotoUrl(supabase, updated);
            return res.status(200).json({ success: true, dog: updated });
        } catch (err) {
            console.error('Dog photo POST error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const path = extractDogPhotoPath(dog.photo_url);
            if (path && !/^https?:/i.test(dog.photo_url)) {
                await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
            }
            const { error: updateErr } = await supabase
                .from('dogs')
                .update({ photo_url: null, updated_at: new Date().toISOString() })
                .eq('id', id)
                .eq('user_id', userId);
            if (updateErr) return res.status(500).json({ error: 'Failed to clear photo' });
            return res.status(200).json({ success: true });
        } catch (err) {
            console.error('Dog photo DELETE error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
