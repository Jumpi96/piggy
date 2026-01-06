import { Link, useLocation, Outlet } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, List, PlusCircle, Settings, Repeat, BarChart3, CreditCard, FileText, Wallet, Cloud, CloudOff, RefreshCw, AlertCircle, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { useOfflineStatus, formatLastSync } from '../lib/offline/network';
import { getCurrentUserId, getLastSyncTimestamp, getDatabaseAsync, isUsingPersistence } from '../lib/offline';

const DEBUG_FLAG_KEY = 'piggy_debug_ui';

function readDebugFlag(): boolean {
    try {
        return localStorage.getItem(DEBUG_FLAG_KEY) === '1';
    } catch {
        return false;
    }
}

function SyncStatusIndicator({ compact = false }: { compact?: boolean }) {
    const { isOnline, isSyncing, lastSyncAt, pendingChanges, syncError, manualSync } = useOfflineStatus();
    const [showSyncComplete, setShowSyncComplete] = useState(false);
    const [wasSyncing, setWasSyncing] = useState(false);

    // Show brief "synced" indicator when sync completes
    useEffect(() => {
        if (wasSyncing && !isSyncing && !syncError) {
            setShowSyncComplete(true);
            const timer = setTimeout(() => setShowSyncComplete(false), 2000);
            return () => clearTimeout(timer);
        }
        setWasSyncing(isSyncing);
    }, [isSyncing, syncError, wasSyncing]);

    const getStatusColor = () => {
        if (syncError) return "text-red-500";
        if (!isOnline) return "text-amber-500";
        if (showSyncComplete) return "text-emerald-500";
        if (pendingChanges > 0) return "text-amber-500";
        return "text-emerald-500";
    };

    const getIcon = () => {
        if (isSyncing) return <RefreshCw className="w-4 h-4 animate-spin" />;
        if (!isOnline) return <CloudOff className="w-4 h-4" />;
        if (syncError) return <AlertCircle className="w-4 h-4" />;
        if (showSyncComplete) return <Check className="w-4 h-4" />;
        return <Cloud className="w-4 h-4" />;
    };

    const getLabel = () => {
        if (isSyncing) return 'Syncing...';
        if (!isOnline) return 'Offline';
        if (syncError) return 'Sync error';
        if (showSyncComplete) return 'Synced!';
        if (pendingChanges > 0) return `${pendingChanges} pending`;
        return formatLastSync(lastSyncAt);
    };

    if (compact) {
        return (
            <button
                onClick={manualSync}
                disabled={!isOnline || isSyncing}
                className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all",
                    getStatusColor(),
                    isOnline && !isSyncing && "active:scale-95"
                )}
            >
                {getIcon()}
                {(isSyncing || !isOnline || syncError || pendingChanges > 0 || showSyncComplete) && (
                    <span>{getLabel()}</span>
                )}
            </button>
        );
    }

    return (
        <button
            onClick={manualSync}
            disabled={!isOnline || isSyncing}
            className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                "hover:bg-gray-100 dark:hover:bg-zinc-800",
                getStatusColor()
            )}
            title={syncError || (isOnline ? `Last sync: ${formatLastSync(lastSyncAt)}` : 'Offline mode')}
        >
            {getIcon()}
            <span>{getLabel()}</span>
            {pendingChanges > 0 && !compact && (
                <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                    {pendingChanges}
                </span>
            )}
        </button>
    );
}

type DebugInfo = {
    lastUpdated: string;
    localStorageAvailable: boolean;
    localStorageUserId: string | null;
    localStorageLastSync: string | null;
    derivedUserId: string | null;
    derivedLastSync: string | null;
    isUsingPersistence: boolean;
    tableCounts: Array<{ table: string; count: number }>;
    dbError: string | null;
    storagePersisted: boolean | null;
    storageEstimate: { usage: number; quota: number } | null;
    deriveError: string | null;
};

