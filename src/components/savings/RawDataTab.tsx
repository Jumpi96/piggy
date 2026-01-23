import { useState, useMemo } from 'react';
import { List, FolderTree, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { type AccountBalance, type BalanceNode, buildBalanceTree, Decimal } from '../../lib/ledger';

interface Props {
    balances: AccountBalance[];
}

type ViewMode = 'flat' | 'tree';

const formatUSD = (value: Decimal) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value.toNumber());
};

const formatBalance = (balances: Map<string, Decimal>) => {
    const parts: string[] = [];
    for (const [commodity, quantity] of balances) {
        if (quantity.isZero()) continue;
        if (commodity === '$' || commodity === 'USD') {
            parts.push(formatUSD(quantity));
        } else {
            parts.push(`${quantity.toString()} ${commodity}`);
        }
    }
    return parts.length > 0 ? parts.join(', ') : '-';
};

function TreeNode({ node, depth = 0 }: { node: BalanceNode; depth?: number }) {
    const [isExpanded, setIsExpanded] = useState(depth < 2);
    const hasChildren = node.children.size > 0;
    const isLeaf = !hasChildren;

    // Sort children by name
    const sortedChildren = useMemo(() => {
        return [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [node.children]);

    return (
        <div>
            <div
                className={cn(
                    "flex items-center gap-2 py-2 px-3 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-lg cursor-pointer",
                    depth === 0 && "font-bold"
                )}
                style={{ paddingLeft: `${depth * 20 + 12}px` }}
                onClick={() => hasChildren && setIsExpanded(!isExpanded)}
            >
                {hasChildren ? (
                    isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                    ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                    )
                ) : (
                    <span className="w-4" />
                )}

                <span className={cn(
                    "flex-1 truncate",
                    isLeaf ? "font-mono text-sm" : "font-medium"
                )}>
                    {node.name || 'Root'}
                </span>

                <span className={cn(
                    "font-mono text-sm shrink-0",
                    node.usdValue.isNegative()
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-600 dark:text-emerald-400"
                )}>
                    {formatUSD(node.usdValue)}
                </span>
            </div>

            {isExpanded && hasChildren && (
                <div>
                    {sortedChildren.map(child => (
                        <TreeNode key={child.fullPath} node={child} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function RawDataTab({ balances }: Props) {
    const [viewMode, setViewMode] = useState<ViewMode>('flat');

    // Build tree structure
    const tree = useMemo(() => buildBalanceTree(balances), [balances]);

    // Sort balances by account name for flat view
    const sortedBalances = useMemo(() => {
        return [...balances].sort((a, b) => a.account.localeCompare(b.account));
    }, [balances]);

    // Root children for tree view (skip the empty root node)
    const rootChildren = useMemo(() => {
        return [...tree.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [tree]);

    return (
        <div className="space-y-4">
            {/* View Mode Toggle */}
            <div className="flex items-center justify-between">
                <div className="inline-flex rounded-lg bg-gray-100 dark:bg-zinc-800 p-1 gap-1">
                    <button
                        className={cn(
                            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-2",
                            viewMode === 'flat'
                                ? "bg-white dark:bg-zinc-700 shadow-sm text-gray-900 dark:text-white"
                                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                        )}
                        onClick={() => setViewMode('flat')}
                    >
                        <List className="w-4 h-4" />
                        Flat
                    </button>
                    <button
                        className={cn(
                            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-2",
                            viewMode === 'tree'
                                ? "bg-white dark:bg-zinc-700 shadow-sm text-gray-900 dark:text-white"
                                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                        )}
                        onClick={() => setViewMode('tree')}
                    >
                        <FolderTree className="w-4 h-4" />
                        Tree
                    </button>
                </div>

                <span className="text-xs text-gray-500">
                    {balances.length} accounts
                </span>
            </div>

            {/* Flat View */}
            {viewMode === 'flat' && (
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-zinc-800 border-b border-gray-100 dark:border-zinc-700">
                            <tr>
                                <th className="px-4 py-3 font-medium text-gray-500">Account</th>
                                <th className="px-4 py-3 font-medium text-gray-500 text-right">Balance</th>
                                <th className="px-4 py-3 font-medium text-gray-500 text-right">USD Value</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                            {sortedBalances.map(balance => (
                                <tr key={balance.account} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                                    <td className="px-4 py-3 font-mono text-xs">
                                        {balance.account}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-xs text-gray-600 dark:text-gray-400">
                                        {formatBalance(balance.balances)}
                                    </td>
                                    <td className={cn(
                                        "px-4 py-3 text-right font-mono",
                                        balance.usdValue.isNegative()
                                            ? "text-red-600 dark:text-red-400"
                                            : "text-emerald-600 dark:text-emerald-400"
                                    )}>
                                        {formatUSD(balance.usdValue)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Tree View */}
            {viewMode === 'tree' && (
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-2">
                    {rootChildren.map(child => (
                        <TreeNode key={child.fullPath} node={child} />
                    ))}
                </div>
            )}
        </div>
    );
}
