import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { TransactionsList } from './pages/TransactionsList';
import { RecurringRulesPage } from './pages/RecurringRules';
import { AddTransaction } from './pages/AddTransaction';
import { SettingsPage } from './pages/SettingsPage';
import { Balance } from './pages/Balance';
import { CreditReport } from './pages/CreditReport';
import { AnnualReport } from './pages/AnnualReport';
import { Login } from './pages/Login';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';

import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Initial check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      // Only stop loading if we have a session OR if there's no token in the URL to wait for
      if (session || !window.location.hash.includes('access_token=')) {
        setLoading(false);
      }
    });

    // 2. Listen for the actual login event (needed for magic links)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) setLoading(false);
    });

    // 3. Safety timeout: if we're still loading after 5s (e.g. invalid token), just show login
    const timer = setTimeout(() => {
      setLoading(p => p ? false : p);
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-pink-600" /></div>;
  if (!session) return <Navigate to="/login" replace />;

  return children;
}

export default function App() {
  return (
    <BrowserRouter basename="/piggy">
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="transactions" element={<TransactionsList />} />
          <Route path="recurring" element={<RecurringRulesPage />} />
          <Route path="add" element={<AddTransaction />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="balance" element={<Balance />} />
          <Route path="credit" element={<CreditReport />} />
          <Route path="annual" element={<AnnualReport />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}