function DebugPanel({ onClose }: { onClose: () => void }) {
    const { isOnline, isSyncing, lastSyncAt, pendingChanges, syncError, isHydrated } = useOfflineStatus();
    const [info, setInfo] = useState<DebugInfo | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        const now = new Date().toISOString();
        let localStorageAvailable = true;
        let localStorageUserId: string | null = null;
        let localStorageLastSync: string | null = null;
        let derivedUserId: string | null = null;
        let derivedLastSync: string | null = null;
        let deriveError: string | null = null;
        let dbError: string | null = null;
        const tableCounts: Array<{ table: string; count: number }> = [];

        try {
            const testKey = '__piggy_ls_test__';
            localStorage.setItem(testKey, '1');
            localStorage.removeItem(testKey);
        } catch (err) {
            localStorageAvailable = false;
        }

        if (localStorageAvailable) {
            try {
                localStorageUserId = localStorage.getItem('piggy_user_id');
                localStorageLastSync = localStorage.getItem('piggy_last_sync');
            } catch (err) {
                localStorageAvailable = false;
            }
        }

        try {
            [derivedUserId, derivedLastSync] = await Promise.all([
                getCurrentUserId(),
                getLastSyncTimestamp()
            ]);
        } catch (err) {
            deriveError = err instanceof Error ? err.message : String(err);
        }

        try {
            const db = await getDatabaseAsync();
            const tables = ['parameters', 'exchange_rates', 'credit_cards', 'recurring_rules', 'transactions'];
            for (const table of tables) {
                const result = await db.query<{ count: string }>(`
                    SELECT COUNT(*) as count FROM ${table}
                `);
                const count = parseInt(result.rows[0]?.count || '0', 10);
                tableCounts.push({ table, count: Number.isNaN(count) ? 0 : count });
            }
        } catch (err) {
            dbError = err instanceof Error ? err.message : String(err);
        }

        let storagePersisted: boolean | null = null;
        let storageEstimate: { usage: number; quota: number } | null = null;
        if (navigator.storage?.persisted) {
            try {
                storagePersisted = await navigator.storage.persisted();
            } catch {
                storagePersisted = null;
            }
        }
        if (navigator.storage?.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                if (typeof estimate.usage === 'number' && typeof estimate.quota === 'number') {
                    storageEstimate = { usage: estimate.usage, quota: estimate.quota };
                }
            } catch {
                storageEstimate = null;
            }
        }

        setInfo({
            lastUpdated: now,
            localStorageAvailable,
            localStorageUserId,
            localStorageLastSync,
            derivedUserId,
            derivedLastSync,
            isUsingPersistence: isUsingPersistence(),
            tableCounts,
            dbError,
            storagePersisted,
            storageEstimate,
            deriveError
        });
        setIsLoading(false);
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const formatBytes = (value: number) => {
        if (value < 1024) return `${value} B`;
        const kb = value / 1024;
        if (kb < 1024) return `${kb.toFixed(1)} KB`;
        const mb = kb / 1024;
        if (mb < 1024) return `${mb.toFixed(1)} MB`;
        const gb = mb / 1024;
        return `${gb.toFixed(2)} GB`;
    };

    return (
        <div className="fixed bottom-24 md:bottom-4 right-2 left-2 md:left-auto z-50 max-w-md">
            <div className="bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/40 rounded-xl shadow-lg p-3 text-xs">
                <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-amber-700 dark:text-amber-300">Debug</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={refresh}
                            className="px-2 py-1 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                        >
                            {isLoading ? 'Loading...' : 'Refresh'}
                        </button>
                        <button
                            onClick={onClose}
                            className="px-2 py-1 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300"
                        >
                            Close
                        </button>
                    </div>
                </div>
                <div className="space-y-1 font-mono">
                    <div className="flex justify-between gap-2"><span>online</span><span>{isOnline ? 'true' : 'false'}</span></div>
                    <div className="flex justify-between gap-2"><span>syncing</span><span>{isSyncing ? 'true' : 'false'}</span></div>
                    <div className="flex justify-between gap-2"><span>sync error</span><span>{syncError || 'none'}</span></div>
                    <div className="flex justify-between gap-2"><span>pending</span><span>{pendingChanges}</span></div>
                    <div className="flex justify-between gap-2"><span>hydrated</span><span>{isHydrated ? 'true' : 'false'}</span></div>
                    <div className="flex justify-between gap-2"><span>last sync</span><span>{lastSyncAt ? lastSyncAt.toISOString() : 'null'}</span></div>
                    <div className="flex justify-between gap-2"><span>ls available</span><span>{info?.localStorageAvailable ? 'true' : 'false'}</span></div>
                    <div className="flex justify-between gap-2"><span>ls user_id</span><span>{info?.localStorageUserId || 'null'}</span></div>
                    <div className="flex justify-between gap-2"><span>ls last_sync</span><span>{info?.localStorageLastSync || 'null'}</span></div>
                    <div className="flex justify-between gap-2"><span>derived user_id</span><span>{info?.derivedUserId || 'null'}</span></div>
                    <div className="flex justify-between gap-2"><span>derived last_sync</span><span>{info?.derivedLastSync || 'null'}</span></div>
                    <div className="flex justify-between gap-2"><span>persistence</span><span>{info?.isUsingPersistence ? 'true' : 'false'}</span></div>
                    {info && info.storagePersisted !== null && (
                        <div className="flex justify-between gap-2"><span>storage persisted</span><span>{info.storagePersisted ? 'true' : 'false'}</span></div>
                    )}
                    {info?.storageEstimate && (
                        <div className="flex justify-between gap-2">
                            <span>storage usage</span>
                            <span>{formatBytes(info.storageEstimate.usage)} / {formatBytes(info.storageEstimate.quota)}</span>
                        </div>
                    )}
                    {info?.tableCounts && info.tableCounts.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                            {info.tableCounts.map(({ table, count }) => (
                                <span key={table} className="px-2 py-1 rounded bg-gray-100 dark:bg-zinc-800">
                                    {table}:{count}
                                </span>
                            ))}
                        </div>
                    )}
                    {(info?.dbError || info?.deriveError) && (
                        <div className="pt-1 text-red-600 dark:text-red-400">
                            {info?.dbError ? `db error: ${info.dbError}` : ''}
                            {info?.deriveError ? `derive error: ${info.deriveError}` : ''}
                        </div>
                    )}
                    <div className="text-[10px] text-gray-400">updated: {info?.lastUpdated || '...'}</div>
                </div>
            </div>
        </div>
    );
}

