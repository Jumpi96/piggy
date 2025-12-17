import { useState, useEffect, useRef } from 'react';
import { CATEGORIES, PAYMENT_METHODS } from '../lib/constants';
import { fetchCurrencies, fetchCreditCards, insertTransaction, fetchExchangeRate, fetchDistinctTags, type TransactionInput } from '../lib/api';
import { calculateCreditCardEffectiveDate } from '../lib/dates';
import type { Currency, CreditCard, Direction, PaymentMethod } from '../types';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { Loader2 } from 'lucide-react';

export function TransactionForm() {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reference Data
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
    const [allTags, setAllTags] = useState<string[]>([]);

    // Form State
    const [direction, setDirection] = useState<Direction>('expense');
    const [amount, setAmount] = useState('');
    const [currencyCode, setCurrencyCode] = useState('USD');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [category, setCategory] = useState('');
    const [tag, setTag] = useState('');
    const [method, setMethod] = useState<PaymentMethod>('cash');
    const [cardId, setCardId] = useState('');
    const [toBeBalanced, setToBeBalanced] = useState(false);

    // Tag Autocomplete State
    const [showTagSuggestions, setShowTagSuggestions] = useState(false);
    const tagInputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        async function loadData() {
            try {
                const [curData, cardData, tagData] = await Promise.all([
                    fetchCurrencies(),
                    fetchCreditCards(),
                    fetchDistinctTags()
                ]);
                setCurrencies(curData);
                if (curData.length > 0) setCurrencyCode(curData[0].code);
                if (curData.some(c => c.code === 'USD')) setCurrencyCode('USD');

                setCreditCards(cardData);
                setAllTags(tagData);
            } catch (err) {
                console.error("Failed to load reference data", err);
                setError("Failed to load currencies or cards. Check console.");
            }
        }
        loadData();
    }, []);

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
            if (!amount || parseFloat(amount) <= 0) throw new Error("Invalid amount");
            if (!category) throw new Error("Category is required");
            if (!tag) throw new Error("Tag is required");
            if (method === 'card' && !cardId) throw new Error("Credit card is required");

            const amountCents = Math.round(parseFloat(amount) * 100);

            // Effective Date Logic
            let effectiveDate = new Date(date);
            if (method === 'card') {
                const card = creditCards.find(c => c.id === cardId);
                if (!card) throw new Error("Selected card not found");
                effectiveDate = calculateCreditCardEffectiveDate(effectiveDate, card.closing_day, card.payment_day);
            }

            const dateStr = effectiveDate.toISOString().split('T')[0];

            // Exchange Rate
            const exchangeRateId = await fetchExchangeRate(currencyCode, dateStr);

            const transaction: TransactionInput = {
                direction,
                amount_cents: amountCents,
                currency_code: currencyCode,
                date: dateStr,
                category,
                tag,
                payment_method: method,
                credit_card_id: method === 'card' ? cardId : null,
                exchange_rate_id: exchangeRateId,
                recurring_rule_id: null,
                to_be_balanced: toBeBalanced
            };

            await insertTransaction(transaction);

            navigate('/transactions');
        } catch (err: any) {
            setError(err.message || "Failed to create transaction");
        } finally {
            setIsLoading(false);
        }
    };

    const filteredCategories = CATEGORIES.filter(c => c.direction === direction);

    // Filter tags: match text
    const filteredTags = allTags.filter(t => t.toLowerCase().includes(tag.toLowerCase()));

    return (
        <form onSubmit={handleSubmit} className="max-w-lg mx-auto bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-lg border border-gray-100 dark:border-zinc-800 space-y-6">

            {/* Direction Tabs */}
            <div className="flex bg-gray-100 dark:bg-zinc-800 p-1 rounded-lg">
                <button
                    type="button"
                    onClick={() => setDirection('expense')}
                    className={cn(
                        "flex-1 py-2 rounded-md text-sm font-medium transition-all",
                        direction === 'expense'
                            ? "bg-white dark:bg-zinc-700 text-pink-600 shadow-sm"
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
                            ? "bg-white dark:bg-zinc-700 text-teal-600 shadow-sm"
                            : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                >
                    Income
                </button>
            </div>

            {/* Amount & Currency */}
            <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Amount</label>
                    <input
                        type="number"
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent text-xl font-bold focus:ring-2 focus:ring-pink-500 outline-none"
                        required
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Currency</label>
                    <select
                        value={currencyCode}
                        onChange={(e) => setCurrencyCode(e.target.value)}
                        className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent text-lg focus:ring-2 focus:ring-pink-500 outline-none"
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
                    className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-pink-500 outline-none"
                    required
                />
            </div>

            {/* Category */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Category</label>
                <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-pink-500 outline-none"
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
                    className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-pink-500 outline-none"
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

            {/* Method */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Payment Method</label>
                    <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                        className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-pink-500 outline-none"
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
                            className="w-full p-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-pink-500 outline-none"
                            required
                        >
                            <option value="" disabled>Select card</option>
                            {creditCards.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
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
                    className="w-5 h-5 rounded border-gray-300 text-pink-600 focus:ring-pink-500 cursor-pointer"
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

            {/* Submit */}
            <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-pink-600 text-white rounded-xl font-bold hover:bg-pink-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
                {isLoading ? <Loader2 className="animate-spin" /> : 'Save Transaction'}
            </button>
        </form>
    );
}
