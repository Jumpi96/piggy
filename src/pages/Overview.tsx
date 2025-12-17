export function Overview() {
    return (
        <div className="p-6">
            <header className="mb-6">
                <h1 className="text-2xl font-bold">Monthly Overview</h1>
                <p className="text-gray-500 dark:text-gray-400">Track your current month's finance.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-700">
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Balance</h3>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">$0.00</p>
                </div>
            </div>
        </div>
    );
}