export function Layout() {
    const location = useLocation();
    const debugFromQuery = new URLSearchParams(location.search).get('debug') === '1';
    const [debugEnabled, setDebugEnabled] = useState(() => debugFromQuery || readDebugFlag());
    // const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    useEffect(() => {
        if (debugFromQuery) {
            setDebugEnabled(true);
            return;
        }
        setDebugEnabled(readDebugFlag());
    }, [debugFromQuery]);

    useEffect(() => {
        const handleDebugChange = () => {
            if (!debugFromQuery) {
                setDebugEnabled(readDebugFlag());
            }
        };
        window.addEventListener('piggy-debug-change', handleDebugChange);
        return () => window.removeEventListener('piggy-debug-change', handleDebugChange);
    }, [debugFromQuery]);

    const navItems = [
        { href: '/', icon: LayoutDashboard, label: 'Overview' },
        { href: '/add', icon: PlusCircle, label: 'Add', special: true },
        { href: '/transactions', icon: List, label: 'Transactions' },
        { href: '/recurring', icon: Repeat, label: 'Recurring' },
        { href: '/money-checker', icon: Wallet, label: 'Money Checker' },
        { href: '/credit', icon: CreditCard, label: 'Credit' },
        { href: '/balance', icon: BarChart3, label: 'Balance' },
        { href: '/annual', icon: FileText, label: 'Annual' },
        { href: '/settings', icon: Settings, label: 'Settings' },
    ];

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-gray-100 flex flex-col md:flex-row">
            {/* Sidebar (Desktop) - sticky to viewport */}
            <aside className="hidden md:flex flex-col w-64 h-screen sticky top-0 border-r border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
                <h1 className="text-2xl font-bold mb-8 px-4 text-emerald-600 dark:text-emerald-400">🐷 piggy</h1>
                <nav className="flex-1 space-y-2 overflow-y-auto">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            to={item.href}
                            className={cn(
                                "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                                location.pathname === item.href
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                                    : "text-gray-700 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
                            )}
                        >
                            <item.icon className="w-5 h-5" />
                            {item.label}
                        </Link>
                    ))}
                </nav>
                <div className="border-t border-gray-200 dark:border-zinc-800 pt-4 shrink-0">
                    <SyncStatusIndicator />
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto pb-20 md:pb-0">
                {/* Mobile sync indicator - floating top right */}
                <div className="md:hidden fixed top-2 right-2 z-40">
                    <div className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm rounded-full shadow-sm border border-gray-200 dark:border-zinc-700">
                        <SyncStatusIndicator compact />
                    </div>
                </div>
                {debugEnabled && (
                    <DebugPanel
                        onClose={() => {
                            try {
                                localStorage.removeItem(DEBUG_FLAG_KEY);
                            } catch {}
                            setDebugEnabled(false);
                        }}
                    />
                )}
                <Outlet />
            </main>

            {/* Bottom Nav (Mobile) */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-zinc-950 border-t border-gray-200 dark:border-zinc-800 flex items-center overflow-x-auto flex-nowrap z-50 safe-area-bottom scrollbar-none pt-4 pb-1">
                {navItems.map((item) => (
                    <Link
                        key={item.href}
                        to={item.href}
                        className={cn(
                            "flex flex-col items-center justify-center px-1 py-1 rounded-lg min-w-[72px] shrink-0 transition-transform active:scale-95",
                            item.special ? "relative -top-4" : "",
                            location.pathname === item.href
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-gray-500 dark:text-gray-400"
                        )}
                    >
                        {item.special ? (
                            <div className="bg-emerald-600 text-white p-3 rounded-full shadow-lg ring-4 ring-white dark:ring-zinc-950">
                                <item.icon className="w-6 h-6" />
                            </div>
                        ) : (
                            <>
                                <item.icon className="w-6 h-6" />
                                <span className="text-[10px] mt-1 font-medium">{item.label}</span>
                            </>
                        )}
                    </Link>
                ))}
            </nav>
        </div>
    );
}
