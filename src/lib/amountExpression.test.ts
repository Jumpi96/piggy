import { describe, it, expect } from 'vitest';
import { evaluateAmountExpression, isPendingExpression } from './amountExpression';

describe('evaluateAmountExpression', () => {
    it('evaluates basic arithmetic with precedence', () => {
        expect(evaluateAmountExpression('100+20*2')).toBe(140);
        expect(evaluateAmountExpression('(100+20)/4')).toBe(30);
    });

    it('rounds to cents', () => {
        expect(evaluateAmountExpression('10/3')).toBe(3.33);
    });

    it('passes plain numbers through', () => {
        expect(evaluateAmountExpression('42.5')).toBe(42.5);
    });

    it('returns null for empty, malformed or non-finite input', () => {
        expect(evaluateAmountExpression('')).toBeNull();
        expect(evaluateAmountExpression('100+')).toBeNull();
        expect(evaluateAmountExpression('1/0')).toBeNull();
    });
});

describe('isPendingExpression', () => {
    it('detects operators awaiting evaluation', () => {
        expect(isPendingExpression('100+5')).toBe(true);
        expect(isPendingExpression('100.5')).toBe(false);
        expect(isPendingExpression('')).toBe(false);
    });
});
