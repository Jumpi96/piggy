import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { TransactionsList } from './pages/TransactionsList';
import { RecurringRulesPage } from './pages/RecurringRules';
import { AddTransaction } from './pages/AddTransaction';
import { SettingsPage } from './pages/SettingsPage';
import { Login } from './pages/Login';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';

import type { ReactNode } from 'react';
// ...
function RequireAuth({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-pink-600" /></div>;
  if (!session) return <Navigate to="/login" replace />;

  return children;
}

function CatchAll() {
  const [isAuthRedirect] = useState(window.location.hash.includes('access_token='));
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthRedirect) {
      // Listen for the session to be established
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) {
          navigate('/', { replace: true });
        }
      });
      // Safety: If no session after 5s, go to login
      const timer = setTimeout(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session) navigate('/login', { replace: true });
        });
      }, 5000);
      return () => {
        subscription.unsubscribe();
        clearTimeout(timer);
      };
    }
  }, [isAuthRedirect, navigate]);

  if (isAuthRedirect) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-950">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-pink-600 mx-auto" />
          <p className="text-gray-500 font-medium">Finishing log in...</p>
        </div>
      </div>
    );
  }

  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="transactions" element={<TransactionsList />} />
          <Route path="recurring" element={<RecurringRulesPage />} />
          <Route path="add" element={<AddTransaction />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<CatchAll />} />
      </Routes>
    </HashRouter>
  );
}
