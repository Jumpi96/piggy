// Schema version - increment when schema changes
export const SCHEMA_VERSION = 4;

// Tables that need to be synced with Supabase (in FK dependency order)
export const SYNC_TABLES = [
    'currencies',
    'exchange_rates',
    'credit_cards',
    'recurring_rules',
    'transactions',
    'parameters'
] as const;

export type SyncTableName = typeof SYNC_TABLES[number];

// Full schema SQL for local SQLite database
// Mirrors Supabase schema but simplified (no RLS, no auth references)
export const SCHEMA_SQL = `
-- Sync metadata table
CREATE TABLE IF NOT EXISTS _sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Pending changes queue for offline mutations
CREATE TABLE IF NOT EXISTS _pending_changes (
    id SERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    synced_at TEXT,
    retry_count INTEGER DEFAULT 0,
    error TEXT
);

-- Index for finding pending changes
CREATE INDEX IF NOT EXISTS idx_pending_changes_synced ON _pending_changes(synced_at);

-- Currencies Table (reference data)
CREATE TABLE IF NOT EXISTS currencies (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TEXT
);

-- Exchange Rates Table
CREATE TABLE IF NOT EXISTS exchange_rates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    currency_code TEXT NOT NULL REFERENCES currencies(code),
    rate NUMERIC NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Credit Cards Table
CREATE TABLE IF NOT EXISTS credit_cards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    closing_day INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
    payment_day INTEGER NOT NULL CHECK (payment_day BETWEEN 1 AND 31),
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT
);

-- Recurring Rules Table
CREATE TABLE IF NOT EXISTS recurring_rules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
    amount_cents BIGINT NOT NULL,
    currency_code TEXT NOT NULL REFERENCES currencies(code),
    category TEXT NOT NULL,
    tag TEXT NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card')),
    credit_card_id TEXT REFERENCES credit_cards(id),
    schedule_type TEXT NOT NULL,
    schedule_config TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    active BOOLEAN DEFAULT true,
    note TEXT,
    exception_dates TEXT, -- JSON array of YYYY-MM-DD
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT
);

-- Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
    amount_cents BIGINT NOT NULL,
    currency_code TEXT NOT NULL REFERENCES currencies(code),
    exchange_rate_id TEXT REFERENCES exchange_rates(id),
    category TEXT NOT NULL,
    tag TEXT NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card')),
    credit_card_id TEXT REFERENCES credit_cards(id),
    recurring_rule_id TEXT REFERENCES recurring_rules(id),
    original_date TEXT, -- YYYY-MM-DD for recurring instances
    to_be_balanced BOOLEAN NOT NULL DEFAULT false,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (recurring_rule_id, original_date)
);

-- Parameters Table
CREATE TABLE IF NOT EXISTS parameters (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, key)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_user_deleted ON transactions(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_transactions_credit_card ON transactions(credit_card_id);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_user ON recurring_rules(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_credit_cards_user ON credit_cards(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency ON exchange_rates(currency_code);
`;

// Helper to check if a table supports updated_at for sync
// Only tables that have updated_at in SUPABASE (not just local schema)
export function tableHasUpdatedAt(_table: SyncTableName): boolean {
    return true; // All sync tables now have updated_at in Supabase
}

// Helper to check if a table supports soft delete
export function tableHasSoftDelete(table: SyncTableName): boolean {
    return ['transactions', 'recurring_rules', 'credit_cards'].includes(table);
}
