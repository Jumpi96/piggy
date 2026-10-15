import { useRef, useState } from 'react';
import { Plus, Minus, X, Divide, Equal } from 'lucide-react';
import { evaluateAmountExpression, isPendingExpression } from '../lib/amountExpression';

// Text amount field with a calculator toolbar (+ − × ÷ =). The value is kept as a raw
// string so partial expressions like "100+" survive; callers evaluate it on submit.
// The toolbar is absolutely positioned above the nearest `relative` ancestor.
export function AmountInput({ value, onChange, className }: {
    value: string,
    onChange: (value: string) => void,
    className?: string,
}) {
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const calculate = () => {
        const result = evaluateAmountExpression(value);
        if (result !== null) onChange(result.toString());
    };

    const insertOperator = (op: string) => {
        // Prevent double operators
        const lastChar = value.slice(-1);
        if (['+', '-', '*', '/'].includes(lastChar) && ['+', '-', '*', '/'].includes(op)) {
            onChange(value.slice(0, -1) + op);
        } else {
            onChange(value + op);
        }
        inputRef.current?.focus();
    };

    // Show calculator if focused OR if there's an ongoing calculation (has operators)
    const showCalculator = isFocused || isPendingExpression(value);

    return (
        <>
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
                        onClick={calculate}
                        className="flex-1 h-10 flex items-center justify-center bg-emerald-600 text-white rounded shadow-sm hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
                    >
                        <Equal className="w-4 h-4" />
                    </button>
                </div>
            )}

            <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                    // Replace comma with dot immediately
                    const val = e.target.value.replace(/,/g, '.');
                    // Allow digits, operators, dots, and parens
                    if (/^[0-9+\-*/().]*$/.test(val)) {
                        onChange(val);
                    }
                }}
                onFocus={() => {
                    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
                    setIsFocused(true);
                }}
                onBlur={() => {
                    // Small delay to allow button clicks on the toolbar
                    blurTimeoutRef.current = setTimeout(() => setIsFocused(false), 200);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === '=') {
                        e.preventDefault();
                        calculate();
                    }
                }}
                placeholder="0.00"
                className={className}
                autoComplete="off"
                required
            />
        </>
    );
}
