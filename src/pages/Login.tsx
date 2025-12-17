import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, Mail } from 'lucide-react';

export function Login() {
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sent, setSent] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    emailRedirectTo: window.location.origin + import.meta.env.BASE_URL + '#/'
                }
            });
            if (error) throw error;
            setSent(true);
        } catch (err: any) {
            console.error(err);
            alert(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    if (sent) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-950 p-4">
                <div className="max-w-md w-full text-center space-y-4">
                    <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Mail className="w-8 h-8" />
                    </div>
                    <h2 className="text-2xl font-bold">Check your inbox</h2>
                    <p className="text-gray-500">We sent a magic link to <strong>{email}</strong></p>
                    <button onClick={() => setSent(false)} className="text-sm text-gray-400 hover:text-gray-600 underline">Try different email</button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-950 p-4">
            <div className="bg-white dark:bg-zinc-900 w-full max-w-md p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-zinc-800">
                <div className="text-center mb-8">
                    <span className="text-4xl">🐽</span>
                    <h1 className="text-2xl font-bold mt-4">Welcome to Piggy</h1>
                    <p className="text-gray-500 text-sm mt-2">Personal Finance Tracking</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Email Address</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="w-full p-3 rounded-lg border dark:bg-zinc-800 dark:border-zinc-700"
                            placeholder="you@example.com"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full py-3 bg-pink-600 text-white rounded-lg font-bold hover:bg-pink-700 transition-colors flex items-center justify-center gap-2"
                    >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign In with Magic Link"}
                    </button>
                </form>
            </div>
        </div>
    );
}
