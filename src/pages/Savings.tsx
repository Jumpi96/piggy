import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Loader2, PiggyBank, TrendingUp, Plus, Table, LineChart, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import {
    readLedger,
    parseLedger,
    validateLedger,
    computeBalances,
    computeKPIs,
    getAllocationConfig,
    type ParsedLedger,
    type AccountBalance,
    type SavingsKPIs,
    type SimplePrice,
} from '../lib/ledger';
import { OverviewTab } from '../components/savings/OverviewTab';
import { AddTransactionTab } from '../components/savings/AddTransactionTab';
import { RawDataTab } from '../components/savings/RawDataTab';

// Lazy load the evolution tab since it's expensive
const AssetsEvolutionTab = lazy(() => import('../components/savings/AssetsEvolutionTab'));

type TabId = 'overview' | 'add' | 'raw' | 'evolution';

export function Savings() {
    const [activeTab, setActiveTab] = useState<TabId>('overview');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Ledger data
    const [ledgerContent, setLedgerContent] = useState<string>('');
    const [parsed, setParsed] = useState<ParsedLedger | null>(null);
    const [balances, setBalances] = useState<AccountBalance[]>([]);
    const [kpis, setKpis] = useState<SavingsKPIs | null>(null);
    const [prices, setPrices] = useState<SimplePrice[]>([]);

    const loadLedger = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const content = await readLedger();
            setLedgerContent(content);

            const parsedLedger = parseLedger(content);
            setParsed(parsedLedger);
            setPrices(parsedLedger.simplePrices);

            // Validate
            const validation = validateLedger(parsedLedger);
            if (!validation.isValid) {
                console.warn('Ledger validation warnings:', validation.errors);
            }

            // Compute balances and KPIs
            const accountBalances = computeBalances(parsedLedger, parsedLedger.simplePrices);
            setBalances(accountBalances);

            const allocationConfig = await getAllocationConfig();
            const computedKPIs = computeKPIs(accountBalances, allocationConfig);
            setKpis(computedKPIs);

        } catch (err) {
            console.error('Failed to load ledger:', err);
            setError(err instanceof Error ? err.message : 'Failed to load ledger');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadLedger();
    }, [loadLedger]);

    // Handler for when a new transaction is added
    const handleTransactionAdded = useCallback(async (newContent: string) => {
        setLedgerContent(newContent);
        // Recompute everything
        const parsedLedger = parseLedger(newContent);
        setParsed(parsedLedger);
        setPrices(parsedLedger.simplePrices);

        const accountBalances = computeBalances(parsedLedger, parsedLedger.simplePrices);
        setBalances(accountBalances);

        const allocationConfig = await getAllocationConfig();
        const computedKPIs = computeKPIs(accountBalances, allocationConfig);
        setKpis(computedKPIs);
    }, []);

    const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
        { id: 'overview', label: 'Overview', icon: TrendingUp },
        { id: 'add', label: 'Add', icon: Plus },
        { id: 'raw', label: 'Raw Data', icon: Table },
        { id: 'evolution', label: 'Evolution', icon: LineChart },
    ];

    return (
        <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <PiggyBank className="w-8 h-8 text-emerald-600" />
                    <h1 className="text-2xl font-bold">Savings</h1>
                </div>
                {parsed && (
                    <span className="text-xs text-gray-500 font-mono">
                        {parsed.transactions.length} transactions
                    </span>
                )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-zinc-700 overflow-x-auto">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap",
                            activeTab === tab.id
                                ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        )}
                    >
                        <tab.icon className="w-4 h-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Error */}
            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-red-800 dark:text-red-400">
                    <div className="flex items-center gap-2 font-medium mb-1">
                        <AlertCircle className="w-4 h-4" />
                        Error Loading Ledger
                    </div>
                    <p className="text-sm">{error}</p>
                    <button
                        onClick={loadLedger}
                        className="mt-3 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline"
                    >
                        Try Again
                    </button>
                </div>
            )}

            {/* Loading */}
            {isLoading && (
                <div className="flex justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                </div>
            )}

            {/* Tab Content */}
            {!isLoading && !error && (
                <>
                    {activeTab === 'overview' && kpis && balances.length > 0 && (
                        <OverviewTab kpis={kpis} balances={balances} />
                    )}

                    {activeTab === 'add' && parsed && (
                        <AddTransactionTab
                            accounts={[...parsed.accounts]}
                            currentContent={ledgerContent}
                            onTransactionAdded={handleTransactionAdded}
                        />
                    )}

                    {activeTab === 'raw' && balances.length > 0 && (
                        <RawDataTab balances={balances} />
                    )}

                    {activeTab === 'evolution' && parsed && prices && (
                        <Suspense
                            fallback={
                                <div className="flex justify-center p-12">
                                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                                </div>
                            }
                        >
                            <AssetsEvolutionTab
                                parsed={parsed}
                                prices={prices}
                            />
                        </Suspense>
                    )}

                    {/* Empty state */}
                    {balances.length === 0 && !isLoading && !error && (
                        <div className="text-center p-12 text-gray-500 bg-gray-50 dark:bg-zinc-900/50 rounded-2xl border-2 border-dashed border-gray-200 dark:border-zinc-800">
                            No data in ledger yet. Add your first transaction!
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
