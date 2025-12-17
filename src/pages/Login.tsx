import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, Mail, KeyRound, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function Login() {
    const [email, setEmail] = useState('');
    const [token, setToken] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [view, setView] = useState<'email' | 'token'>('email');
    const navigate = useNavigate();

    // If user is already logged in, send them home
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) navigate('/');
        });
    }, [navigate]);

    const handleSendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    shouldCreateUser: false,
                    emailRedirectTo: window.location.origin + import.meta.env.BASE_URL
                }
            });
            if (error) throw error;
            setView('token');
        } catch (err: any) {
            console.error(err);
            alert(err.message === "Signups not allowed for this methods" ? "Access denied: User not found." : err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            const { error, data } = await supabase.auth.verifyOtp({
                email,
                token,
                type: 'email'
            });
            if (error) throw error;

            // If data.session exists, we are logged in
            if (data.session) {
                navigate('/');
            }
        } catch (err: any) {
            console.error(err);
            alert(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-950 p-4 font-sans">
            <div className="bg-white dark:bg-zinc-900 w-full max-w-md p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-zinc-800">
                <div className="text-center mb-8">
                    <span className="text-4xl">🐽</span>
                    <h1 className="text-2xl font-bold mt-4">Welcome to Piggy</h1>
                    <p className="text-gray-500 text-sm mt-2">Personal Finance Tracking</p>
                </div>

                {view === 'email' ? (
                    <form onSubmit={handleSendCode} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Email Address</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800/50 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                    placeholder="you@example.com"
                                    required
                                />
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-4 bg-pink-600 text-white rounded-xl font-bold hover:bg-pink-700 shadow-lg shadow-pink-500/20 transition-all flex items-center justify-center gap-2 group disabled:opacity-50"
                        >
                            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                                <>
                                    Send Access Code
                                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                                </>
                            )}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleVerifyCode} className="space-y-6">
                        <div className="space-y-2">
                            <button
                                type="button"
                                onClick={() => setView('email')}
                                className="text-xs text-pink-600 font-bold flex items-center gap-1 hover:underline mb-2"
                            >
                                <ChevronLeft className="w-3 h-3" /> Change Email
                            </button>
                            <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Enter 6-digit Code</label>
                            <div className="relative">
                                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={token}
                                    onChange={e => setToken(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800/50 text-2xl tracking-[0.5em] font-mono text-center focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                    placeholder="000000"
                                    maxLength={6}
                                    required
                                    autoFocus
                                />
                            </div>
                            <p className="text-xs text-center text-gray-500 mt-2">
                                We sent it to <span className="font-bold text-gray-700 dark:text-gray-300">{email}</span>
                            </p>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading || token.length < 6}
                            className="w-full py-4 bg-pink-600 text-white rounded-xl font-bold hover:bg-pink-700 shadow-lg shadow-pink-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Verify & Sign In"}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
