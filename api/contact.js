// BreedIQ - Contact form handler
// Sends contact form submissions to spencer@breediq.ai via Nodemailer + Gmail SMTP

import nodemailer from 'nodemailer';

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { name, email, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({
            error: 'Missing required fields: name, email, and message are all required'
        });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
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
            to: 'spencer@breediq.ai',
            replyTo: email,
            subject: `[BreedIQ Contact] New message from ${name}`,
            text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
            html: `
                <div style="font-family: sans-serif; max-width: 600px;">
                    <h2 style="color: #10b981;">New Contact Form Submission</h2>
                    <p><strong>From:</strong> ${name} (${email})</p>
                    <hr style="border: 1px solid #e2e8f0;" />
                    <p style="white-space: pre-wrap;">${message}</p>
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
            message: 'Failed to send your message. Please try again later or email spencer@breediq.ai directly.'
        });
    }
}
