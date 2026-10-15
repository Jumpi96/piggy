import { describe, it, expect } from 'vitest';
import {
    DEFAULT_IMPORT_SETTINGS, entryInstallments, entryToDraft, installmentAmountCents, installmentEndDate, installmentNote,
    isGmailConfirmUrl, matchCardRule, parseImportSettings, unmappedAccountRefs,
} from './imports';
import type { CardRule, ImportEntry, ImportSettings } from '../types';

function entry(overrides: Partial<ImportEntry> = {}): ImportEntry {
    return {
        id: 'e1',
        user_id: 'u1',
        source: 'santander',
        external_id: '<msg@santander>',
        kind: 'card_purchase',
        date: '2026-10-10',
        direction: 'expense',
        amount_cents: 1234567,
        currency_code: 'ARS',
        description: 'SUPERMERCADO DIA',
        account_ref: 'Tarjeta VISA terminada en 1234',
        installments: null,
        raw: { subject: 'Compra con tu tarjeta', body: 'Realizaste una compra con tu Visa Signature' },
        parse_error: null,
        status: 'pending',
        transaction_id: null,
        resolved_at: null,
        created_at: '2026-10-10T12:00:00Z',
        updated_at: '2026-10-10T12:00:00Z',
        ...overrides,
    };
}

const visa: CardRule = { text: 'VISA terminada en 1234', field: 'account_ref', credit_card_id: 'card-visa' };
const amex: CardRule = { text: 'terminada en 9999', field: 'account_ref', credit_card_id: 'card-amex' };

describe('matchCardRule', () => {
    it('matches account_ref text case- and accent-insensitively', () => {
        const rule = { ...visa, text: 'visa TERMINADA en 1234' };
        expect(matchCardRule(entry(), [rule])).toBe(rule);
        expect(matchCardRule(entry({ account_ref: 'Visa terminadá en 1234' }), [visa])).toBe(visa);
    });

    it('returns the first matching rule in order', () => {
        const broad: CardRule = { text: 'visa', field: 'account_ref', credit_card_id: 'card-other' };
        expect(matchCardRule(entry(), [broad, visa])).toBe(broad);
        expect(matchCardRule(entry(), [visa, broad])).toBe(visa);
    });

    it('can match text anywhere in the email body', () => {
        const signature: CardRule = { text: 'visa signature', field: 'body', credit_card_id: 'card-sig' };
        expect(matchCardRule(entry({ account_ref: null }), [signature])).toBe(signature);
        // A body rule does not look at account_ref, and vice versa.
        expect(matchCardRule(entry(), [{ ...signature, field: 'account_ref' }])).toBeNull();
    });

    it('returns null when nothing matches or the rule text is blank', () => {
        expect(matchCardRule(entry(), [amex])).toBeNull();
        expect(matchCardRule(entry(), [{ ...visa, text: '  ' }])).toBeNull();
    });
});

describe('entryToDraft', () => {
    const settings: ImportSettings = { ...DEFAULT_IMPORT_SETTINGS, card_rules: [visa] };

    it('prefills amount, currency, raw date, note and the mapped card — never category or tag', () => {
        const draft = entryToDraft(entry(), settings);
        expect(draft).toEqual({
            direction: 'expense',
            amount: '12345.67',
            currency_code: 'ARS',
            date: '2026-10-10',
            payment_method: 'card',
            credit_card_id: 'card-visa',
            note: 'SUPERMERCADO DIA',
        });
        expect(draft).not.toHaveProperty('category');
        expect(draft).not.toHaveProperty('tag');
    });

    it('falls back to cash when no card rule matches', () => {
        const draft = entryToDraft(entry({ kind: 'debit_purchase', account_ref: 'Tarjeta de débito 5678' }), settings);
        expect(draft.payment_method).toBe('cash');
        expect(draft.credit_card_id).toBeNull();
    });

    it('treats Mercado Pago interest as income even without a direction', () => {
        const draft = entryToDraft(entry({ source: 'mercadopago', kind: 'mp_interest', direction: null, account_ref: 'mp' }), settings);
        expect(draft.direction).toBe('income');
    });

    it('leaves the amount empty for an entry that failed to parse', () => {
        const draft = entryToDraft(entry({ kind: 'unknown', amount_cents: null, currency_code: null, direction: null, parse_error: 'no amount' }), settings);
        expect(draft.amount).toBe('');
        expect(draft.direction).toBe('expense');
        expect(draft.currency_code).toBeNull();
    });
});

