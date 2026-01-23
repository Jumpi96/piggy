import { useState, useMemo } from 'react';
import { Plus, Trash2, Check, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
    Decimal,
    formatTransaction,
    getTodayDate,
    appendTransaction,
    type FormPosting,
} from '../../lib/ledger';

interface Props {
    accounts: string[];
    currentContent: string;
    onTransactionAdded: (newContent: string) => void;
}

interface PostingInput {
    id: string;
    account: string;
    amountStr: string;
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

export function AddTransactionTab({ accounts, currentContent, onTransactionAdded }: Props) {
    const [date, setDate] = useState(getTodayDate());
    const [description, setDescription] = useState('');
    const [postings, setPostings] = useState<PostingInput[]>([
        { id: crypto.randomUUID(), account: '', amountStr: '' },
        { id: crypto.randomUUID(), account: '', amountStr: '' },
    ]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitSuccess, setSubmitSuccess] = useState(false);

    // Sort accounts for autocomplete
    const sortedAccounts = useMemo(() => [...accounts].sort(), [accounts]);

    // Convert inputs to Posting objects for validation
    const parsedPostings = useMemo((): FormPosting[] => {
        return postings
            .filter(p => p.account.trim())
            .map(p => ({
                account: p.account.trim(),
                amount: parseAmountInput(p.amountStr) || undefined,
            }));
    }, [postings]);

    // Validate postings
    const validation = useMemo(() => {
        if (parsedPostings.length < 2) {
            return { isValid: false, errors: [{ lineNumber: 0, message: 'At least 2 postings required' }] };
        }

        // Simple balancing check for the UI
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
    }, [parsedPostings]);

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

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validation.isValid) return;
        if (!description.trim()) return;

        setIsSubmitting(true);
        setSubmitError(null);
        setSubmitSuccess(false);

        try {
            const txStr = formatTransaction(date, description.trim(), parsedPostings);
            const newContent = await appendTransaction(currentContent, txStr, description.trim());

            // Reset form
            setDescription('');
            setPostings([
                { id: crypto.randomUUID(), account: '', amountStr: '' },
                { id: crypto.randomUUID(), account: '', amountStr: '' },
            ]);
            setSubmitSuccess(true);

            // Notify parent
            onTransactionAdded(newContent);

            // Clear success message after a few seconds
            setTimeout(() => setSubmitSuccess(false), 3000);

        } catch (err) {
            console.error('Failed to submit transaction:', err);
            setSubmitError(err instanceof Error ? err.message : 'Failed to submit');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
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
                        Transaction added successfully!
                    </div>
                )}

                {/* Submit Button */}
                <button
                    type="submit"
                    disabled={!validation.isValid || !description.trim() || isSubmitting}
                    className={cn(
                        "w-full py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2",
                        validation.isValid && description.trim() && !isSubmitting
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-gray-200 dark:bg-zinc-700 text-gray-500 dark:text-zinc-500 cursor-not-allowed"
                    )}
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Submitting...
                        </>
                    ) : (
                        <>
                            <Plus className="w-5 h-5" />
                            Add Transaction
                        </>
                    )}
                </button>
            </form>

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
        </div>
    );
}
