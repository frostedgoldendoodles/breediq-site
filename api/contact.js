// BreedIQ - Contact form handler
// Sends contact form submissions to frostedgoldendoodles@gmail.com via Nodemailer + Gmail SMTP

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
