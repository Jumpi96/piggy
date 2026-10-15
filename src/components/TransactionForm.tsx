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
    confirmImportEntry, confirmImportEntryAsInstallments, upsertParameter,
    fetchBalanceEntriesForTransactions, insertBalanceEntry, updateBalanceEntryAmount, deleteBalanceEntry, detachBalanceEntry,
    type TransactionInput
} from '../lib/api';
import {
    DEFAULT_IMPORT_SETTINGS, IMPORT_SETTINGS_KEY, entryInstallments, entryToDraft, installmentAmountCents,
    installmentEndDate, installmentNote, matchCardRule,
} from '../lib/imports';
import { calculateCreditCardEffectiveDate, getTodayLocalDate, parseLocalDate, formatLocalDate, shouldDeriveCardEffectiveDate } from '../lib/dates';
import type { BalanceEntry, Currency, CreditCard, Direction, ImportEntry, ImportSettings, PaymentMethod, Transaction } from '../types';
import { useNavigate } from 'react-router-dom';
import { cn, normalizeForComparison } from '../lib/utils';
import { sortCreditCards } from '../lib/creditCards';
import { exceptionDatesFrom } from '../lib/recurringUtils';
import { Loader2 } from 'lucide-react';
import { AmountInput } from './AmountInput';
import { evaluateAmountExpression } from '../lib/amountExpression';
import { signedBalanceCents } from '../lib/balance';

type LinkedBalanceAction = 'keep' | 'detach' | 'remove';

const shortDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Nov 3, 2026" for a YYYY-MM-DD date. */
function formatShortDate(dateStr: string): string {
    return shortDateFormat.format(parseLocalDate(dateStr));
}

