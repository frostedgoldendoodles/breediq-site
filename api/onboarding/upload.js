// BreedIQ Onboarding — File Upload
// Accepts file uploads, stores in Supabase Storage, records in files table
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

// What the AI onboarding step can actually read. Anything else was previously
// accepted, stored as file_type 'other', and never used.
const ALLOWED_EXT = new Map([
    ['jpg', 'image'], ['jpeg', 'image'], ['png', 'image'], ['gif', 'image'],
    ['webp', 'image'], ['heic', 'image'],
    ['pdf', 'pdf'],
    ['csv', 'spreadsheet'], ['xlsx', 'spreadsheet'], ['xls', 'spreadsheet'],
    ['txt', 'text'], ['md', 'text'], ['rtf', 'text'], ['doc', 'text'], ['docx', 'text']
]);

const MIME_BY_EXT = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf',
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    txt: 'text/plain', md: 'text/markdown', rtf: 'application/rtf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

const MAX_BYTES = 8 * 1024 * 1024;

// The raw client filename used to be interpolated straight into the storage
// key (`${userId}/${Date.now()}_${filename}`), so path segments in it could
// walk outside the caller's own prefix. Keep the original name for display,
// but build the key from a scrubbed basename.
function safeBaseName(filename) {
    const base = String(filename).split(/[\\/]/).pop() || 'upload';
    return base
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .replace(/^\.+/, '')
        .slice(0, 100) || 'upload';
}

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb'
        }
    }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = await requireAuth(req, res);
    if (!auth) return;

    try {
        const { filename, content } = req.body || {};

        if (!filename || typeof filename !== 'string' || !content) {
            return res.status(400).json({ error: 'filename and content (base64) are required' });
        }

        const cleanName = safeBaseName(filename);
        const fileExt = cleanName.includes('.') ? cleanName.split('.').pop().toLowerCase() : '';
        const fileType = ALLOWED_EXT.get(fileExt);
        if (!fileType) {
            return res.status(415).json({
                error: 'Unsupported file type. Upload images, PDFs, spreadsheets, or text documents.'
            });
        }

        const supabase = getServiceClient();
        const userId = auth.user.id;
        const fileBuffer = Buffer.from(content, 'base64');
        if (fileBuffer.length === 0) return res.status(400).json({ error: 'Empty file' });
        if (fileBuffer.length > MAX_BYTES) {
            return res.status(413).json({ error: 'File too large (max 8 MB).' });
        }

        // Content type is derived from the (validated) extension rather than
        // taken from the client, so the stored object can't claim to be
        // something it isn't.
        const resolvedMimeType = MIME_BY_EXT[fileExt] || 'application/octet-stream';

        // Storage key is fully server-constructed.
        const storagePath = `${userId}/${Date.now()}_${cleanName}`;
        const { error: uploadError } = await supabase.storage
            .from('uploads')
            .upload(storagePath, fileBuffer, {
                contentType: resolvedMimeType,
                upsert: false
            });

        if (uploadError) {
            console.error('Onboarding upload failed:', uploadError);
            return res.status(500).json({ error: 'File upload failed' });
        }

        // Record file in database
        const { data: fileRecord, error: dbError } = await supabase
            .from('files')
            .insert({
                user_id: userId,
                filename: cleanName,
                file_type: fileType,
                mime_type: resolvedMimeType,
                file_size: fileBuffer.length,
                storage_path: storagePath,
                processing_status: 'pending',
                purpose: 'onboarding'
            })
            .select()
            .single();

        if (dbError) {
            console.error('Onboarding file record failed:', dbError);
            return res.status(500).json({ error: 'Failed to save file record' });
        }

        return res.status(200).json({
            success: true,
            file: {
                id: fileRecord.id,
                filename: fileRecord.filename,
                type: fileRecord.file_type,
                size: fileRecord.file_size,
                status: 'pending'
            }
        });
    } catch (err) {
        console.error('Upload error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