describe('parseImportSettings', () => {
    it('returns the defaults (transfer_in off) for a missing parameter', () => {
        const parsed = parseImportSettings(undefined);
        expect(parsed.kinds.transfer_in).toBe(false);
        expect(parsed.kinds.card_purchase).toBe(true);
        expect(parsed.card_rules).toEqual([]);
        expect(parsed.since).toBeNull();
    });

    it('merges stored kinds over the defaults and drops incomplete rules', () => {
        const parsed = parseImportSettings({
            kinds: { transfer_in: true },
            since: '2026-10-01',
            card_rules: [visa, { text: '', field: 'account_ref', credit_card_id: 'x' }, { text: 'y', field: 'account_ref', credit_card_id: '' }],
        });
        expect(parsed.kinds.transfer_in).toBe(true);
        expect(parsed.kinds.mp_outflow).toBe(true);
        expect(parsed.since).toBe('2026-10-01');
        expect(parsed.card_rules).toEqual([visa]);
    });
});

describe('unmappedAccountRefs', () => {
    it('lists distinct card references of card purchases that no rule maps', () => {
        const entries = [
            entry(),
            entry({ id: 'e2', account_ref: 'Tarjeta AMEX terminada en 9999' }),
            entry({ id: 'e3', account_ref: 'Tarjeta AMEX terminada en 9999' }),
            entry({ id: 'e4', kind: 'debit_purchase', account_ref: 'Débito 5678' }),
            entry({ id: 'e5', source: 'mercadopago', kind: 'mp_outflow', account_ref: 'mp' }),
        ];
        expect(unmappedAccountRefs(entries, [visa])).toEqual(['Tarjeta AMEX terminada en 9999']);
    });
});

describe('isGmailConfirmUrl', () => {
    it('accepts only Gmail confirm links', () => {
        expect(isGmailConfirmUrl('https://mail.google.com/mail/vf-%5BTOKEN%5D-abc')).toBe(true);
        expect(isGmailConfirmUrl('https://mail.google.com/mail/uf-%5BTOKEN%5D-abc')).toBe(false);
        expect(isGmailConfirmUrl('https://mail.google.com.evil.example/mail/vf-x')).toBe(false);
        expect(isGmailConfirmUrl('javascript:alert(1)')).toBe(false);
        expect(isGmailConfirmUrl(null)).toBe(false);
        expect(isGmailConfirmUrl(undefined)).toBe(false);
    });
});

describe('cuotas', () => {
    it('only counts more than one cuota', () => {
        expect(entryInstallments({ installments: 3 })).toBe(3);
        expect(entryInstallments({ installments: 1 })).toBeNull();
        expect(entryInstallments({ installments: null })).toBeNull();
        expect(entryInstallments(undefined)).toBeNull();
    });

    it('splits the total per cuota, rounded to the cent', () => {
        expect(installmentAmountCents(11930000, 3)).toBe(3976667);
        expect(installmentAmountCents(5913674, 3)).toBe(1971225);
    });

    it('ends count - 1 months after the first cuota', () => {
        expect(installmentEndDate('2026-11-03', 3)).toBe('2027-01-03');
        expect(installmentEndDate('2026-11-03', 12)).toBe('2027-10-03');
        // Clamped to the month's last day, like monthly recurring occurrences.
        expect(installmentEndDate('2026-01-31', 2)).toBe('2026-02-28');
    });

    it('keeps the purchase total in the note', () => {
        expect(installmentNote('MERPAGO*LECLUBDEPORTE', 11930000, 3)).toBe('MERPAGO*LECLUBDEPORTE · 119.300 en 3 cuotas');
        expect(installmentNote(null, 5913674, 3)).toBe('59.136,74 en 3 cuotas');
    });
});
