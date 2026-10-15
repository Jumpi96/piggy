import type { CardRule, Direction, ImportEntry, ImportKind, ImportSettings, ImportSource, PaymentMethod } from '../types';
import { normalizeForComparison } from './utils';

export const IMPORT_SETTINGS_KEY = 'import_settings';
export const IMPORT_STATUS_KEY = 'import_status';

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
    card_purchase: 'Credit card purchase',
    debit_purchase: 'Debit card purchase',
    transfer_out: 'Transfer sent',
    transfer_in: 'Transfer received',
    mp_outflow: 'Mercado Pago payment',
    mp_interest: 'Mercado Pago interest',
    unknown: 'Unrecognized',
};

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
    mercadopago: 'Mercado Pago',
    santander: 'Santander',
};

// Kinds the user can switch on/off (unknown is never filtered: it's a parse failure).
export const CONFIGURABLE_KINDS: Array<{ kind: ImportKind; source: ImportSource }> = [
    { kind: 'card_purchase', source: 'santander' },
    { kind: 'debit_purchase', source: 'santander' },
    { kind: 'transfer_out', source: 'santander' },
    { kind: 'transfer_in', source: 'santander' },
    { kind: 'mp_outflow', source: 'mercadopago' },
    { kind: 'mp_interest', source: 'mercadopago' },
];

export const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
    kinds: {
        card_purchase: true,
        debit_purchase: true,
        transfer_out: true,
        // Most incoming transfers already exist as recurring items.
        transfer_in: false,
        mp_outflow: true,
        // Arrives daily in small amounts; usually reconciled rather than logged.
        mp_interest: false,
    },
    since: null,
    card_rules: [],
};

/** Merges a stored `import_settings` parameter value over the defaults. */
export function parseImportSettings(value: unknown): ImportSettings {
    const stored = (value && typeof value === 'object' ? value : {}) as Partial<ImportSettings>;
    return {
        kinds: { ...DEFAULT_IMPORT_SETTINGS.kinds, ...(stored.kinds ?? {}) },
        since: typeof stored.since === 'string' ? stored.since : null,
        card_rules: Array.isArray(stored.card_rules)
            ? stored.card_rules.filter(r => r && typeof r.text === 'string' && r.text.trim() && r.credit_card_id)
            : [],
    };
}

/** The email text (subject + body) the importer kept in `raw`, if any. */
export function entryBodyText(entry: Pick<ImportEntry, 'raw'>): string {
    const raw = entry.raw ?? {};
    return [raw.subject, raw.body].filter(v => typeof v === 'string').join('\n');
}

/**
 * Finds the credit card an entry belongs to: the first rule whose text appears in the chosen
 * field (case- and accent-insensitive). A fixed lookup — never a guess.
 */
export function matchCardRule(
    entry: Pick<ImportEntry, 'account_ref' | 'raw'>,
    rules: CardRule[]
): CardRule | null {
    const accountRef = normalizeForComparison(entry.account_ref ?? '');
    const body = normalizeForComparison(entryBodyText(entry));

    for (const rule of rules) {
        const needle = normalizeForComparison(rule.text);
        if (!needle) continue;
        const haystack = rule.field === 'body' ? body : accountRef;
        if (haystack.includes(needle)) return rule;
    }
    return null;
}

export interface ImportDraft {
    direction: Direction;
    amount: string; // as typed in the form, e.g. "1234.5"
    currency_code: string | null;
    date: string | null; // raw movement date; the form derives a card's effective date
    payment_method: PaymentMethod;
    credit_card_id: string | null;
    note: string;
}

/** Form prefill for confirming an entry. Category and tag are left for the user. */
export function entryToDraft(entry: ImportEntry, settings: ImportSettings): ImportDraft {
    const rule = matchCardRule(entry, settings.card_rules);
    const direction: Direction = entry.direction ?? (entry.kind === 'mp_interest' ? 'income' : 'expense');

    return {
        direction,
        amount: entry.amount_cents != null ? (entry.amount_cents / 100).toString() : '',
        currency_code: entry.currency_code,
        date: entry.date,
        payment_method: rule ? 'card' : 'cash',
        credit_card_id: rule?.credit_card_id ?? null,
        note: entry.description?.trim() ?? '',
    };
}

/**
 * Gmail's "confirm forwarding" link, as stored by the Santander importer. The Inbox shows it as
 * a button, so anything that isn't exactly a mail.google.com confirm link is refused (the
 * importer checks this too).
 */
export function isGmailConfirmUrl(url: unknown): url is string {
    return typeof url === 'string' && url.startsWith('https://mail.google.com/mail/vf-');
}

/** account_ref values seen in entries that no rule maps yet (for the Settings screen). */
export function unmappedAccountRefs(entries: ImportEntry[], rules: CardRule[]): string[] {
    const refs = new Set<string>();
    for (const entry of entries) {
        if (entry.source !== 'santander' || !entry.account_ref) continue;
        if (entry.kind !== 'card_purchase') continue;
        if (!matchCardRule(entry, rules)) refs.add(entry.account_ref);
    }
    return [...refs].sort();
}
