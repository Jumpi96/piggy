import { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, Check, AlertCircle, Loader2, ChevronLeft, ChevronRight, Save, Edit3, DollarSign, Receipt } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
    Decimal,
    formatTransaction,
    getTodayDate,
    appendTransaction,
    editTransaction,
    deleteTransaction,
    getTransactionsForEditing,
    commitLedger,
    type FormPosting,
    type ParsedLedger,
    type EditableTransaction,
} from '../../lib/ledger';

interface Props {
    accounts: string[];
    currentContent: string;
    parsed: ParsedLedger;
    onTransactionAdded: (newContent: string) => void;
}

interface PostingInput {
    id: string;
    account: string;
    amountStr: string;
}

interface PriceInput {
    id: string;
    commodity: string;
    price: string;
}

// Parse amount string into FormPosting amount or null
function parseAmountInput(str: string) {
    str = str.trim();
    if (!str) return null;

    let match = str.match(/^(-?)\$(-?\d+(?:\.\d+)?)$/);
    if (match) {
        const sign = match[1] === '-' ? '-' : '';
        const numStr = match[2].startsWith('-') ? match[2] : sign + match[2];
        return { quantity: numStr, commodity: '$' };
    }

    match = str.match(/^(-?\d+(?:\.\d+)?)\s+(\S+)$/);
    if (match) {
        return { quantity: match[1], commodity: match[2] };
    }

    match = str.match(/^(-?\d+(?:\.\d+)?)$/);
    if (match) {
        return { quantity: match[1], commodity: '$' };
    }

    return null;
}

// Format price lines for ledger
function formatPriceLines(date: string, prices: PriceInput[]): string {
    const formattedDate = date.replace(/-/g, '/');
    return prices
        .filter(p => p.commodity.trim() && p.price.trim())
        .map(p => `P ${formattedDate} ${p.commodity.trim()} $ ${p.price.trim()}`)
        .join('\n');
}

