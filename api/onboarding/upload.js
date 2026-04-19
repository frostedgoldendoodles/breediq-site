// BreedIQ Onboarding — File Upload
// Accepts file uploads, stores in Supabase Storage, records in files table
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

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
        const { filename, content, contentType } = req.body;

        if (!filename || !content) {
            return res.status(400).json({ error: 'filename and content (base64) are required' });
        }

        const supabase = getServiceClient();
        const userId = auth.user.id;
        const fileBuffer = Buffer.from(content, 'base64');
        const fileExt = filename.split('.').pop().toLowerCase();

        // Determine file type
        let fileType = 'other';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(fileExt)) fileType = 'image';
        else if (fileExt === 'pdf') fileType = 'pdf';
        else if (['csv', 'xlsx', 'xls'].includes(fileExt)) fileType = 'spreadsheet';
        else if (['txt', 'md', 'rtf', 'doc', 'docx'].includes(fileExt)) fileType = 'text';

        // Upload to Supabase Storage
        const storagePath = `${userId}/${Date.now()}_${filename}`;
        const { error: uploadError } = await supabase.storage
            .from('uploads')
            .upload(storagePath, fileBuffer, {
                contentType: contentType || 'application/octet-stream',
                upsert: false
            });

        if (uploadError) {
            return res.status(500).json({ error: 'File upload failed', details: uploadError.message });
        }

        // Record file in database
        const { data: fileRecord, error: dbError } = await supabase
            .from('files')
            .insert({
                user_id: userId,
                filename,
                file_type: fileType,
                mime_type: contentType,
                file_size: fileBuffer.length,
                storage_path: storagePath,
                processing_status: 'pending',
                purpose: 'onboarding'
            })
            .select()
            .single();

        if (dbError) {
            return res.status(500).json({ error: 'Failed to save file record', details: dbError.message });
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
