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
import { MoneyChecker } from './pages/MoneyChecker';
import { Login } from './pages/Login';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';

// Offline support
import {
  initDatabase,
  setCurrentUserId,
  getLastSyncTimestamp,
  runSync,
  startPeriodicSync,
  stopPeriodicSync
} from './lib/offline';

import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dbReady, setDbReady] = useState(false);
  const [hasLocalData, setHasLocalData] = useState<boolean | null>(null);
  const [firstSyncDone, setFirstSyncDone] = useState(false);

  // Initialize database
  useEffect(() => {
    initDatabase()
      .then(async () => {
        console.log('[App] Database ready');
        // Check if we have local data from a previous sync
        const lastSync = await getLastSyncTimestamp();
        setHasLocalData(!!lastSync);
        setDbReady(true);
      })
      .catch(err => {
        console.error('[App] Database initialization failed:', err);
        setHasLocalData(false);
        setDbReady(true);
      });
  }, []);

  // Handle authentication
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session || !window.location.hash.includes('access_token=')) {
        setAuthLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) setAuthLoading(false);
    });

    // Safety timeout for invalid tokens
    const timer = setTimeout(() => {
      setAuthLoading(prev => prev ? false : prev);
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  // Set user ID and handle sync
  useEffect(() => {
    if (!dbReady || !session?.user?.id) return;

    const userId = session.user.id;

    setCurrentUserId(userId).then(async () => {
      console.log('[App] User ID set:', userId);

      // If we have local data, show app immediately and sync in background
      if (hasLocalData) {
        setFirstSyncDone(true);
        // Background sync - don't wait for it
        if (navigator.onLine) {
          runSync().catch(err => console.error('[App] Background sync failed:', err));
        }
      } else {
        // First time - need to sync before showing app (only if online)
        if (navigator.onLine) {
          try {
            await runSync();
            console.log('[App] Initial sync complete');
          } catch (err) {
            console.error('[App] Initial sync failed:', err);
          }
        }
        setFirstSyncDone(true);
      }
    });

    startPeriodicSync();
    return () => stopPeriodicSync();
  }, [dbReady, session?.user?.id, hasLocalData]);

  // Determine what to show
  const isLoading = authLoading || !dbReady || hasLocalData === null;
  const needsFirstSync = !hasLocalData && !firstSyncDone && session?.user?.id;

  if (isLoading || needsFirstSync) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-zinc-900">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {needsFirstSync ? 'Setting up your account...' : 'Loading...'}
          </p>
          {needsFirstSync && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Downloading your data for offline use
            </p>
          )}
        </div>
      </div>
    );
  }

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
          <Route path="money-checker" element={<MoneyChecker />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}