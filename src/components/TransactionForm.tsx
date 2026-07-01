import { useState, useEffect, useRef } from 'react';
import { CATEGORIES, PAYMENT_METHODS } from '../lib/constants';
import {
    fetchCurrencies,
    fetchCreditCards,
    insertTransaction,
    updateTransaction,
    fetchExchangeRate,
    fetchDistinctTags,
    insertRecurringRule, updateRecurringRule, fetchRecurringRule, migrateFutureTransactions,
    type TransactionInput
} from '../lib/api';
import { calculateCreditCardEffectiveDate, getTodayLocalDate, parseLocalDate, formatLocalDate, shouldDeriveCardEffectiveDate } from '../lib/dates';
import type { Currency, CreditCard, Direction, PaymentMethod, Transaction } from '../types';
import { useNavigate } from 'react-router-dom';
import { cn, normalizeForComparison } from '../lib/utils';
import { Loader2, Plus, Minus, X, Divide, Equal } from 'lucide-react';

export function TransactionForm({ initialData, onSuccess, onCancel }: { initialData?: Transaction, onSuccess?: () => void, onCancel?: () => void }) {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reference Data
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
    const [allTags, setAllTags] = useState<string[]>([]);

    // Form State
    const [direction, setDirection] = useState<Direction>(initialData?.direction || 'expense');
    const [amount, setAmount] = useState(initialData ? (initialData.amount_cents / 100).toString() : '');
    const [currencyCode, setCurrencyCode] = useState(initialData?.currency_code || 'USD');
    const [date, setDate] = useState(initialData?.date || getTodayLocalDate());
    const [category, setCategory] = useState(initialData?.category || '');
    const [tag, setTag] = useState(initialData?.tag || '');
    const [method, setMethod] = useState<PaymentMethod>(initialData?.payment_method || 'cash');
    const [cardId, setCardId] = useState(initialData?.credit_card_id || '');
    const [toBeBalanced, setToBeBalanced] = useState(initialData?.to_be_balanced || false);
    const [note, setNote] = useState(initialData?.note || '');
    const [editType, setEditType] = useState<'this' | 'future' | null>(null);

    // Tag Autocomplete State
    const [showTagSuggestions, setShowTagSuggestions] = useState(false);
    const [isAmountFocused, setIsAmountFocused] = useState(false);
    const tagInputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const amountInputRef = useRef<HTMLInputElement>(null);
    const amountBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        async function loadData() {
            try {
                const [curData, cardData, tagData] = await Promise.all([
                    fetchCurrencies(),
                    fetchCreditCards(true),
                    fetchDistinctTags()
                ]);
                const sortedCurrencies = curData.sort((a, b) => a.code.localeCompare(b.code));
                setCurrencies(sortedCurrencies);

                if (!initialData && sortedCurrencies.length > 0) {
                    setCurrencyCode(sortedCurrencies[0].code);
                }
                setCreditCards(cardData);
                setAllTags(tagData);
            } catch (err) {
                console.error("Failed to load reference data", err);
                setError("Failed to load currencies or cards. Check console.");
            }
        }
        loadData();
    }, [initialData]);

    // Close suggestions on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node) &&
                tagInputRef.current && !tagInputRef.current.contains(event.target as Node)) {
                setShowTagSuggestions(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);


    const handleAmountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === '=') {
            e.preventDefault();
            calculateAmount();
        }
    };

    const calculateAmount = () => {
        try {
            // Only allow numbers and basic math operators
            const cleanExpr = amount.replace(/[^-+/()*.\d]/g, '');
            if (!cleanExpr) return;

            // Safe evaluation using Function constructor
            const result = new Function(`return (${cleanExpr})`)();

            if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
                setAmount((Math.round(result * 100) / 100).toString());
                // After successful calculation, we don't refocus, 
                // allowing the toolbar to disappear on the next tick if it's no longer a calculation
            }
        } catch (err) {
            console.error("Calculator error:", err);
        }
    };

    const insertOperator = (op: string) => {
        // Prevent double operators
        const lastChar = amount.slice(-1);
        if (['+', '-', '*', '/'].includes(lastChar) && ['+', '-', '*', '/'].includes(op)) {
            setAmount(amount.slice(0, -1) + op);
        } else {
            setAmount(amount + op);
        }
        amountInputRef.current?.focus();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            if (!amount || parseFloat(amount) <= 0) throw new Error("Invalid amount");
            if (!category) throw new Error("Category is required");
            if (!tag) throw new Error("Tag is required");
            if (method === 'card' && !cardId) throw new Error("Credit card is required");

            // Normalize tag: if it matches an existing tag case-and-accent-insensitively, use that casing
            const normTag = normalizeForComparison(tag);
            const existingTag = allTags.find(t => normalizeForComparison(t) === normTag);
            const finalTag = existingTag || tag.trim();

            const amountCents = Math.round(parseFloat(amount) * 100);

            // Effective Date Logic
            // Only derive the card effective date from a genuinely new/raw purchase date.
            // Re-applying it to an already-shifted stored date is non-idempotent and would
            // silently push the transaction one month forward on every edit (see
            // shouldDeriveCardEffectiveDate).
            let effectiveDate = parseLocalDate(date);
            if (method === 'card') {
                const card = creditCards.find(c => c.id === cardId);
                if (!card) throw new Error("Selected card not found");
                const shouldDerive = shouldDeriveCardEffectiveDate({
                    isNew: !initialData,
                    enteredDate: date,
                    storedDate: initialData?.date,
                    storedMethod: initialData?.payment_method,
                    storedCardId: initialData?.credit_card_id,
                    cardId,
                });
                if (shouldDerive) {
                    effectiveDate = calculateCreditCardEffectiveDate(effectiveDate, card.closing_day, card.payment_day);
                }
            }

            const dateStr = formatLocalDate(effectiveDate);

            // Exchange Rate
            const exchangeRateId = await fetchExchangeRate(currencyCode, dateStr);

            const transactionMeta = {
                direction,
                amount_cents: amountCents,
                currency_code: currencyCode,
                date: dateStr,
                category,
                tag: finalTag,
                payment_method: method,
                credit_card_id: method === 'card' ? cardId : null,
                exchange_rate_id: exchangeRateId,
                to_be_balanced: toBeBalanced,
                note: note || null
            };

            if (initialData?.recurring_rule_id) {
                if (editType === 'this' || !editType) {
                    // Edit this instance: save as physical with original_date
                    const tx: TransactionInput = {
                        ...transactionMeta,
                        recurring_rule_id: initialData.recurring_rule_id,
                        original_date: initialData.original_date || initialData.date,
                    };
                    if (initialData.id.startsWith('virtual-')) {
                        await insertTransaction(tx);
                    } else {
                        await updateTransaction(initialData.id, tx);
                    }
                } else {
                    // Edit future ones: split rule
                    const rule = await fetchRecurringRule(initialData.recurring_rule_id);
                    const occurrenceDate = parseLocalDate(initialData.original_date || initialData.date);
                    const dayBefore = new Date(occurrenceDate);
                    dayBefore.setDate(dayBefore.getDate() - 1);

                    // 1. Update existing rule to end before this occurrence
                    await updateRecurringRule(rule.id, { end_date: formatLocalDate(dayBefore) });

                    // 2. Create new rule
                    const newRuleId = crypto.randomUUID();
                    await insertRecurringRule({
                        ...rule,
                        id: newRuleId,
                        start_date: dateStr,
                        direction: transactionMeta.direction,
                        amount_cents: transactionMeta.amount_cents,
                        currency_code: transactionMeta.currency_code,
                        category: transactionMeta.category,
                        tag: transactionMeta.tag,
                        payment_method: transactionMeta.payment_method,
                        credit_card_id: transactionMeta.credit_card_id || undefined,
                        note: transactionMeta.note,
                        created_at: undefined, // Exclude created_at from the new rule
                        exception_dates: [] // Start with no exceptions for the new rule
                    } as any); // Cast to any to allow partial type match

                    // Migrate future physical transactions to the new rule
                    await migrateFutureTransactions(rule.id, newRuleId, dateStr);
                }
            } else if (initialData) {
                await updateTransaction(initialData.id, { ...transactionMeta, recurring_rule_id: null });
            } else {
                await insertTransaction({ ...transactionMeta, recurring_rule_id: null });
            }

            if (onSuccess) {
                onSuccess();
            } else {
                navigate('/transactions');
            }
        } catch (err: any) {
            setError(err.message || "Failed to create transaction");
        } finally {
            setIsLoading(false);
        }
    };

    const filteredCategories = CATEGORIES.filter(c => c.direction === direction);

    // Filter tags: match text case-and-accent-insensitively
    const filteredTags = allTags.filter(t => normalizeForComparison(t).includes(normalizeForComparison(tag)));

    // Show calculator if focused OR if there's an ongoing calculation (has operators)
    const hasCalculation = amount.length > 0 && !/^-?\d*\.?\d*$/.test(amount);
    const showCalculator = isAmountFocused || hasCalculation;

    return (
        <form onSubmit={handleSubmit} className="max-w-lg mx-auto bg-white dark:bg-zinc-900 p-6 pb-24 md:pb-6 rounded-xl shadow-lg border border-gray-100 dark:border-zinc-800 space-y-6">

            {/* Direction Tabs */}
            <div className="flex bg-gray-100 dark:bg-zinc-800 p-1 rounded-lg">
                <button
                    type="button"
                    onClick={() => setDirection('expense')}
                    className={cn(
                        "flex-1 py-2 rounded-md text-sm font-medium transition-all",
                        direction === 'expense'
                            ? "bg-white dark:bg-zinc-700 text-red-600 shadow-sm"
                            : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                >
                    Expense
                </button>
                <button
                    type="button"
                    onClick={() => setDirection('income')}
                    className={cn(
                        "flex-1 py-2 rounded-md text-sm font-medium transition-all",
                        direction === 'income'
                            ? "bg-white dark:bg-zinc-700 text-sky-600 shadow-sm"
                            : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                >
                    Income
                </button>
            </div>

            {/* Recurring Edit Choice */}
            {initialData?.recurring_rule_id && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 p-4 rounded-xl space-y-3">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">This is a recurring transaction. How do you want to save changes?</p>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setEditType('this')}
                            className={cn(
                                "flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all border",
                                editType === 'this' || !editType
                                    ? "bg-amber-100 dark:bg-amber-900/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100"
                                    : "bg-white dark:bg-zinc-800 border-gray-100 dark:border-zinc-700 text-gray-500"
                            )}
                        >
                            Just this one
                        </button>
                        <button
                            type="button"
                            onClick={() => setEditType('future')}
                            className={cn(
                                "flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all border",
                                editType === 'future'
                                    ? "bg-amber-100 dark:bg-amber-900/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100"
                                    : "bg-white dark:bg-zinc-800 border-gray-100 dark:border-zinc-700 text-gray-500"
                            )}
                        >
                            All future ones
                        </button>
                    </div>
                </div>
            )}

            {/* Amount & Currency */}
            <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-2 relative">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Amount</label>

                    {/* Calculator Toolbar */}
                    {showCalculator && (
                        <div className="absolute bottom-full left-0 right-0 mb-2 flex gap-1 bg-gray-100 dark:bg-zinc-800 p-1.5 rounded-lg shadow-sm animate-in slide-in-from-bottom-2 z-10">
                            {[
                                { op: '+', icon: Plus },
                                { op: '-', icon: Minus },
                                { op: '*', icon: X },
                                { op: '/', icon: Divide },
                            ].map(({ op, icon: Icon }) => (
                                <button
                                    key={op}
                                    type="button"
                                    onClick={() => insertOperator(op)}
                                    className="flex-1 h-10 flex items-center justify-center bg-white dark:bg-zinc-700 rounded text-gray-700 dark:text-gray-200 shadow-sm hover:bg-gray-50 active:bg-gray-200 transition-colors"
                                >
                                    <Icon className="w-4 h-4" />
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={calculateAmount}
                                className="flex-1 h-10 flex items-center justify-center bg-emerald-600 text-white rounded shadow-sm hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
                            >
                                <Equal className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    <input
                        ref={amountInputRef}
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => {
                            // Replace comma with dot immediately
                            const val = e.target.value.replace(/,/g, '.');
                            // Allow digits, operators, dots, and parens
                            if (/^[0-9+\-*/().]*$/.test(val)) {
                                setAmount(val);
                            }
                        }}
                        onFocus={() => {
                            if (amountBlurTimeoutRef.current) clearTimeout(amountBlurTimeoutRef.current);
                            setIsAmountFocused(true);
                        }}
                        onBlur={() => {
                            // Small delay to allow button clicks on the toolbar
                            amountBlurTimeoutRef.current = setTimeout(() => setIsAmountFocused(false), 200);
                        }}
                        onKeyDown={handleAmountKeyDown}
                        placeholder="0.00"
                        className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent text-xl font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
                        autoComplete="off"
                        required
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Currency</label>
                    <select
                        value={currencyCode}
                        onChange={(e) => setCurrencyCode(e.target.value)}
                        className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent text-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                        {currencies.map(c => (
                            <option key={c.code} value={c.code}>{c.code}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Date */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Date</label>
                <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-emerald-500 outline-none"
                    required
                />
            </div>

            {/* Category */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Category</label>
                <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-emerald-500 outline-none"
                    required
                >
                    <option value="" disabled>Select category</option>
                    {filteredCategories.map(c => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                </select>
            </div>

            {/* Tag (Autocomplete) */}
            <div className="space-y-2 relative">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tag</label>
                <input
                    ref={tagInputRef}
                    type="text"
                    value={tag}
                    onFocus={() => setShowTagSuggestions(true)}
                    onChange={(e) => {
                        setTag(e.target.value);
                        setShowTagSuggestions(true);
                    }}
                    placeholder="Lunch, Groceries, etc."
                    className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-emerald-500 outline-none"
                    required
                    autoComplete="off"
                />

                {showTagSuggestions && filteredTags.length > 0 && (
                    <div
                        ref={suggestionsRef}
                        className="absolute z-10 w-full mt-1 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg max-h-48 overflow-y-auto"
                    >
                        {filteredTags.map((suggestion) => (
                            <button
                                key={suggestion}
                                type="button"
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
                                onClick={() => {
                                    setTag(suggestion);
                                    setShowTagSuggestions(false);
                                }}
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Note */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Note (Optional)</label>
                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add extra details..."
                    rows={2}
                    className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
                />
            </div>

            {/* Method */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Payment Method</label>
                    <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                        className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                        {PAYMENT_METHODS.map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                    </select>
                </div>

                {method === 'card' && (
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Card</label>
                        <select
                            value={cardId}
                            onChange={(e) => setCardId(e.target.value)}
                            className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-emerald-500 outline-none"
                            required
                        >
                            <option value="" disabled>Select card</option>
                            {creditCards.filter(c => c.enabled || c.id === cardId).map(c => (
                                <option key={c.id} value={c.id}>{c.name} {!c.enabled && '(Disabled)'}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {/* To Be Balanced */}
            <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                <input
                    type="checkbox"
                    id="toBeBalanced"
                    checked={toBeBalanced}
                    onChange={(e) => setToBeBalanced(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
                <label htmlFor="toBeBalanced" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                    Mark as "To be Balanced" <span className="text-gray-400 text-xs block sm:inline">(e.g. unexpected expense)</span>
                </label>
            </div>

            {/* Error Message */}
            {error && (
                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                    {error}
                </div>
            )}

            {/* Submit & Cancel */}
            <div className="flex gap-3">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="flex-1 py-4 bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors"
                        disabled={isLoading}
                    >
                        Cancel
                    </button>
                )}
                <button
                    type="submit"
                    disabled={isLoading}
                    className={cn(
                        "py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50",
                        onCancel ? "flex-[2]" : "w-full"
                    )}
                >
                    {isLoading ? <Loader2 className="animate-spin" /> : 'Save Transaction'}
                </button>
            </div>
        </form>
    );
}
