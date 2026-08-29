// BreedIQ - Contact form handler
// Sends contact form submissions to frostedgoldendoodles@gmail.com via Nodemailer + Gmail SMTP

import nodemailer from 'nodemailer';
import { enforce, LIMITS } from '../lib/rate-limit.js';

// Escape user-supplied text before embedding it in the HTML email body so a
// submitter can't inject markup/links into the operator's inbox.
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Same-origin only — no wildcard CORS. The contact form lives on
    // breediq.ai, so cross-origin POSTs are abuse, not legitimate traffic.

    if (enforce(req, res, { name: 'contact', ...LIMITS.contact })) return;

    const { name, email, message } = req.body || {};

    if (!name || !email || !message) {
        return res.status(400).json({
            error: 'Missing required fields: name, email, and message are all required'
        });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    // Cap field lengths to keep emails sane and limit abuse payload size.
    if (name.length > 200 || email.length > 200 || message.length > 5000) {
        return res.status(400).json({ error: 'One or more fields is too long.' });
    }

    try {
        // Create Gmail SMTP transporter
        // Requires GMAIL_USER and GMAIL_APP_PASSWORD environment variables in Vercel
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD
            }
        });

        // Send email to Spencer
        await transporter.sendMail({
            from: `"BreedIQ Contact Form" <${process.env.GMAIL_USER}>`,
            to: 'frostedgoldendoodles@gmail.com',
            replyTo: email,
            subject: `[BreedIQ Contact] New message from ${name.slice(0, 80)}`,
            text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
            html: `
                <div style="font-family: sans-serif; max-width: 600px;">
                    <h2 style="color: #10b981;">New Contact Form Submission</h2>
                    <p><strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p>
                    <hr style="border: 1px solid #e2e8f0;" />
                    <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
                    <hr style="border: 1px solid #e2e8f0;" />
                    <p style="color: #94a3b8; font-size: 12px;">Sent from breediq.ai contact form</p>
                </div>
            `
        });

        return res.status(200).json({
            success: true,
            message: "Message received! We'll get back to you soon."
        });
    } catch (err) {
        console.error('Error sending contact email:', err);
        return res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to send your message. Please try again later or email frostedgoldendoodles@gmail.com directly.'
        });
    }
}
