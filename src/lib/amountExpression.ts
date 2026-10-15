// Evaluates a calculator-style amount like "120+35.5*2", rounded to cents.
// Returns null when the expression is empty, malformed or not a finite number.
export function evaluateAmountExpression(expr: string): number | null {
    // Only allow numbers and basic math operators
    const cleanExpr = expr.replace(/[^-+/()*.\d]/g, '');
    if (!cleanExpr) return null;

    try {
        const result = new Function(`return (${cleanExpr})`)();
        if (typeof result !== 'number' || !isFinite(result)) return null;
        return Math.round(result * 100) / 100;
    } catch {
        return null;
    }
}

// True when the input holds operators that still need evaluating (e.g. "100+").
export function isPendingExpression(expr: string): boolean {
    return expr.length > 0 && !/^-?\d*\.?\d*$/.test(expr);
}
