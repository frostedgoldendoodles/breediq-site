// BreedIQ privacy page — source. Compiled to /privacy.bundle.js by
// `npm run compile` (esbuild, classic JSX transform against global React).
// Edit this file, not the bundle.

        function PrivacyPolicy() {
            return (
                <div className="min-h-screen bg-slate-950">
                    {/* Navigation */}
                    <nav className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur border-b border-slate-800">
                        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                            <a href="/" className="flex items-center gap-2 hover:opacity-80 transition">
                                <span className="text-2xl">&#x1F43E;</span>
                                <span className="text-xl font-bold gradient-text-blue-emerald">BreedIQ</span>
                            </a>
                            <a href="/" className="text-slate-300 hover:text-white transition text-sm">&larr; Back to home</a>
                        </div>
                    </nav>

                    {/* Main Content */}
                    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
                        {/* Header */}
                        <div className="mb-12">
                            <h1 className="text-4xl lg:text-5xl font-bold mb-4">Privacy Policy</h1>
                            <p className="text-slate-400">Effective date: June 2026</p>
                        </div>

                        {/* Disclaimer */}
                        <div className="disclaimer-box">
                            <p className="font-semibold mb-2">Important Disclaimer</p>
                            <p className="text-sm">This policy is provided for informational purposes. Please consult a legal professional for compliance advice regarding your specific jurisdiction and use case.</p>
                        </div>

                        {/* Legal Content */}
                        <div className="legal-section space-y-6 text-slate-200">

                            <section>
                                <h2>1. Who We Are</h2>
                                <p><strong>Company:</strong> BreedIQ</p>
                                <p><strong>Website:</strong> breediq.ai</p>
                                <p><strong>Owner:</strong> Spencer Leany</p>
                                <p><strong>Contact:</strong> spencer@breediq.ai</p>
                            </section>

                            <section>
                                <h2>2. What We Collect</h2>
                                <p>BreedIQ collects the following types of information:</p>
                                <ul className="list-disc">
                                    <li><strong>Account Information:</strong> Name, email address, password (hashed)</li>
                                    <li><strong>Breeding Program Data:</strong> Dog records, health data, breeding history, litter information</li>
                                    <li><strong>Guardian Information:</strong> Details about guardian families and their dogs</li>
                                    <li><strong>Calendar Data:</strong> Heat cycles, due dates, go-home dates, and other breeding calendar events</li>
                                    <li><strong>Payment Information:</strong> Processed securely through Stripe (we do not store credit card details)</li>
                                    <li><strong>Usage Data:</strong> Log data, IP addresses, browser type, pages visited</li>
                                </ul>
                            </section>

                            <section>
                                <h2>3. How We Use Your Data</h2>
                                <p>Your information is used to:</p>
                                <ul className="list-disc">
                                    <li>Provide and maintain the BreedIQ platform</li>
                                    <li>Process payments through Stripe for premium subscriptions</li>
                                    <li>Analyze your breeding records using AI (Claude from Anthropic) to provide insights and recommendations</li>
                                    <li>Sync your calendar events with Google Calendar (with your permission)</li>
                                    <li>Send you important service announcements and support communications</li>
                                    <li>Improve our platform based on usage patterns and feedback</li>
                                    <li>Comply with legal obligations</li>
                                </ul>
                            </section>

                            <section>
                                <h2>4. Third-Party Services</h2>
                                <p>We work with the following third-party services:</p>

                                <h3>Stripe (Payment Processing)</h3>
                                <p>Payment information is processed by Stripe. We do not store your credit card details. Stripe's privacy policy governs payment data: <a href="https://stripe.com/privacy" className="text-emerald-400 hover:text-emerald-300">stripe.com/privacy</a></p>

                                <h3>Google Calendar (Calendar Integration)</h3>
                                <p>If you enable calendar sync, BreedIQ connects to your Google Calendar to auto-sync breeding events. You control this permission, and we only access the scopes you explicitly authorize. Google's privacy policy applies: <a href="https://policies.google.com/privacy" className="text-emerald-400 hover:text-emerald-300">policies.google.com/privacy</a></p>

                                <h3>Anthropic Claude (AI Analysis)</h3>
                                <p>We use Anthropic's Claude AI to analyze your breeding records and provide insights. Your breeding data is sent to Claude for processing but is not stored by Anthropic beyond the scope of your request. Anthropic's privacy policy applies: <a href="https://www.anthropic.com/privacy" className="text-emerald-400 hover:text-emerald-300">anthropic.com/privacy</a></p>

                                <h3>Google Analytics (Usage Analytics)</h3>
                                <p>We use Google Analytics to understand how visitors use BreedIQ &mdash; for example, which pages are viewed and general usage trends &mdash; so we can improve the product. Google Analytics sets cookies (such as <code>_ga</code>) and collects information like your approximate location, device type, and activity on our site. We do not use this data to identify you personally, and we do not sell it. You can opt out of Google Analytics using the <a href="https://tools.google.com/dlpage/gaoptout" className="text-emerald-400 hover:text-emerald-300">Google Analytics Opt-out Browser Add-on</a>. Google's privacy policy applies: <a href="https://policies.google.com/privacy" className="text-emerald-400 hover:text-emerald-300">policies.google.com/privacy</a></p>
                            </section>

                            <section>
                                <h2>5. Data Security</h2>
                                <p>We take data security seriously:</p>
                                <ul className="list-disc">
                                    <li>All data is encrypted in transit using HTTPS/TLS</li>
                                    <li>All data is encrypted at rest in our database</li>
                                    <li>Authentication uses secure JWT tokens stored in HttpOnly cookies</li>
                                    <li>We use only essential authentication cookies plus Google Analytics for usage measurement (see &ldquo;Cookies and Tracking&rdquo; below); we do not use advertising or cross-site tracking cookies</li>
                                    <li>Access to data is restricted to authorized personnel only</li>
                                </ul>
                            </section>

                            <section>
                                <h2>6. Your Data Rights</h2>
                                <p>You have the following rights regarding your data:</p>
                                <ul className="list-disc">
                                    <li><strong>Access:</strong> You can access all your breeding data in your BreedIQ account at any time</li>
                                    <li><strong>Export:</strong> You can export your entire breeding program data in standard formats</li>
                                    <li><strong>Delete:</strong> You can delete your account and all associated data. Your deletion request will be processed within 30 days</li>
                                    <li><strong>Correction:</strong> You can update and correct your information directly in the platform</li>
                                </ul>
                                <p>To exercise any of these rights, contact us at spencer@breediq.ai</p>
                            </section>

                            <section>
                                <h2>7. Cookies and Tracking</h2>
                                <p><strong>Authentication Cookie:</strong> We use a single HttpOnly JWT token cookie for authentication. This cookie is essential for the service to function and cannot be disabled while using BreedIQ.</p>
                                <p><strong>Analytics:</strong> We use Google Analytics to measure site usage and improve BreedIQ. It sets analytics cookies (such as <code>_ga</code>) and collects usage data as described in Section 4. We do not use advertising or cross-site tracking pixels, and we do not sell or share your data with advertisers. You can opt out of Google Analytics with the <a href="https://tools.google.com/dlpage/gaoptout" className="text-emerald-400 hover:text-emerald-300">Google Analytics Opt-out Browser Add-on</a>.</p>
                            </section>

                            <section>
                                <h2>8. Data Retention</h2>
                                <p>We retain your data for as long as your account is active. When you delete your account, all personal data is permanently removed from our systems within 30 days. We may retain minimal information (like email) for legitimate business purposes such as preventing fraud or maintaining records of deletion requests.</p>
                            </section>

                            <section>
                                <h2>9. Children's Privacy</h2>
                                <p>BreedIQ is not directed to children under 13. We do not knowingly collect information from children under 13. If we become aware that we have collected information from a child under 13, we will delete it immediately.</p>
                            </section>

                            <section>
                                <h2>10. Contact Us</h2>
                                <p>If you have questions about this privacy policy or your data, please contact us:</p>
                                <p>
                                    <strong>Email:</strong> spencer@breediq.ai<br/>
                                    <strong>Website:</strong> breediq.ai
                                </p>
                            </section>

                            <section>
                                <h2>11. Changes to This Policy</h2>
                                <p>We may update this privacy policy from time to time. We will notify you of significant changes via email or by posting a notice on our website. Your continued use of BreedIQ after any changes constitutes your acceptance of the updated policy.</p>
                            </section>

                        </div>

                        {/* Footer CTA */}
                        <div className="mt-16 pt-8 border-t border-slate-800">
                            <p className="text-slate-400 text-sm mb-6">Questions about your privacy?</p>
                            <a href="mailto:spencer@breediq.ai" className="inline-block bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 px-6 py-3 rounded-lg hover:bg-emerald-500/30 transition font-medium">
                                Contact Privacy Team
                            </a>
                        </div>
                    </main>

                    {/* Footer */}
                    <footer className="bg-slate-900 border-t border-slate-800 mt-20 py-12">
                        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                            <div className="flex flex-col sm:flex-row justify-between items-center text-slate-400 text-sm">
                                <p>&copy; 2026 BreedIQ. All rights reserved.</p>
                                <div className="flex gap-6 mt-4 sm:mt-0">
                                    <a href="/" className="hover:text-white transition">Home</a>
                                    <a href="/privacy" className="hover:text-white transition">Privacy</a>
                                    <a href="/terms" className="hover:text-white transition">Terms</a>
                                </div>
                            </div>
                        </div>
                    </footer>
                </div>
            );
        }

        ReactDOM.render(<PrivacyPolicy />, document.getElementById('root'));
