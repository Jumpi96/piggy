import { Link, useLocation, Outlet } from 'react-router-dom';
import { LayoutDashboard, List, PlusCircle, Settings, Repeat, BarChart3, CreditCard, FileText, Wallet, Cloud, CloudOff, RefreshCw, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useOfflineStatus, formatLastSync } from '../lib/offline/network';

function SyncStatusIndicator() {
    const { isOnline, isSyncing, lastSyncAt, pendingChanges, syncError, manualSync } = useOfflineStatus();

    return (
        <button
            onClick={manualSync}
            disabled={!isOnline || isSyncing}
            className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                "hover:bg-gray-100 dark:hover:bg-zinc-800",
                !isOnline && "text-amber-600 dark:text-amber-400",
                syncError && "text-red-600 dark:text-red-400"
            )}
            title={syncError || (isOnline ? `Last sync: ${formatLastSync(lastSyncAt)}` : 'Offline mode')}
        >
            {isSyncing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
            ) : !isOnline ? (
                <CloudOff className="w-4 h-4" />
            ) : syncError ? (
                <AlertCircle className="w-4 h-4" />
            ) : (
                <Cloud className="w-4 h-4 text-emerald-500" />
            )}
            <span className="hidden lg:inline">
                {isSyncing ? 'Syncing...' : !isOnline ? 'Offline' : formatLastSync(lastSyncAt)}
            </span>
            {pendingChanges > 0 && (
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
            {/* Sidebar (Desktop) */}
            <aside className="hidden md:flex flex-col w-64 border-r border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
                <h1 className="text-2xl font-bold mb-8 px-4 text-emerald-600 dark:text-emerald-400">🐷 piggy</h1>
                <nav className="flex-1 space-y-2">
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
                <div className="border-t border-gray-200 dark:border-zinc-800 pt-4">
                    <SyncStatusIndicator />
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto pb-20 md:pb-0">
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
