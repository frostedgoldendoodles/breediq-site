// BreedIQ signup page — source. Compiled to /signup.bundle.js by
// `npm run compile` (esbuild, classic JSX transform against global React).
// Edit this file, not the bundle.

        const { useState } = React;

        function SignupPage() {
            const [name, setName] = useState('');
            const [email, setEmail] = useState('');
            const [password, setPassword] = useState('');
            const [confirmPassword, setConfirmPassword] = useState('');
            const [error, setError] = useState(null);
            const [loading, setLoading] = useState(false);

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
                    const resp = await fetch('/api/auth/signup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password, name })
                    });
                    const data = await resp.json();
                    if (!resp.ok) throw new Error(data.error || 'Signup failed');
                    // Redirect to onboarding
                    window.location.href = '/onboarding';
                } catch (err) {
                    setError(err.message);
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

                        {/* Card */}
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
                            <h1 className="text-2xl font-bold text-gray-100 mb-2">Create your account</h1>
                            <p className="text-gray-400 mb-6">Start managing your breeding program with AI</p>

                            {error && (
                                <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 mb-4">
                                    <p className="text-sm text-red-300">{error}</p>
                                </div>
                            )}

                            <form onSubmit={handleSubmit} method="post" className="space-y-4">
                                <div>
                                    <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-1">Full name</label>
                                    <input
                                        id="name"
                                        name="name"
                                        type="text"
                                        autoComplete="name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                                        placeholder="Joe Smith"
                                        required
                                    />
                                </div>
                                <div>
                                    <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">Email</label>
                                    <input
                                        id="email"
                                        name="email"
                                        type="email"
                                        autoComplete="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                                        placeholder="you@example.com"
                                        required
                                    />
                                </div>
                                <div>
                                    <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">Password</label>
                                    <input
                                        id="password"
                                        name="password"
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
                                    <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300 mb-1">Confirm password</label>
                                    <input
                                        id="confirmPassword"
                                        name="confirmPassword"
                                        type="password"
                                        autoComplete="new-password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                                        placeholder="Confirm your password"
                                        required
                                        minLength={8}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full py-3 rounded-lg font-semibold text-white gradient-button disabled:opacity-50"
                                >
                                    {loading ? 'Creating account...' : 'Create Account'}
                                </button>
                            </form>

                            <p className="text-center text-gray-400 text-sm mt-6">
                                Already have an account?{' '}
                                <a href="/login" className="text-blue-400 hover:text-blue-300 transition">Sign in</a>
                            </p>
                        </div>

                        <p className="text-center text-gray-500 text-xs mt-6">
                            By creating an account, you agree to our <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">Privacy Policy</a>.
                        </p>
                    </div>
                </div>
            );
        }

        ReactDOM.createRoot(document.getElementById('root')).render(<SignupPage />);
