import { Link, useLocation, Outlet } from 'react-router-dom';
import { LayoutDashboard, List, PlusCircle, Settings, Repeat } from 'lucide-react';
import { cn } from '../lib/utils';

export function Layout() {
    const location = useLocation();
    // const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const navItems = [
        { href: '/', icon: LayoutDashboard, label: 'Overview' },
        { href: '/transactions', icon: List, label: 'Transactions' },
        { href: '/recurring', icon: Repeat, label: 'Recurring' },
        { href: '/add', icon: PlusCircle, label: 'Add', special: true },
        { href: '/settings', icon: Settings, label: 'Settings' },
    ];

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-gray-100 flex flex-col md:flex-row">
            {/* Sidebar (Desktop) */}
            <aside className="hidden md:flex flex-col w-64 border-r border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
                <h1 className="text-2xl font-bold mb-8 px-4 text-pink-600 dark:text-pink-400">Piggy 🐷</h1>
                <nav className="flex-1 space-y-2">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            to={item.href}
                            className={cn(
                                "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                                location.pathname === item.href
                                    ? "bg-pink-50 text-pink-700 dark:bg-pink-900/20 dark:text-pink-400"
                                    : "text-gray-700 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
                            )}
                        >
                            <item.icon className="w-5 h-5" />
                            {item.label}
                        </Link>
                    ))}
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto pb-20 md:pb-0">
                <Outlet />
            </main>

            {/* Bottom Nav (Mobile) */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-zinc-950 border-t border-gray-200 dark:border-zinc-800 flex justify-around p-2 z-50 safe-area-bottom">
                {navItems.map((item) => (
                    <Link
                        key={item.href}
                        to={item.href}
                        className={cn(
                            "flex flex-col items-center justify-center p-2 rounded-lg w-full",
                            item.special ? "-mt-8" : "",
                            location.pathname === item.href
                                ? "text-pink-600 dark:text-pink-400"
                                : "text-gray-500 dark:text-gray-400"
                        )}
                    >
                        {item.special ? (
                            <div className="bg-pink-600 text-white p-3 rounded-full shadow-lg">
                                <item.icon className="w-6 h-6" />
                            </div>
                        ) : (
                            <item.icon className="w-6 h-6" />
                        )}
                        {!item.special && <span className="text-[10px] mt-1">{item.label}</span>}
                    </Link>
                ))}
            </nav>
        </div>
    );
}
