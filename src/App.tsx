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
  runSync,
  startPeriodicSync,
  stopPeriodicSync
} from './lib/offline';

import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbReady, setDbReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'pending' | 'syncing' | 'done' | 'error'>('pending');

  useEffect(() => {
    // Initialize database first
    initDatabase()
      .then(() => {
        console.log('[App] Database initialized');
        setDbReady(true);
      })
      .catch(err => {
        console.error('[App] Database initialization failed:', err);
        // Continue anyway - will work offline if DB was previously initialized
        setDbReady(true);
      });
  }, []);

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

  // When we have both DB ready and session, set user ID and sync
  useEffect(() => {
    if (dbReady && session?.user?.id) {
      const userId = session.user.id;

      // Set user ID in local DB
      setCurrentUserId(userId).then(() => {
        console.log('[App] User ID set:', userId);

        // Start initial sync if online
        if (navigator.onLine) {
          setSyncStatus('syncing');
          runSync()
            .then(result => {
              console.log('[App] Initial sync complete:', result);
              setSyncStatus('done');
            })
            .catch(err => {
              console.error('[App] Initial sync failed:', err);
              setSyncStatus('error');
            });
        } else {
          setSyncStatus('done'); // Skip sync if offline
        }
      });

      // Start periodic sync
      startPeriodicSync();

      return () => {
        stopPeriodicSync();
      };
    }
  }, [dbReady, session?.user?.id]);

  // Show loading while: auth loading, db not ready, or sync in progress
  const isInitializing = loading || !dbReady || (syncStatus !== 'done' && syncStatus !== 'error');

  if (isInitializing) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-zinc-900">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {!dbReady ? 'Initializing...' : syncStatus === 'syncing' ? 'Syncing your data...' : 'Loading...'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {!dbReady ? 'Setting up local database' : syncStatus === 'syncing' ? 'This may take a moment' : 'Please wait'}
          </p>
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