export function TransactionForm({ initialData, onSuccess, onCancel, mode = 'edit', defaultCardId, importEntry, importSettings }: {
    initialData?: Transaction,
    onSuccess?: () => void,
    onCancel?: () => void,
    mode?: 'edit' | 'clone',
    defaultCardId?: string,
    // Confirming an Inbox entry: prefill from it, save as a new transaction and mark it confirmed.
    importEntry?: ImportEntry,
    importSettings?: ImportSettings,
}) {
    const navigate = useNavigate();
    const [importDraft] = useState(() =>
        importEntry ? entryToDraft(importEntry, importSettings ?? DEFAULT_IMPORT_SETTINGS) : null
    );
    const [rememberCard, setRememberCard] = useState(false);
    // Bought in cuotas: saved as a monthly recurring rule, one occurrence per cuota, unless
    // the user switches it off to book the whole amount at once.
    const cuotas = entryInstallments(importEntry);
    const [asInstallments, setAsInstallments] = useState(cuotas != null);
    const [installmentDraft] = useState(() =>
        cuotas != null && importEntry?.amount_cents != null
            ? {
                amount: (installmentAmountCents(importEntry.amount_cents, cuotas) / 100).toString(),
                note: installmentNote(importEntry.description, importEntry.amount_cents, cuotas),
            }
            : null
    );
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reference Data
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
    const [allTags, setAllTags] = useState<string[]>([]);

    // Form State
    const [direction, setDirection] = useState<Direction>(initialData?.direction || importDraft?.direction || 'expense');
    const [amount, setAmount] = useState(initialData ? (initialData.amount_cents / 100).toString() : installmentDraft?.amount ?? importDraft?.amount ?? '');
    const [currencyCode, setCurrencyCode] = useState(initialData?.currency_code || importDraft?.currency_code || 'USD');
    const [date, setDate] = useState(initialData?.date || importDraft?.date || getTodayLocalDate());
    const [category, setCategory] = useState(initialData?.category || '');
    const [tag, setTag] = useState(initialData?.tag || '');
    // When opening a fresh form from the Credit Report (no initialData), preselect
    // the card the user is currently reviewing so a new item lands on that card.
    // Cuotas are always on a credit card: with no card rule for the entry, start on 'card'
    // with no card picked, so it has to be chosen rather than silently saved as cash.
    const [method, setMethod] = useState<PaymentMethod>(initialData?.payment_method || (cuotas != null ? 'card' : importDraft?.payment_method) || (!initialData && defaultCardId ? 'card' : 'cash'));
    const [cardId, setCardId] = useState(initialData?.credit_card_id || importDraft?.credit_card_id || (!initialData ? defaultCardId ?? '' : ''));
    // Balance: put (part of) this transaction into the month's balance ledger. The amount
    // follows the transaction's until it's edited by hand.
    const [balanceOn, setBalanceOn] = useState(false);
    const [balanceAmount, setBalanceAmount] = useState(amount);
    const [balanceAmountEdited, setBalanceAmountEdited] = useState(false);
    // Entries already made from this transaction (editing only). They don't follow the
    // transaction, so each is kept (amount editable), detached or removed on save.
    const [linkedEntries, setLinkedEntries] = useState<BalanceEntry[]>([]);
    const [linkedActions, setLinkedActions] = useState<Record<string, LinkedBalanceAction>>({});
    const [linkedAmounts, setLinkedAmounts] = useState<Record<string, string>>({});
    const [note, setNote] = useState(initialData?.note || installmentDraft?.note || importDraft?.note || '');
    const [editType, setEditType] = useState<'this' | 'future' | null>(null);

    // Tag Autocomplete State
    const [showTagSuggestions, setShowTagSuggestions] = useState(false);
    const tagInputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);

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

                if (!initialData && !importDraft?.currency_code && sortedCurrencies.length > 0) {
                    setCurrencyCode(sortedCurrencies[0].code);
                }
                setCreditCards(sortCreditCards(cardData));
                setAllTags(tagData);
            } catch (err) {
                console.error("Failed to load reference data", err);
                setError("Failed to load currencies or cards. Check console.");
            }
        }
        loadData();
    }, [initialData, importDraft]);

    useEffect(() => {
        if (!balanceAmountEdited) setBalanceAmount(amount);
    }, [amount, balanceAmountEdited]);

    useEffect(() => {
        if (!initialData || mode === 'clone' || initialData.id.startsWith('virtual-')) return;
        fetchBalanceEntriesForTransactions([initialData.id])
            .then(entries => {
                setLinkedEntries(entries);
                setLinkedAmounts(Object.fromEntries(entries.map(e => [e.id, (Math.abs(e.amount_cents) / 100).toString()])));
            })
            .catch(err => console.error('Failed to load balance entries', err));
    }, [initialData, mode]);

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


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            // Evaluate any pending calculator expression (e.g. "100+20") so it isn't truncated
            const amountValue = evaluateAmountExpression(amount);
            if (amountValue === null || amountValue <= 0) throw new Error("Invalid amount");
            if (!category) throw new Error("Category is required");
            if (!tag) throw new Error("Tag is required");
            if (method === 'card' && !cardId) throw new Error("Credit card is required");
            if (asInstallments && cuotas != null && method !== 'card') {
                throw new Error("Cuotas are paid with a credit card: pick the card, or switch cuotas off");
            }
            const balanceValue = showBalance && balanceOn ? evaluateAmountExpression(balanceAmount) : null;
            if (showBalance && balanceOn && (balanceValue === null || balanceValue <= 0)) throw new Error("Invalid balance amount");
            const linkedValues: Record<string, number> = {};
            for (const entry of linkedEntries) {
                if ((linkedActions[entry.id] ?? 'keep') !== 'keep') continue;
                const value = evaluateAmountExpression(linkedAmounts[entry.id] ?? '');
                if (value === null || value <= 0) throw new Error("Invalid balance amount");
                linkedValues[entry.id] = value;
            }

            // Normalize tag: if it matches an existing tag case-and-accent-insensitively, use that casing
            const normTag = normalizeForComparison(tag);
            const existingTag = allTags.find(t => normalizeForComparison(t) === normTag);
            const finalTag = existingTag || tag.trim();

            const amountCents = Math.round(amountValue * 100);

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
                note: note || null
            };

            // The transaction a new balance entry links to (none when saving a rule).
            let savedId: string | null = null;

            if (importEntry) {
                if (asInstallments && cuotas != null) {
                    // dateStr is the first cuota: the card's payment date for the purchase.
                    await confirmImportEntryAsInstallments(importEntry.id, {
                        direction,
                        amount_cents: amountCents,
                        currency_code: currencyCode,
                        category,
                        tag: finalTag,
                        payment_method: method,
                        credit_card_id: method === 'card' ? cardId : null,
                        schedule_type: 'monthly_day',
                        schedule_config: { n: 1 },
                        start_date: dateStr,
                        end_date: installmentEndDate(dateStr, cuotas),
                        note: note || null,
                    });
                } else {
                    savedId = (await confirmImportEntry(importEntry.id, { ...transactionMeta, recurring_rule_id: null })).id;
                }
                if (canRememberCard && rememberCard) {
                    const settings = importSettings ?? DEFAULT_IMPORT_SETTINGS;
                    await upsertParameter(IMPORT_SETTINGS_KEY, {
                        ...settings,
                        card_rules: [
                            ...settings.card_rules,
                            { text: importEntry.account_ref ?? '', field: 'account_ref', credit_card_id: cardId },
                        ],
                    });
                }
            } else if (mode === 'clone') {
                savedId = (await insertTransaction({ ...transactionMeta, recurring_rule_id: null })).id;
            } else if (initialData?.recurring_rule_id) {
                if (editType === 'this' || !editType) {
                    // Edit this instance: save as physical with original_date
                    const tx: TransactionInput = {
                        ...transactionMeta,
                        recurring_rule_id: initialData.recurring_rule_id,
                        original_date: initialData.original_date || initialData.date,
                    };
                    if (initialData.id.startsWith('virtual-')) {
                        savedId = (await insertTransaction(tx)).id;
                    } else {
                        savedId = (await updateTransaction(initialData.id, tx)).id;
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
                        // Carry over the occurrences already skipped from the split onwards
                        exception_dates: exceptionDatesFrom(rule.exception_dates, formatLocalDate(occurrenceDate))
                    } as any); // Cast to any to allow partial type match

                    // Migrate future physical transactions to the new rule
                    await migrateFutureTransactions(rule.id, newRuleId, dateStr);
                }
            } else if (initialData) {
                savedId = (await updateTransaction(initialData.id, { ...transactionMeta, recurring_rule_id: null })).id;
            } else {
                savedId = (await insertTransaction({ ...transactionMeta, recurring_rule_id: null })).id;
            }

            for (const entry of linkedEntries) {
                const action = linkedActions[entry.id] ?? 'keep';
                if (action === 'remove') {
                    await deleteBalanceEntry(entry.id);
                } else if (action === 'detach') {
                    await detachBalanceEntry(entry.id);
                } else {
                    const cents = Math.round(linkedValues[entry.id] * 100);
                    if (cents !== Math.abs(entry.amount_cents)) {
                        await updateBalanceEntryAmount(entry.id, Math.sign(entry.amount_cents || 1) * cents);
                    }
                }
            }

            if (balanceValue !== null && savedId) {
                await insertBalanceEntry({
                    date: dateStr,
                    amount_cents: signedBalanceCents(direction, Math.round(balanceValue * 100)),
                    currency_code: currencyCode,
                    exchange_rate_id: exchangeRateId,
                    transaction_id: savedId,
                });
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

    // A balance entry links to one saved transaction, so not when saving a rule
    // (cuotas, or "all future ones").
    const savesRule = (asInstallments && cuotas != null) ||
        (mode !== 'clone' && !!initialData?.recurring_rule_id && editType === 'future');
    const showBalance = !savesRule;

    // Switching cuotas on/off swaps the amount (per cuota vs total) and the default note, but
    // keeps a note the user already edited.
    const toggleInstallments = (on: boolean) => {
        setAsInstallments(on);
        if (!installmentDraft || !importDraft) return;
        setAmount(on ? installmentDraft.amount : importDraft.amount);
        setNote(current => {
            if (on && current === importDraft.note) return installmentDraft.note;
            if (!on && current === installmentDraft.note) return importDraft.note;
            return current;
        });
    };

    // First and last cuota, as they will be saved: the first one on the card's payment date.
    const installmentPreview = (() => {
        if (!asInstallments || cuotas == null || !date) return null;
        let first = parseLocalDate(date);
        if (method === 'card') {
            const card = creditCards.find(c => c.id === cardId);
            if (!card) return null;
            first = calculateCreditCardEffectiveDate(first, card.closing_day, card.payment_day);
        }
        const start = formatLocalDate(first);
        return { start, end: installmentEndDate(start, cuotas) };
    })();

    // Offer to remember a hand-picked card for this entry's card reference, unless a rule
    // already maps it to the chosen card.
    const canRememberCard = !!importEntry?.account_ref && method === 'card' && !!cardId &&
        matchCardRule(importEntry, (importSettings ?? DEFAULT_IMPORT_SETTINGS).card_rules)?.credit_card_id !== cardId;

    // Filter tags: match text case-and-accent-insensitively
    const filteredTags = allTags.filter(t => normalizeForComparison(t).includes(normalizeForComparison(tag)));

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

            {/* Imported entry bought in cuotas */}
            {cuotas != null && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 p-3 rounded-xl text-sm text-amber-800 dark:text-amber-200 space-y-1">
                    <label className="flex items-center gap-2 font-medium cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={asInstallments}
                            onChange={(e) => toggleInstallments(e.target.checked)}
                            className="w-4 h-4 accent-amber-600"
                        />
                        Pay in {cuotas} cuotas
                    </label>
                    <p className="text-xs">
                        {!asInstallments
                            ? <>Bought in {cuotas} cuotas. Switch this on to save one monthly recurring item per cuota.</>
                            : installmentPreview
                                ? <>Saved as a monthly recurring item: {cuotas} cuotas from {formatShortDate(installmentPreview.start)} to {formatShortDate(installmentPreview.end)}.</>
                                : <>Saved as a monthly recurring item, one per cuota. Pick the credit card to see when they fall.</>}
                    </p>
                </div>
            )}

            {/* Recurring Edit Choice */}
            {mode !== 'clone' && initialData?.recurring_rule_id && (
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
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{asInstallments && cuotas != null ? 'Amount per cuota' : 'Amount'}</label>

                    <AmountInput
                        value={amount}
                        onChange={setAmount}
                        className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent text-xl font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
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

            {canRememberCard && (
                <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                    <input
                        type="checkbox"
                        id="rememberCard"
                        checked={rememberCard}
                        onChange={(e) => setRememberCard(e.target.checked)}
                        className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <label htmlFor="rememberCard" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                        Always use this card for <span className="font-mono text-xs">{importEntry?.account_ref}</span>
                    </label>
                </div>
            )}

            {/* Balance */}
            {showBalance && (
                <div className="p-3 rounded-xl border border-gray-100 dark:border-zinc-800 space-y-3">
                    {linkedEntries.map(entry => {
                        const action = linkedActions[entry.id] ?? 'keep';
                        return (
                            <div key={entry.id} className="space-y-2">
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    In this month's balance: {entry.amount_cents >= 0 ? '+' : '−'}{entry.currency_code} {(Math.abs(entry.amount_cents) / 100).toLocaleString('en-US')}
                                </p>
                                <div className="flex bg-gray-100 dark:bg-zinc-800 p-1 rounded-lg">
                                    {(['keep', 'detach', 'remove'] as const).map(a => (
                                        <button
                                            key={a}
                                            type="button"
                                            onClick={() => setLinkedActions(prev => ({ ...prev, [entry.id]: a }))}
                                            className={cn(
                                                "flex-1 py-1.5 rounded-md text-xs font-semibold transition-all",
                                                action === a
                                                    ? "bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm"
                                                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                            )}
                                        >
                                            {a === 'keep' ? 'Keep' : a === 'detach' ? 'Detach' : 'Remove'}
                                        </button>
                                    ))}
                                </div>
                                {action === 'keep' && (
                                    <div className="relative flex items-center gap-2">
                                        <AmountInput
                                            value={linkedAmounts[entry.id] ?? ''}
                                            onChange={v => setLinkedAmounts(prev => ({ ...prev, [entry.id]: v }))}
                                            className="flex-1 min-w-0 p-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
                                        />
                                        <span className="text-sm text-gray-500">{entry.currency_code}</span>
                                    </div>
                                )}
                                <p className="text-xs text-gray-400">
                                    {action === 'keep' && "It doesn't follow changes to the transaction — adjust it here if needed."}
                                    {action === 'detach' && 'Stays in the balance, no longer linked to this transaction.'}
                                    {action === 'remove' && 'Taken out of the balance.'}
                                </p>
                            </div>
                        );
                    })}

                    <div className="flex items-center gap-3">
                        <input
                            type="checkbox"
                            id="balanceOn"
                            checked={balanceOn}
                            onChange={(e) => setBalanceOn(e.target.checked)}
                            className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                        <label htmlFor="balanceOn" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                            {linkedEntries.length > 0 ? 'Balance another amount' : 'Balance it'}{' '}
                            <span className="text-gray-400 text-xs block sm:inline">(outside the budget, e.g. unexpected {direction})</span>
                        </label>
                    </div>
                    {balanceOn && (
                        <div className="space-y-1">
                            <div className="relative flex items-center gap-2">
                                <AmountInput
                                    value={balanceAmount}
                                    onChange={v => { setBalanceAmount(v); setBalanceAmountEdited(true); }}
                                    className="flex-1 min-w-0 p-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                                <span className="text-sm text-gray-500">{currencyCode}</span>
                            </div>
                            <p className="text-xs text-gray-400">
                                {direction === 'expense'
                                    ? 'Adds this amount to what this month needs from savings.'
                                    : 'Takes this amount off what this month needs from savings.'}
                                {' '}Defaults to the full amount — change it to balance only part.
                            </p>
                        </div>
                    )}
                </div>
            )}

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
