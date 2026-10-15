export type Direction = 'income' | 'expense';
export type PaymentMethod = 'cash' | 'card';
export type ScheduleType = 'monthly_day' | 'every_n_days' | 'every_n_months';

export interface Currency {
    code: string;
    name: string;
}

export interface ExchangeRate {
    id: string;
    user_id: string;
    currency_code: string;
    rate: number;
    created_at: string;
}

export interface CreditCard {
    id: string;
    user_id: string;
    name: string;
    closing_day: number;
    payment_day: number;
    sort_order: number;
    enabled: boolean;
    created_at: string;
    deleted_at?: string | null;
}

export interface RecurringRule {
    id: string;
    user_id: string;
    direction: Direction;
    amount_cents: number;
    currency_code: string;
    category: string;
    tag: string;
    payment_method: PaymentMethod;
    credit_card_id?: string | null;
    schedule_type: ScheduleType;
    schedule_config: Record<string, any>; // JSON
    start_date: string; // YYYY-MM-DD
    end_date?: string | null;
    active: boolean;
    note?: string | null;
    exception_dates?: string[] | null;
    created_at: string;
    deleted_at?: string | null;
}

export interface Transaction {
    id: string;
    user_id: string;
    date: string; // YYYY-MM-DD
    direction: Direction;
    amount_cents: number;
    currency_code: string;
    exchange_rate_id?: string | null;
    exchange_rate?: { rate: number } | null;
    category: string;
    tag: string;
    payment_method: PaymentMethod;
    credit_card_id?: string | null;
    credit_card?: { name: string } | null;
    recurring_rule_id?: string | null;
    original_date?: string | null;
    note?: string | null;
    created_at: string;
    updated_at: string;
    deleted_at?: string | null;
}

export type BalanceEntryKind = 'entry' | 'settle';

/**
 * One line of a month's balance ledger: money to move between savings and the general
 * account because of spending or income outside the budget. It only tracks — no money
 * moves. amount_cents is signed: > 0 is an unexpected expense to cover from savings,
 * < 0 an unexpected income. The date puts it in a period. transaction_id only records
 * which transaction it came from; the entry is not tied to it. A 'settle' entry brings
 * its period's total back to 0.
 */
export interface BalanceEntry {
    id: string;
    user_id: string;
    date: string; // YYYY-MM-DD
    amount_cents: number;
    currency_code: string;
    exchange_rate_id?: string | null;
    exchange_rate?: { rate: number } | null; // resolved on read, like Transaction
    transaction_id: string | null;
    kind: BalanceEntryKind;
    note?: string | null;
    // The linked transaction, joined on read for labels (deleted: it was deleted since).
    source?: { category: string; tag: string; note: string | null; deleted: boolean } | null;
    created_at: string;
    updated_at: string;
    deleted_at?: string | null;
}

export interface Parameter {
    id: string;
    user_id: string;
    key: string;
    value: any;
    updated_at: string;
}

// ============================================================================
// Imports (the Inbox)
// ============================================================================

export type ImportSource = 'mercadopago' | 'santander';
export type ImportKind =
    | 'card_purchase'
    | 'debit_purchase'
    | 'transfer_out'
    | 'transfer_in'
    | 'mp_outflow'
    | 'mp_interest'
    | 'unknown';
export type ImportStatus = 'pending' | 'confirmed' | 'dismissed';

/**
 * A movement pulled automatically from a source (inserted server-side by the importer
 * Lambdas). Not a transaction until confirmed in the Inbox. Fields other than the status
 * ones are null when the source couldn't be parsed (parse_error is set then).
 */
export interface ImportEntry {
    id: string;
    user_id: string;
    source: ImportSource;
    external_id: string;
    kind: ImportKind;
    date: string | null; // YYYY-MM-DD, Argentina local
    direction: Direction | null;
    amount_cents: number | null;
    currency_code: string | null;
    description: string | null;
    account_ref: string | null;
    installments: number | null;
    raw: Record<string, unknown> | null;
    parse_error: string | null;
    status: ImportStatus;
    transaction_id: string | null;
    resolved_at: string | null;
    created_at: string | null;
    updated_at: string | null;
    deleted_at?: string | null;
}

/** Maps text found in an entry to a Piggy credit card. Checked in order; first match wins. */
export interface CardRule {
    text: string;
    field: 'account_ref' | 'body';
    credit_card_id: string;
}

/** Stored in parameters under key `import_settings`. Read by the importer Lambdas too. */
export interface ImportSettings {
    kinds: Partial<Record<ImportKind, boolean>>;
    since: string | null; // YYYY-MM-DD; movements before it are not imported
    card_rules: CardRule[];
}

export interface ImportSourceStatus {
    last_run_at?: string;
    last_ok_at?: string;
    last_error?: string | null;
    imported?: number;
    forwarding_code?: string | null;
    /** Gmail's "confirm forwarding" link, while the inbound address awaits confirmation. */
    forwarding_url?: string | null;
    [key: string]: unknown;
}

/** Stored in parameters under key `import_status`; written only by the importer Lambdas. */
export type ImportStatusParam = Partial<Record<ImportSource, ImportSourceStatus>>;