export function AddTransactionTab({ accounts, currentContent, parsed, onTransactionAdded }: Props) {
    // Top-level tab: transactions vs prices
    const [activeTab, setActiveTab] = useState<'transactions' | 'prices'>('transactions');

    // Transaction mode: add vs edit
    const [mode, setMode] = useState<'add' | 'edit'>('add');
    const [date, setDate] = useState(getTodayDate());
    const [description, setDescription] = useState('');
    const [postings, setPostings] = useState<PostingInput[]>([
        { id: crypto.randomUUID(), account: '', amountStr: '' },
        { id: crypto.randomUUID(), account: '', amountStr: '' },
    ]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Edit mode state
    const [currentTxIndex, setCurrentTxIndex] = useState(0);
    const [originalDate, setOriginalDate] = useState('');
    const [originalDescription, setOriginalDescription] = useState('');

    // Price state
    const [priceDate, setPriceDate] = useState(getTodayDate());
    const [priceInputs, setPriceInputs] = useState<PriceInput[]>([
        { id: crypto.randomUUID(), commodity: '', price: '' },
    ]);
    const [priceSubmitting, setPriceSubmitting] = useState(false);
    const [priceError, setPriceError] = useState<string | null>(null);
    const [priceSuccess, setPriceSuccess] = useState(false);

    // Get known commodities for autocomplete
    const knownCommodities = useMemo(() => {
        return [...parsed.commodities].filter(c => c !== '$').sort();
    }, [parsed.commodities]);

    // Get editable transactions (sorted newest first)
    const editableTransactions = useMemo((): EditableTransaction[] => {
        return getTransactionsForEditing(parsed.transactions);
    }, [parsed.transactions]);

    // Sort accounts for autocomplete
    const sortedAccounts = useMemo(() => [...accounts].sort(), [accounts]);

    // Load transaction into form when navigating in edit mode
    useEffect(() => {
        if (mode === 'edit' && editableTransactions.length > 0) {
            const tx = editableTransactions[currentTxIndex];
            if (tx) {
                setDate(tx.dateInput);
                setDescription(tx.description);
                setOriginalDate(tx.date);
                setOriginalDescription(tx.description);
                setPostings(
                    tx.postings.map(p => ({
                        id: crypto.randomUUID(),
                        account: p.account,
                        amountStr: p.amountStr,
                    }))
                );
            }
        }
    }, [mode, currentTxIndex, editableTransactions]);

    // Reset form when switching to add mode
    useEffect(() => {
        if (mode === 'add') {
            setDate(getTodayDate());
            setDescription('');
            setPostings([
                { id: crypto.randomUUID(), account: '', amountStr: '' },
                { id: crypto.randomUUID(), account: '', amountStr: '' },
            ]);
            setOriginalDate('');
            setOriginalDescription('');
        }
    }, [mode]);

    // Convert inputs to Posting objects for validation
    const parsedPostings = useMemo((): FormPosting[] => {
        return postings
            .filter(p => p.account.trim())
            .map(p => ({
                account: p.account.trim(),
                amount: parseAmountInput(p.amountStr) || undefined,
            }));
    }, [postings]);

    // Track invalid (non-empty but unparsable) amounts separately from true elided amounts
    const invalidAmountRows = useMemo(() => {
        return postings
            .filter(p => p.account.trim())
            .map((p, index) => ({
                row: index + 1,
                isInvalid: Boolean(p.amountStr.trim()) && !parseAmountInput(p.amountStr),
            }))
            .filter(r => r.isInvalid)
            .map(r => r.row);
    }, [postings]);

    // Validate postings
    const validation = useMemo(() => {
        if (parsedPostings.length < 2) {
            return { isValid: false, errors: [{ lineNumber: 0, message: 'At least 2 postings required' }] };
        }

        if (invalidAmountRows.length > 0) {
            return {
                isValid: false,
                errors: [{
                    lineNumber: 0,
                    message: `Invalid amount format in row${invalidAmountRows.length > 1 ? 's' : ''} ${invalidAmountRows.join(', ')}`,
                }],
            };
        }

        const sums = new Map<string, Decimal>();
        let elidedCount = 0;
        for (const p of parsedPostings) {
            if (!p.amount) {
                elidedCount++;
                continue;
            }
            const q = new Decimal(p.amount.quantity);
            const current = sums.get(p.amount.commodity) ?? new Decimal(0);
            sums.set(p.amount.commodity, current.plus(q));
        }

        if (elidedCount > 1) {
            return { isValid: false, errors: [{ lineNumber: 0, message: 'Only one elided amount allowed' }] };
        }

        if (elidedCount === 0) {
            for (const [commodity, sum] of sums) {
                if (!sum.isZero()) {
                    return { isValid: false, errors: [{ lineNumber: 0, message: `${commodity} does not balance` }] };
                }
            }
        }

        return { isValid: true, errors: [] };
    }, [invalidAmountRows, parsedPostings]);

    // Validate prices
    const priceValidation = useMemo(() => {
        const validPrices = priceInputs.filter(p => p.commodity.trim() && p.price.trim());
        if (validPrices.length === 0) {
            return { isValid: false, message: 'At least one price required' };
        }
        for (const p of validPrices) {
            if (isNaN(parseFloat(p.price))) {
                return { isValid: false, message: `Invalid price for ${p.commodity}` };
            }
        }
        return { isValid: true, message: '' };
    }, [priceInputs]);

    // Add new posting row
    const addPosting = () => {
        setPostings([...postings, { id: crypto.randomUUID(), account: '', amountStr: '' }]);
    };

    // Remove posting row
    const removePosting = (id: string) => {
        if (postings.length <= 2) return;
        setPostings(postings.filter(p => p.id !== id));
    };

    // Update posting field
    const updatePosting = (id: string, field: 'account' | 'amountStr', value: string) => {
        setPostings(postings.map(p =>
            p.id === id ? { ...p, [field]: value } : p
        ));
    };

    // Price row handlers
    const addPriceRow = () => {
        setPriceInputs([...priceInputs, { id: crypto.randomUUID(), commodity: '', price: '' }]);
    };

    const removePriceRow = (id: string) => {
        if (priceInputs.length <= 1) return;
        setPriceInputs(priceInputs.filter(p => p.id !== id));
    };

    const updatePriceRow = (id: string, field: 'commodity' | 'price', value: string) => {
        setPriceInputs(priceInputs.map(p =>
            p.id === id ? { ...p, [field]: value } : p
        ));
    };

    // Navigate transactions
    const goToPreviousTx = () => {
        if (currentTxIndex < editableTransactions.length - 1) {
            setCurrentTxIndex(currentTxIndex + 1);
        }
    };

    const goToNextTx = () => {
        if (currentTxIndex > 0) {
            setCurrentTxIndex(currentTxIndex - 1);
        }
    };

    // Handle transaction form submission (add or edit)
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validation.isValid) return;
        if (!description.trim()) return;

        setIsSubmitting(true);
        setSubmitError(null);
        setSubmitSuccess(false);

        try {
            const txStr = formatTransaction(date, description.trim(), parsedPostings);

            let newContent: string;
            if (mode === 'add') {
                newContent = await appendTransaction(currentContent, txStr, description.trim());
            } else {
                const commitMessage = `Edit transaction: ${originalDescription} -> ${description.trim()}`;
                newContent = await editTransaction(
                    currentContent,
                    originalDate,
                    originalDescription,
                    txStr,
                    commitMessage
                );
            }

            if (mode === 'add') {
                setDescription('');
                setPostings([
                    { id: crypto.randomUUID(), account: '', amountStr: '' },
                    { id: crypto.randomUUID(), account: '', amountStr: '' },
                ]);
            }
            setSubmitSuccess(true);
            onTransactionAdded(newContent);
            setTimeout(() => setSubmitSuccess(false), 3000);

        } catch (err) {
            console.error('Failed to submit transaction:', err);
            setSubmitError(err instanceof Error ? err.message : 'Failed to submit');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Handle price submission
    const handlePriceSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!priceValidation.isValid) return;

        setPriceSubmitting(true);
        setPriceError(null);
        setPriceSuccess(false);

        try {
            const priceLines = formatPriceLines(priceDate, priceInputs);

            // Append price lines to content
            const normalizedContent = currentContent.endsWith('\n')
                ? currentContent
                : currentContent + '\n';
            const updatedContent = normalizedContent + '\n' + priceLines + '\n';

            await commitLedger(updatedContent, `Add prices for ${priceDate}`);

            // Reset form
            setPriceInputs([{ id: crypto.randomUUID(), commodity: '', price: '' }]);
            setPriceSuccess(true);
            onTransactionAdded(updatedContent);
            setTimeout(() => setPriceSuccess(false), 3000);

        } catch (err) {
            console.error('Failed to submit prices:', err);
            setPriceError(err instanceof Error ? err.message : 'Failed to submit');
        } finally {
            setPriceSubmitting(false);
        }
    };

    // Handle delete
    const handleDelete = async () => {
        if (!originalDate || !originalDescription) return;

        setIsSubmitting(true);
        setSubmitError(null);

        try {
            const commitMessage = `Delete transaction: ${originalDescription}`;
            const newContent = await deleteTransaction(
                currentContent,
                originalDate,
                originalDescription,
                commitMessage
            );

            setShowDeleteConfirm(false);
            setSubmitSuccess(true);

            if (editableTransactions.length <= 1) {
                setMode('add');
            } else if (currentTxIndex >= editableTransactions.length - 1) {
                setCurrentTxIndex(Math.max(0, currentTxIndex - 1));
            }

            onTransactionAdded(newContent);
            setTimeout(() => setSubmitSuccess(false), 3000);

        } catch (err) {
            console.error('Failed to delete transaction:', err);
            setSubmitError(err instanceof Error ? err.message : 'Failed to delete');
        } finally {
            setIsSubmitting(false);
        }
    };

    const currentTx = mode === 'edit' ? editableTransactions[currentTxIndex] : null;

    return (
        <div className="space-y-6">
            {/* Top-level Tab: Transactions vs Prices */}
            <div className="flex gap-2 p-1 bg-gray-100 dark:bg-zinc-800 rounded-lg w-fit">
                <button
                    type="button"
                    onClick={() => setActiveTab('transactions')}
                    className={cn(
                        "px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                        activeTab === 'transactions'
                            ? "bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm"
                            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    )}
                >
                    <Receipt className="w-4 h-4" />
                    Transactions
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('prices')}
                    className={cn(
                        "px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                        activeTab === 'prices'
                            ? "bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm"
                            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    )}
                >
                    <DollarSign className="w-4 h-4" />
                    Prices
                </button>
            </div>

            {/* ===== TRANSACTIONS TAB ===== */}
            {activeTab === 'transactions' && (
                <>
                    {/* Mode Toggle: Add New / Edit Existing */}
                    <div className="flex gap-2 p-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg w-fit">
                        <button
                            type="button"
                            onClick={() => setMode('add')}
                            className={cn(
                                "px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5",
                                mode === 'add'
                                    ? "bg-white dark:bg-zinc-700 text-emerald-700 dark:text-emerald-300 shadow-sm"
                                    : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
                            )}
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Add New
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMode('edit');
                                setCurrentTxIndex(0);
                            }}
                            disabled={editableTransactions.length === 0}
                            className={cn(
                                "px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5",
                                mode === 'edit'
                                    ? "bg-white dark:bg-zinc-700 text-emerald-700 dark:text-emerald-300 shadow-sm"
                                    : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700",
                                editableTransactions.length === 0 && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            <Edit3 className="w-3.5 h-3.5" />
                            Edit Existing
                        </button>
                    </div>

                    {/* Transaction Navigator (Edit Mode) */}
                    {mode === 'edit' && editableTransactions.length > 0 && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <button
                                    type="button"
                                    onClick={goToPreviousTx}
                                    disabled={currentTxIndex >= editableTransactions.length - 1}
                                    className={cn(
                                        "p-2 rounded-lg transition-colors",
                                        currentTxIndex >= editableTransactions.length - 1
                                            ? "text-gray-300 dark:text-zinc-600 cursor-not-allowed"
                                            : "text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                                    )}
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>

                                <div className="text-center">
                                    <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                                        Transaction {currentTxIndex + 1} of {editableTransactions.length}
                                    </p>
                                    {currentTx && (
                                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                            {currentTx.date} - {currentTx.description}
                                        </p>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    onClick={goToNextTx}
                                    disabled={currentTxIndex <= 0}
                                    className={cn(
                                        "p-2 rounded-lg transition-colors",
                                        currentTxIndex <= 0
                                            ? "text-gray-300 dark:text-zinc-600 cursor-not-allowed"
                                            : "text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                                    )}
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Date & Description */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Date
                                </label>
                                <input
                                    type="date"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Description
                                </label>
                                <input
                                    type="text"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="e.g., Buy ETF shares"
                                    className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                                    required
                                />
                            </div>
                        </div>

                        {/* Postings */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Postings
                                </label>
                                <button
                                    type="button"
                                    onClick={addPosting}
                                    className="text-sm text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add Row
                                </button>
                            </div>

                            <div className="space-y-3">
                                {postings.map((posting) => (
                                    <div key={posting.id} className="flex gap-3 items-start">
                                        <div className="flex-1 space-y-1">
                                            <input
                                                type="text"
                                                value={posting.account}
                                                onChange={(e) => updatePosting(posting.id, 'account', e.target.value)}
                                                placeholder="Account (e.g., Assets:Bank:Checking)"
                                                list={`accounts-${posting.id}`}
                                                className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 font-mono text-sm"
                                            />
                                            <datalist id={`accounts-${posting.id}`}>
                                                {sortedAccounts.map(acc => (
                                                    <option key={acc} value={acc} />
                                                ))}
                                            </datalist>
                                        </div>
                                        <div className="w-36 space-y-1">
                                            <input
                                                type="text"
                                                value={posting.amountStr}
                                                onChange={(e) => updatePosting(posting.id, 'amountStr', e.target.value)}
                                                placeholder="$100 or 0.01 BTC"
                                                className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 font-mono text-sm text-right"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removePosting(posting.id)}
                                            disabled={postings.length <= 2}
                                            className={cn(
                                                "p-2 rounded-lg transition-colors",
                                                postings.length <= 2
                                                    ? "text-gray-300 dark:text-zinc-700 cursor-not-allowed"
                                                    : "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                            )}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Validation Status */}
                        <div className={cn(
                            "flex items-center gap-2 p-3 rounded-lg",
                            validation.isValid
                                ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                : "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
                        )}>
                            {validation.isValid ? (
                                <>
                                    <Check className="w-5 h-5" />
                                    <span className="text-sm font-medium">Transaction is balanced</span>
                                </>
                            ) : (
                                <>
                                    <AlertCircle className="w-5 h-5" />
                                    <div className="text-sm">
                                        <span className="font-medium">Not balanced: </span>
                                        {validation.errors.map((e: { message: string }, i: number) => (
                                            <span key={i}>{e.message}{i < validation.errors.length - 1 ? '; ' : ''}</span>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Submit Error */}
                        {submitError && (
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-700 dark:text-red-300 text-sm">
                                {submitError}
                            </div>
                        )}

                        {/* Submit Success */}
                        {submitSuccess && (
                            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-emerald-700 dark:text-emerald-300 text-sm flex items-center gap-2">
                                <Check className="w-4 h-4" />
                                {mode === 'add' ? 'Transaction added successfully!' : 'Transaction updated successfully!'}
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className={cn("flex gap-3", mode === 'edit' ? "justify-between" : "")}>
                            {mode === 'edit' && (
                                <button
                                    type="button"
                                    onClick={() => setShowDeleteConfirm(true)}
                                    disabled={isSubmitting}
                                    className="px-4 py-3 rounded-lg font-medium transition-colors flex items-center gap-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800"
                                >
                                    <Trash2 className="w-5 h-5" />
                                    Delete
                                </button>
                            )}

                            <button
                                type="submit"
                                disabled={!validation.isValid || !description.trim() || isSubmitting}
                                className={cn(
                                    "py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2",
                                    mode === 'add' ? "w-full" : "flex-1",
                                    validation.isValid && description.trim() && !isSubmitting
                                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                        : "bg-gray-200 dark:bg-zinc-700 text-gray-500 dark:text-zinc-500 cursor-not-allowed"
                                )}
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        {mode === 'add' ? 'Adding...' : 'Saving...'}
                                    </>
                                ) : mode === 'add' ? (
                                    <>
                                        <Plus className="w-5 h-5" />
                                        Add Transaction
                                    </>
                                ) : (
                                    <>
                                        <Save className="w-5 h-5" />
                                        Save Changes
                                    </>
                                )}
                            </button>
                        </div>
                    </form>

                    {/* Delete Confirmation Dialog */}
                    {showDeleteConfirm && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                            <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-md w-full shadow-xl">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                    Delete Transaction?
                                </h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                                    Are you sure you want to delete "{originalDescription}"? This action cannot be undone.
                                </p>
                                <div className="flex gap-3 justify-end">
                                    <button
                                        type="button"
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="px-4 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        disabled={isSubmitting}
                                        className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 flex items-center gap-2"
                                    >
                                        {isSubmitting ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="w-4 h-4" />
                                        )}
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Help text */}
                    <div className="bg-gray-50 dark:bg-zinc-800/50 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400">
                        <h4 className="font-medium mb-2">Amount Format Examples</h4>
                        <ul className="space-y-1 font-mono text-xs">
                            <li><code>$100.00</code> or <code>-$100.00</code> - US Dollars</li>
                            <li><code>100 USD</code> - Currency with code</li>
                            <li><code>0.01 BTC</code> - Cryptocurrency</li>
                            <li><code>10 SPY</code> - Stock shares</li>
                            <li><em>Empty</em> - Auto-balance (one posting only)</li>
                        </ul>
                    </div>
                </>
            )}

            {/* ===== PRICES TAB ===== */}
            {activeTab === 'prices' && (
                <form onSubmit={handlePriceSubmit} className="space-y-6">
                    {/* Date */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Price Date
                        </label>
                        <input
                            type="date"
                            value={priceDate}
                            onChange={(e) => setPriceDate(e.target.value)}
                            className="w-full md:w-auto p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                            required
                        />
                    </div>

                    {/* Price Rows */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Prices (in USD)
                            </label>
                            <button
                                type="button"
                                onClick={addPriceRow}
                                className="text-sm text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                            >
                                <Plus className="w-4 h-4" />
                                Add Row
                            </button>
                        </div>

                        <div className="space-y-3">
                            {priceInputs.map((price) => (
                                <div key={price.id} className="flex gap-3 items-center">
                                    <div className="w-32">
                                        <input
                                            type="text"
                                            value={price.commodity}
                                            onChange={(e) => updatePriceRow(price.id, 'commodity', e.target.value.toUpperCase())}
                                            placeholder="BTC, EUR..."
                                            list={`commodities-${price.id}`}
                                            className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 font-mono text-sm"
                                        />
                                        <datalist id={`commodities-${price.id}`}>
                                            {knownCommodities.map(c => (
                                                <option key={c} value={c} />
                                            ))}
                                        </datalist>
                                    </div>
                                    <span className="text-gray-500">=</span>
                                    <div className="flex-1 flex items-center gap-2">
                                        <span className="text-gray-500">$</span>
                                        <input
                                            type="text"
                                            value={price.price}
                                            onChange={(e) => updatePriceRow(price.id, 'price', e.target.value)}
                                            placeholder="0.00"
                                            className="flex-1 p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 font-mono text-sm text-right"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removePriceRow(price.id)}
                                        disabled={priceInputs.length <= 1}
                                        className={cn(
                                            "p-2 rounded-lg transition-colors",
                                            priceInputs.length <= 1
                                                ? "text-gray-300 dark:text-zinc-700 cursor-not-allowed"
                                                : "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                        )}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Validation */}
                    <div className={cn(
                        "flex items-center gap-2 p-3 rounded-lg",
                        priceValidation.isValid
                            ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                            : "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
                    )}>
                        {priceValidation.isValid ? (
                            <>
                                <Check className="w-5 h-5" />
                                <span className="text-sm font-medium">
                                    {priceInputs.filter(p => p.commodity.trim() && p.price.trim()).length} price(s) ready
                                </span>
                            </>
                        ) : (
                            <>
                                <AlertCircle className="w-5 h-5" />
                                <span className="text-sm font-medium">{priceValidation.message}</span>
                            </>
                        )}
                    </div>

                    {/* Error */}
                    {priceError && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-700 dark:text-red-300 text-sm">
                            {priceError}
                        </div>
                    )}

                    {/* Success */}
                    {priceSuccess && (
                        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-emerald-700 dark:text-emerald-300 text-sm flex items-center gap-2">
                            <Check className="w-4 h-4" />
                            Prices added successfully!
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={!priceValidation.isValid || priceSubmitting}
                        className={cn(
                            "w-full py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2",
                            priceValidation.isValid && !priceSubmitting
                                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                : "bg-gray-200 dark:bg-zinc-700 text-gray-500 dark:text-zinc-500 cursor-not-allowed"
                        )}
                    >
                        {priceSubmitting ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Adding...
                            </>
                        ) : (
                            <>
                                <Plus className="w-5 h-5" />
                                Add Prices
                            </>
                        )}
                    </button>

                    {/* Help text */}
                    <div className="bg-gray-50 dark:bg-zinc-800/50 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400">
                        <h4 className="font-medium mb-2">Price Format</h4>
                        <p className="text-xs mb-2">
                            Prices are stored as: <code className="font-mono">P YYYY/MM/DD COMMODITY $ PRICE</code>
                        </p>
                        <p className="text-xs">
                            Example: <code className="font-mono">P 2026/01/20 BTC $ 90059.30</code>
                        </p>
                    </div>
                </form>
            )}
        </div>
    );
}
