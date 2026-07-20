// BreedIQ reset-password page — source. Compiled to /reset-password.bundle.js by
// `npm run compile` (esbuild, classic JSX transform against global React).
// Edit this file, not the bundle.

        const { useState, useEffect } = React;

        function ResetPasswordPage() {
            const [password, setPassword] = useState('');
            const [confirmPassword, setConfirmPassword] = useState('');
            const [error, setError] = useState(null);
            const [loading, setLoading] = useState(false);
            const [success, setSuccess] = useState(false);
            const [accessToken, setAccessToken] = useState(null);
            const [tokenError, setTokenError] = useState(false);

            useEffect(() => {
                // Supabase puts the recovery token in the URL hash fragment
                // e.g. #access_token=xxx&type=recovery
                const hash = window.location.hash.substring(1);
                const params = new URLSearchParams(hash);
                const token = params.get('access_token');
                const type = params.get('type');

                if (token && type === 'recovery') {
                    setAccessToken(token);
                } else {
                    setTokenError(true);
                }
            }, []);

            const handleSubmit = async (e) => {
                e.preventDefault();
                setError(null);

                if (password !== confirmPassword) {
                    setError('Passwords do not match');
                    return;
                }
                if (password.length < 8) {
                    setError('Password must be at least 8 characters');
                    return;
                }

                setLoading(true);
                try {
                    const resp = await fetch('/api/auth/update-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ access_token: accessToken, password })
                    });
                    const data = await resp.json();
                    if (!resp.ok) throw new Error(data.error || 'Failed to update password');
                    setSuccess(true);
                } catch (err) {
                    setError(err.message);
                } finally {
                    setLoading(false);
                }
            };

            return (
                <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
                    {/* Background glow */}
                    <div className="fixed inset-0 overflow-hidden pointer-events-none">
                        <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl"></div>
                        <div className="absolute bottom-1/4 right-1/3 w-96 h-96 bg-green-500/5 rounded-full blur-3xl"></div>
                    </div>

                    <div className="w-full max-w-md relative z-10">
                        {/* Logo */}
                        <div className="text-center mb-8">
                            <a href="/" className="inline-flex items-center gap-2">
                                <span className="text-3xl">&#x1f43e;</span>
                                <span className="text-2xl font-bold gradient-text">BreedIQ</span>
                            </a>
                        </div>

                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
                            {tokenError ? (
                                <div>
                                    <h1 className="text-2xl font-bold text-gray-100 mb-2">Invalid reset link</h1>
                                    <p className="text-gray-400 mb-6">This password reset link is invalid or has expired. Please request a new one.</p>
                                    <a href="/login" className="block w-full py-3 rounded-lg font-semibold text-white gradient-button text-center">
                                        Back to Sign In
                                    </a>
                                </div>
                            ) : success ? (
                                <div>
                                    <div className="text-center mb-4">
                                        <div className="w-16 h-16 bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                            <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                        <h1 className="text-2xl font-bold text-gray-100 mb-2">Password updated</h1>
                                        <p className="text-gray-400 mb-6">Your password has been changed successfully. You can now sign in with your new password.</p>
                                    </div>
                                    <a href="/login" className="block w-full py-3 rounded-lg font-semibold text-white gradient-button text-center">
                                        Sign In
                                    </a>
                                </div>
                            ) : (
                                <div>
                                    <h1 className="text-2xl font-bold text-gray-100 mb-2">Set a new password</h1>
                                    <p className="text-gray-400 mb-6">Enter your new password below.</p>

                                    {error && (
                                        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 mb-4">
                                            <p className="text-sm text-red-300">{error}</p>
                                        </div>
                                    )}

                                    <form onSubmit={handleSubmit} className="space-y-4">
                                        <div>
                                            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">New Password</label>
                                            <input
                                                id="password"
                                                type="password"
                                                autoComplete="new-password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                                                placeholder="At least 8 characters"
                                                required
                                                minLength={8}
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-300 mb-1">Confirm Password</label>
                                            <input
                                                id="confirm-password"
                                                type="password"
                                                autoComplete="new-password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                                                placeholder="Confirm your new password"
                                                required
                                                minLength={8}
                                            />
                                        </div>
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="w-full py-3 rounded-lg font-semibold text-white gradient-button disabled:opacity-50"
                                        >
                                            {loading ? 'Updating...' : 'Update Password'}
                                        </button>
                                    </form>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        ReactDOM.createRoot(document.getElementById('root')).render(<ResetPasswordPage />);
