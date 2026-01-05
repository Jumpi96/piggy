import { Link, useLocation, Outlet } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { LayoutDashboard, List, PlusCircle, Settings, Repeat, BarChart3, CreditCard, FileText, Wallet, Cloud, CloudOff, RefreshCw, AlertCircle, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { useOfflineStatus, formatLastSync } from '../lib/offline/network';

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

export function Layout() {
    const location = useLocation();
    // const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
