import { getDatabaseAsync, getCurrentUserId } from './offline/database';
import { trackChange, triggerBackgroundSync } from './offline/sync';
import type { Currency, CreditCard, Transaction, RecurringRule, Parameter, ImportEntry, ImportStatus, BalanceEntry } from '../types';
import { getTodayLocalDate, getPeriodRange, getPeriodForDate, cacheMonthStartDay } from './dates';
import { generateOccurrences, mergeTransactions } from './recurringUtils';
import { normalizeForComparison } from './utils';
import { pickRateForDate } from './currency';
import { sortCreditCards } from './creditCards';
import { sumBalanceUsdCents } from './balance';

// Transaction Input without system fields
export type TransactionInput = Omit<Transaction, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'deleted_at'>;

// Helper to get current user ID
async function getUserId(): Promise<string> {
    const userId = await getCurrentUserId();
    if (!userId) {
        throw new Error('User not authenticated');
    }
    return userId;
}

/**
 * Migrates physical transactions from an old rule to a new rule starting from a specific date.
 * Used when "Edit Future Ones" is selected to split a rule.
 */
export async function migrateFutureTransactions(oldRuleId: string, newRuleId: string, startDate: string): Promise<void> {
    try {
        const db = await getDatabaseAsync();
        const userId = await getUserId();
        const timestamp = now();
        const result = await db.query<Transaction>(`
            UPDATE transactions 
            SET recurring_rule_id = $1,
                updated_at = $5
            WHERE recurring_rule_id = $2 
              AND user_id = $4
              AND (original_date >= $3 OR (original_date IS NULL AND date >= $3))
              AND deleted_at IS NULL
            RETURNING *
        `, [newRuleId, oldRuleId, startDate, userId, timestamp]);

        for (const row of result.rows) {
            await trackChange('transactions', row.id, 'UPDATE', row);
        }
        if (result.rows.length > 0) {
            triggerBackgroundSync();
        }
        console.log(`[API] Migrated future transactions from ${oldRuleId} to ${newRuleId}`);
    } catch (err) {
        console.error('[API] Failed to migrate future transactions:', err);
        throw err;
    }
}

/**
 * Deletes physical transactions for a rule starting from a specific date.
 */
export async function deleteFutureTransactionsForRule(ruleId: string, startDate: string): Promise<string[]> {
    try {
        const db = await getDatabaseAsync();
        const userId = await getUserId();
        const timestamp = now();
        const result = await db.query<{ id: string }>(`
            UPDATE transactions 
            SET deleted_at = $1,
                updated_at = $1
            WHERE recurring_rule_id = $2
              AND user_id = $4
              AND (original_date >= $3 OR (original_date IS NULL AND date >= $3))
              AND deleted_at IS NULL
            RETURNING id
        `, [timestamp, ruleId, startDate, userId]);

        for (const row of result.rows) {
            await trackChange('transactions', row.id, 'DELETE', { id: row.id, deleted_at: timestamp });
        }
        if (result.rows.length > 0) {
            triggerBackgroundSync();
        }
        console.log(`[API] Deleted future transactions for rule ${ruleId}`);
        return result.rows.map(row => row.id);
    } catch (err) {
        console.error('[API] Failed to delete future transactions:', err);
        throw err;
    }
}

/**
 * Skips a single recurring occurrence.
 * - Always records an exception on the rule for the original occurrence date.
 * - Deletes the physical override if one exists.
 */
export async function skipRecurringOccurrence(
    transaction: Pick<Transaction, 'id' | 'date' | 'original_date' | 'recurring_rule_id'>
): Promise<void> {
    if (!transaction.recurring_rule_id) {
        throw new Error('Transaction is not linked to a recurring rule');
    }

    const occurrenceDate = (transaction.original_date || transaction.date).trim();
    const rule = await fetchRecurringRule(transaction.recurring_rule_id);
    const existingExceptions = Array.isArray(rule.exception_dates) ? rule.exception_dates : [];
    const exceptionDates = Array.from(new Set([...existingExceptions, occurrenceDate]));

    await updateRecurringRule(rule.id, { exception_dates: exceptionDates });

    // Virtual occurrences only exist in memory; physical overrides must be soft-deleted.
    if (!transaction.id.startsWith('virtual-')) {
        await deleteTransaction(transaction.id);
    }
}
// Helper to generate UUID
function generateId(): string {
    return crypto.randomUUID();
}

// Helper to get current timestamp
function now(): string {
    return new Date().toISOString();
}

// ============================================================================
// Currencies
// ============================================================================

export async function fetchCurrencies(): Promise<Currency[]> {
    const db = await getDatabaseAsync();
    const result = await db.query<Currency>(`
        SELECT code, name FROM currencies ORDER BY code
    `);
    return result.rows;
}

// ============================================================================
// Credit Cards
// ============================================================================

export async function fetchCreditCards(includeDisabled: boolean = false): Promise<CreditCard[]> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    const enabledClause = includeDisabled ? '' : 'AND enabled = true';

    const result = await db.query<CreditCard>(`
        SELECT * FROM credit_cards
        WHERE user_id = $1 AND deleted_at IS NULL ${enabledClause}
        ORDER BY sort_order, created_at, name
    `, [userId]);

    return sortCreditCards(result.rows);
}

export async function insertCreditCard(name: string, closingDay: number, paymentDay: number): Promise<CreditCard> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();
    const id = generateId();
    const timestamp = now();

    const card: CreditCard = {
        id,
        user_id: userId,
        name,
        closing_day: closingDay,
        payment_day: paymentDay,
        sort_order: 0,
        enabled: true,
        created_at: timestamp,
        deleted_at: null
    };

    await db.query(`
        INSERT INTO credit_cards (id, user_id, name, closing_day, payment_day, sort_order, enabled, created_at)
        VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT MAX(sort_order) + 1 FROM credit_cards WHERE user_id = $2 AND deleted_at IS NULL), 0), $6, $7)
    `, [id, userId, name, closingDay, paymentDay, true, timestamp]);

    const inserted = await db.query<CreditCard>(`
        SELECT * FROM credit_cards WHERE id = $1
    `, [id]);

    const insertedCard = inserted.rows[0] || card;

    await trackChange('credit_cards', id, 'INSERT', insertedCard);
    triggerBackgroundSync();

    return insertedCard;
}

export async function deleteCreditCard(id: string): Promise<void> {
    const db = await getDatabaseAsync();
    const timestamp = now();

    await db.query(`
        UPDATE credit_cards SET deleted_at = $1 WHERE id = $2
    `, [timestamp, id]);

    await trackChange('credit_cards', id, 'DELETE', { id, deleted_at: timestamp });
    triggerBackgroundSync();
}

export async function updateCreditCard(id: string, updates: Partial<CreditCard>): Promise<void> {
    const db = await getDatabaseAsync();
    const timestamp = now();

    const keys = Object.keys(updates).filter(k => k !== 'id' && k !== 'user_id' && k !== 'created_at' && k !== 'updated_at');
    if (keys.length === 0) return;

    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map(k => (updates as any)[k]);

    await db.query(`
        UPDATE credit_cards 
        SET ${setClause}, updated_at = $${keys.length + 1}
        WHERE id = $${keys.length + 2}
    `, [...values, timestamp, id]);

    await trackChange('credit_cards', id, 'UPDATE', { ...updates, updated_at: timestamp });
    triggerBackgroundSync();
}

export async function updateCreditCardOrder(cards: CreditCard[]): Promise<void> {
    await Promise.all(cards.map(card => updateCreditCard(card.id, { sort_order: card.sort_order })));
}

// ============================================================================
// Transactions
// ============================================================================

export async function fetchTransactions(monthStart: string): Promise<Transaction[]> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    // monthStart is a period anchor (YYYY-MM or YYYY-MM-01); derive the period window.
    const { start: startStr, end: endStr } = getPeriodRange(monthStart);

    const result = await db.query<Transaction & { exchange_rate_value?: number; credit_card_name?: string }>(`
        SELECT
            t.*,
            er.rate as exchange_rate_value,
            cc.name as credit_card_name
        FROM transactions t
        LEFT JOIN exchange_rates er ON t.exchange_rate_id = er.id
        LEFT JOIN credit_cards cc ON t.credit_card_id = cc.id
        WHERE t.user_id = $1
          AND t.deleted_at IS NULL
          AND t.date >= $2
          AND t.date < $3
        ORDER BY t.date DESC
    `, [userId, startStr, endStr]);

    const rates = await fetchAllRates();
    const physical = result.rows.map(row => {
        let rate: number | undefined = row.exchange_rate_value ?? undefined;
        if (!rate && row.currency_code !== 'USD') {
            rate = pickRateForDate(rates, row.currency_code, row.date)?.rate;
        }
        return {
            ...row,
            exchange_rate: rate ? { rate: Number(rate) } : (row.currency_code === 'USD' ? { rate: 1 } : null),
            credit_card: row.credit_card_name ? { name: row.credit_card_name } : null
        };
    });

    // Fetch overrides where original_date is in range but date is outside
    // These are used only for filtering virtuals, not for display
    const movedOverrides = await db.query<{ recurring_rule_id: string; original_date: string; date: string }>(`
        SELECT recurring_rule_id, original_date, date
        FROM transactions
        WHERE user_id = $1
          AND deleted_at IS NULL
          AND recurring_rule_id IS NOT NULL
          AND original_date IS NOT NULL
          AND original_date >= $2
          AND original_date < $3
          AND (date < $2 OR date >= $3)
    `, [userId, startStr, endStr]);

    const rules = await fetchRecurringRules();
    let virtual: Transaction[] = [];
    for (const rule of rules) {
        virtual = virtual.concat(generateOccurrences(rule, startStr, endStr, rates));
    }

    return mergeTransactions(virtual, physical, movedOverrides.rows);
}

export async function fetchTransactionsRange(startDate: string, endDate: string): Promise<Transaction[]> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    const result = await db.query<Transaction & { exchange_rate_value?: number; credit_card_name?: string }>(`
        SELECT
            t.*,
            er.rate as exchange_rate_value,
            cc.name as credit_card_name
        FROM transactions t
        LEFT JOIN exchange_rates er ON t.exchange_rate_id = er.id
        LEFT JOIN credit_cards cc ON t.credit_card_id = cc.id
        WHERE t.user_id = $1
          AND t.deleted_at IS NULL
          AND t.date >= $2
          AND t.date < $3
        ORDER BY t.date ASC
    `, [userId, startDate, endDate]);

    const rates = await fetchAllRates();
    const physical = result.rows.map(row => {
        let rate: number | undefined = row.exchange_rate_value ?? undefined;
        if (!rate && row.currency_code !== 'USD') {
            rate = pickRateForDate(rates, row.currency_code, row.date)?.rate;
        }
        return {
            ...row,
            exchange_rate: rate ? { rate: Number(rate) } : (row.currency_code === 'USD' ? { rate: 1 } : null),
            credit_card: row.credit_card_name ? { name: row.credit_card_name } : null
        };
    });

    // Fetch overrides where original_date is in range but date is outside
    const movedOverrides = await db.query<{ recurring_rule_id: string; original_date: string; date: string }>(`
        SELECT recurring_rule_id, original_date, date
        FROM transactions
        WHERE user_id = $1
          AND deleted_at IS NULL
          AND recurring_rule_id IS NOT NULL
          AND original_date IS NOT NULL
          AND original_date >= $2
          AND original_date < $3
          AND (date < $2 OR date >= $3)
    `, [userId, startDate, endDate]);

    const rules = await fetchRecurringRules();
    let virtual: Transaction[] = [];
    for (const rule of rules) {
        virtual = virtual.concat(generateOccurrences(rule, startDate, endDate, rates));
    }

    return mergeTransactions(virtual, physical, movedOverrides.rows);
}

// startDate/endDate form a half-open range [startDate, endDate): endDate is the first
// day AFTER the period. Both the physical query and the virtual generator use the same
// exclusive bound so a charge on the period's last day is counted consistently.
export async function fetchCreditTransactions(cardId: string, startDate: string, endDate: string): Promise<Transaction[]> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    const result = await db.query<Transaction & { exchange_rate_value?: number; credit_card_name?: string }>(`
        SELECT
            t.*,
            er.rate as exchange_rate_value,
            cc.name as credit_card_name
        FROM transactions t
        LEFT JOIN exchange_rates er ON t.exchange_rate_id = er.id
        LEFT JOIN credit_cards cc ON t.credit_card_id = cc.id
        WHERE t.user_id = $1
          AND t.deleted_at IS NULL
          AND t.credit_card_id = $2
          AND t.date >= $3
          AND t.date < $4
        ORDER BY t.date ASC
    `, [userId, cardId, startDate, endDate]);

    const rates = await fetchAllRates();
    const physical = result.rows.map(row => {
        let rate = row.exchange_rate_value;
        if (!rate && row.currency_code !== 'USD') {
            rate = pickRateForDate(rates, row.currency_code, row.date)?.rate || undefined;
        }
        return {
            ...row,
            exchange_rate: rate ? { rate: Number(rate) } : (row.currency_code === 'USD' ? { rate: 1 } : null),
            credit_card: row.credit_card_name ? { name: row.credit_card_name } : null
        };
    });

    // Fetch overrides where original_date is in range but date is outside
    const movedOverrides = await db.query<{ recurring_rule_id: string; original_date: string; date: string }>(`
        SELECT recurring_rule_id, original_date, date
        FROM transactions
        WHERE user_id = $1
          AND deleted_at IS NULL
          AND credit_card_id = $2
          AND recurring_rule_id IS NOT NULL
          AND original_date IS NOT NULL
          AND original_date >= $3
          AND original_date < $4
          AND (date < $3 OR date >= $4)
    `, [userId, cardId, startDate, endDate]);

    const rules = await fetchRecurringRules();
    let virtual: Transaction[] = [];
    for (const rule of rules) {
        if (rule.credit_card_id === cardId) {
            virtual = virtual.concat(generateOccurrences(rule, startDate, endDate, rates));
        }
    }

    return mergeTransactions(virtual, physical, movedOverrides.rows);
}

export async function insertTransaction(transaction: TransactionInput): Promise<Transaction> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();
    const id = generateId();
    const timestamp = now();

    const tx: Transaction = {
        id,
        user_id: userId,
        ...transaction,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
    };

    await db.query(`
        INSERT INTO transactions (
            id, user_id, date, direction, amount_cents, currency_code,
            exchange_rate_id, category, tag, payment_method, credit_card_id,
            recurring_rule_id, original_date, note, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `, [
        id, userId, transaction.date, transaction.direction, transaction.amount_cents,
        transaction.currency_code, transaction.exchange_rate_id || null, transaction.category,
        transaction.tag, transaction.payment_method, transaction.credit_card_id || null,
        transaction.recurring_rule_id || null, transaction.original_date || null,
        transaction.note || null,
        timestamp, timestamp
    ]);

    await trackChange('transactions', id, 'INSERT', tx);
    triggerBackgroundSync();

    return tx;
}

export async function updateTransaction(id: string, updates: Partial<TransactionInput>): Promise<Transaction> {
    // Guard: virtual transactions cannot be updated directly
    if (id.startsWith('virtual-')) {
        throw new Error('Cannot update a virtual transaction. Create a physical override instead.');
    }

    const db = await getDatabaseAsync();
    const timestamp = now();

    // Build dynamic update query
    const setClauses: string[] = ['updated_at = $1'];
    const values: unknown[] = [timestamp];
    let paramIndex = 2;

    const updateableFields = [
        'date', 'direction', 'amount_cents', 'currency_code', 'exchange_rate_id',
        'category', 'tag', 'payment_method', 'credit_card_id', 'recurring_rule_id',
        'original_date', 'note'
    ];

    for (const field of updateableFields) {
        if (field in updates) {
            setClauses.push(`${field} = $${paramIndex}`);
            values.push((updates as Record<string, unknown>)[field] ?? null);
            paramIndex++;
        }
    }

    values.push(id);

    await db.query(`
        UPDATE transactions
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
    `, values);

    // Fetch updated record
    const result = await db.query<Transaction>(`SELECT * FROM transactions WHERE id = $1`, [id]);
    const updated = result.rows[0];

    await trackChange('transactions', id, 'UPDATE', updated);
    triggerBackgroundSync();

    return updated;
}

export async function deleteTransaction(id: string): Promise<void> {
    // Guard: virtual transactions cannot be deleted directly
    if (id.startsWith('virtual-')) {
        throw new Error('Cannot delete a virtual transaction. Add an exception to the recurring rule instead.');
    }

    const db = await getDatabaseAsync();
    const timestamp = now();

    await db.query(`
        UPDATE transactions SET deleted_at = $1, updated_at = $1 WHERE id = $2
    `, [timestamp, id]);

    await trackChange('transactions', id, 'DELETE', { id, deleted_at: timestamp });
    triggerBackgroundSync();
}

// ============================================================================
// Balance Ledger
// ============================================================================

export type BalanceEntryInput = Pick<BalanceEntry, 'date' | 'amount_cents' | 'currency_code'> &
    Partial<Pick<BalanceEntry, 'exchange_rate_id' | 'transaction_id' | 'kind' | 'note'>>;

type BalanceEntryRow = BalanceEntry & {
    exchange_rate_value?: number | null;
    tx_category?: string | null;
    tx_tag?: string | null;
    tx_note?: string | null;
    tx_deleted_at?: string | null;
};

const BALANCE_ENTRY_SELECT = `
    SELECT b.*, er.rate AS exchange_rate_value,
           t.category AS tx_category, t.tag AS tx_tag, t.note AS tx_note, t.deleted_at AS tx_deleted_at
    FROM balance_entries b
    LEFT JOIN exchange_rates er ON b.exchange_rate_id = er.id
    LEFT JOIN transactions t ON b.transaction_id = t.id
`;

/** Resolves each entry's rate the same way transactions do (pinned id, else the month's rate). */
async function withBalanceRates(rows: BalanceEntryRow[]): Promise<BalanceEntry[]> {
    const rates = await fetchAllRates();
    return rows.map(({ exchange_rate_value, tx_category, tx_tag, tx_note, tx_deleted_at, ...row }) => {
        let rate: number | undefined = exchange_rate_value ?? undefined;
        if (!rate && row.currency_code !== 'USD') {
            rate = pickRateForDate(rates, row.currency_code, row.date)?.rate;
        }
        return {
            ...row,
            amount_cents: Number(row.amount_cents),
            exchange_rate: rate ? { rate: Number(rate) } : (row.currency_code === 'USD' ? { rate: 1 } : null),
            source: row.transaction_id && tx_category != null
                ? { category: tx_category, tag: tx_tag ?? '', note: tx_note ?? null, deleted: !!tx_deleted_at }
                : null,
        };
    });
}

/** The period's ledger, newest first. */
export async function fetchBalanceEntries(monthStart: string): Promise<BalanceEntry[]> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();
    const { start, end } = getPeriodRange(monthStart);

    const result = await db.query<BalanceEntryRow>(`
        ${BALANCE_ENTRY_SELECT}
        WHERE b.user_id = $1
          AND b.deleted_at IS NULL
          AND b.date >= $2
          AND b.date < $3
        ORDER BY b.date DESC, b.created_at DESC
    `, [userId, start, end]);

    return withBalanceRates(result.rows);
}

/** Live entries linked to any of these transactions (virtual ids never have any). */
export async function fetchBalanceEntriesForTransactions(transactionIds: string[]): Promise<BalanceEntry[]> {
    const ids = transactionIds.filter(id => !id.startsWith('virtual-'));
    if (ids.length === 0) return [];
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
    const result = await db.query<BalanceEntryRow>(`
        ${BALANCE_ENTRY_SELECT}
        WHERE b.user_id = $1
          AND b.deleted_at IS NULL
          AND b.transaction_id IN (${placeholders})
        ORDER BY b.created_at ASC
    `, [userId, ...ids]);

    return withBalanceRates(result.rows);
}

export async function insertBalanceEntry(input: BalanceEntryInput): Promise<BalanceEntry> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();
    const id = generateId();
    const timestamp = now();

    const entry: BalanceEntry = {
        id,
        user_id: userId,
        date: input.date,
        amount_cents: input.amount_cents,
        currency_code: input.currency_code,
        exchange_rate_id: input.exchange_rate_id ?? null,
        transaction_id: input.transaction_id ?? null,
        kind: input.kind ?? 'entry',
        note: input.note ?? null,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
    };

    await db.query(`
        INSERT INTO balance_entries (
            id, user_id, date, amount_cents, currency_code, exchange_rate_id,
            transaction_id, kind, note, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
        entry.id, entry.user_id, entry.date, entry.amount_cents, entry.currency_code,
        entry.exchange_rate_id, entry.transaction_id, entry.kind, entry.note,
        entry.created_at, entry.updated_at,
    ]);

    await trackChange('balance_entries', id, 'INSERT', entry);
    triggerBackgroundSync();

    return entry;
}

export async function updateBalanceEntryAmount(id: string, amountCents: number): Promise<void> {
    const db = await getDatabaseAsync();
    const timestamp = now();
    await db.query(`UPDATE balance_entries SET amount_cents = $1, updated_at = $2 WHERE id = $3`, [amountCents, timestamp, id]);
    await trackChange('balance_entries', id, 'UPDATE', { id, amount_cents: amountCents, updated_at: timestamp });
    triggerBackgroundSync();
}

export async function deleteBalanceEntry(id: string): Promise<void> {
    const db = await getDatabaseAsync();
    const timestamp = now();
    await db.query(`UPDATE balance_entries SET deleted_at = $1, updated_at = $1 WHERE id = $2`, [timestamp, id]);
    await trackChange('balance_entries', id, 'DELETE', { id, deleted_at: timestamp });
    triggerBackgroundSync();
}

/** Keeps the entry in the ledger but forgets which transaction it came from. */
export async function detachBalanceEntry(id: string): Promise<void> {
    const db = await getDatabaseAsync();
    const timestamp = now();
    await db.query(`UPDATE balance_entries SET transaction_id = NULL, updated_at = $1 WHERE id = $2`, [timestamp, id]);
    await trackChange('balance_entries', id, 'UPDATE', { id, transaction_id: null, updated_at: timestamp });
    triggerBackgroundSync();
}

/**
 * What to do with the balance entries of transactions being deleted: drop them from the
 * ledger, or keep them (detached, so they don't point at a deleted row).
 */
export async function resolveLinkedBalanceEntries(transactionIds: string[], action: 'remove' | 'detach'): Promise<void> {
    const linked = await fetchBalanceEntriesForTransactions(transactionIds);
    for (const entry of linked) {
        if (action === 'remove') {
            await deleteBalanceEntry(entry.id);
        } else {
            await detachBalanceEntry(entry.id);
        }
    }
}

/**
 * Brings the period's balance back to 0 by adding a 'settle' entry for minus its total.
 * Only the ledger changes — moving the money is up to you. Returns the entry, or null if
 * the period was already settled.
 */
export async function settleBalance(monthStart: string): Promise<BalanceEntry | null> {
    const total = sumBalanceUsdCents(await fetchBalanceEntries(monthStart));
    if (total === 0) return null;
    return insertBalanceEntry({
        date: getPeriodRange(monthStart).start,
        amount_cents: -total,
        currency_code: 'USD',
        kind: 'settle',
    });
}

// ============================================================================
// Exchange Rates
// ============================================================================

export async function fetchExchangeRate(currencyCode: string, date: string): Promise<string | null> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    // Fetch the currency's full rate history and pick the one effective for `date`'s month.
    // This keeps backdated transactions on the rate that was in effect that month instead of
    // always stamping today's latest rate.
    const result = await db.query<{ id: string; currency_code: string; rate: number; created_at: string }>(`
        SELECT id, currency_code, rate, created_at FROM exchange_rates
        WHERE currency_code = $1 AND user_id = $2
        ORDER BY created_at DESC
    `, [currencyCode, userId]);

    return pickRateForDate(result.rows, currencyCode, date)?.id ?? null;
}

export async function insertExchangeRate(currencyCode: string, rate: number): Promise<{ id: string; currency_code: string; rate: number }> {
    // Reject non-positive/invalid rates: a 0 rate would later be swallowed by the
    // `rate || 1` fallbacks in the balance math and silently value a foreign-currency
    // amount as if it were USD (e.g. 12,000 ARS shown as $120 instead of ~$10).
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Exchange rate must be a positive number');
    }

    const db = await getDatabaseAsync();
    const userId = await getUserId();
    const id = generateId();
    const timestamp = now();

    const exchangeRate = {
        id,
        user_id: userId,
        currency_code: currencyCode,
        rate,
        created_at: timestamp
    };

    await db.query(`
        INSERT INTO exchange_rates (id, user_id, currency_code, rate, created_at)
        VALUES ($1, $2, $3, $4, $5)
    `, [id, userId, currencyCode, rate, timestamp]);

    // Repoint transactions from the start of the current financial period to the new rate.
    const { start: dateStr } = getPeriodRange(getPeriodForDate(getTodayLocalDate()));

    const repointed = await db.query<{ id: string }>(`
        UPDATE transactions
        SET exchange_rate_id = $1,
            updated_at = $5
        WHERE currency_code = $2
          AND user_id = $3
          AND date >= $4
          AND deleted_at IS NULL
        RETURNING id
    `, [id, currencyCode, userId, dateStr, timestamp]);

    await trackChange('exchange_rates', id, 'INSERT', exchangeRate);

    // The repoint mutates each transaction locally; queue those changes too. Without
    // this the new rate never reaches the server, so other devices keep the old rate
    // and a later full resync silently reverts the local re-valuation — the balances
    // that "change on their own a couple times a month".
    for (const row of repointed.rows) {
        await trackChange('transactions', row.id, 'UPDATE', {
            id: row.id,
            exchange_rate_id: id,
            updated_at: timestamp,
        });
    }

    triggerBackgroundSync();

    return exchangeRate;
}

export async function fetchLatestRates(): Promise<Array<{ id: string; currency_code: string; rate: number; created_at: string }>> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    // Get latest rate for each currency
    const result = await db.query<{ id: string; currency_code: string; rate: number; created_at: string }>(`
        SELECT DISTINCT ON (currency_code) id, currency_code, rate, created_at
        FROM exchange_rates
        WHERE user_id = $1
        ORDER BY currency_code, created_at DESC
    `, [userId]);

    return result.rows;
}

// Full rate history (all rows) so rates can be matched to a transaction's month.
export async function fetchAllRates(): Promise<Array<{ id: string; currency_code: string; rate: number; created_at: string }>> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    const result = await db.query<{ id: string; currency_code: string; rate: number; created_at: string }>(`
        SELECT id, currency_code, rate, created_at
        FROM exchange_rates
        WHERE user_id = $1
        ORDER BY currency_code, created_at DESC
    `, [userId]);

    return result.rows;
}

// ============================================================================
// Tags
// ============================================================================

export async function fetchDistinctTags(): Promise<string[]> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    const result = await db.query<{ tag: string }>(`
        SELECT DISTINCT tag FROM transactions
        WHERE user_id = $1 AND deleted_at IS NULL
    `, [userId]);

    // Normalize tags to be unique case-and-accent-insensitively, keeping the first one found
    const seen = new Set<string>();
    const uniqueTags: string[] = [];

    for (const row of result.rows) {
        if (!row.tag) continue;
        const norm = normalizeForComparison(row.tag);
        if (!seen.has(norm)) {
            seen.add(norm);
            uniqueTags.push(row.tag.trim());
        }
    }

    return uniqueTags.sort((a, b) => a.localeCompare(b));
}

// ============================================================================
// Recurring Rules
// ============================================================================

export async function fetchRecurringRules(): Promise<RecurringRule[]> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    const result = await db.query<RecurringRule & { schedule_config: string }>(`
        SELECT * FROM recurring_rules
        WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC
    `, [userId]);

    // Parse JSON fields
    return result.rows.map(row => ({
        ...row,
        schedule_config: typeof row.schedule_config === 'string'
            ? JSON.parse(row.schedule_config)
            : row.schedule_config,
        exception_dates: typeof row.exception_dates === 'string'
            ? JSON.parse(row.exception_dates)
            : (row.exception_dates || [])
    }));
}

export async function fetchRecurringRule(id: string): Promise<RecurringRule> {
    const db = await getDatabaseAsync();
    const result = await db.query<RecurringRule & { schedule_config: string; exception_dates: string }>(`
        SELECT * FROM recurring_rules WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) throw new Error('Recurring rule not found');

    const row = result.rows[0];
    return {
        ...row,
        schedule_config: typeof row.schedule_config === 'string'
            ? JSON.parse(row.schedule_config)
            : row.schedule_config,
        exception_dates: typeof row.exception_dates === 'string'
            ? JSON.parse(row.exception_dates)
            : (row.exception_dates || [])
    };
}

export async function insertRecurringRule(rule: Partial<RecurringRule>): Promise<RecurringRule> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();
    const id = rule.id || generateId();
    const timestamp = now();

    const newRule: RecurringRule = {
        id,
        user_id: userId,
        direction: rule.direction!,
        amount_cents: rule.amount_cents!,
        currency_code: rule.currency_code!,
        category: rule.category!,
        tag: rule.tag!,
        payment_method: rule.payment_method!,
        credit_card_id: rule.credit_card_id || null,
        schedule_type: rule.schedule_type!,
        schedule_config: rule.schedule_config!,
        start_date: rule.start_date!,
        end_date: rule.end_date || null,
        active: rule.active ?? true,
        note: rule.note || null,
        exception_dates: rule.exception_dates || [],
        created_at: timestamp,
        deleted_at: null
    };

    await db.query(`
        INSERT INTO recurring_rules (
            id, user_id, direction, amount_cents, currency_code, category, tag,
            payment_method, credit_card_id, schedule_type, schedule_config,
            start_date, end_date, active, note, exception_dates, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `, [
        id, userId, newRule.direction, newRule.amount_cents, newRule.currency_code,
        newRule.category, newRule.tag, newRule.payment_method, newRule.credit_card_id,
        newRule.schedule_type, JSON.stringify(newRule.schedule_config), newRule.start_date,
        newRule.end_date, newRule.active, newRule.note, JSON.stringify(newRule.exception_dates || []), timestamp
    ]);

    await trackChange('recurring_rules', id, 'INSERT', {
        ...newRule,
        schedule_config: JSON.stringify(newRule.schedule_config),
        exception_dates: JSON.stringify(newRule.exception_dates || [])
    });
    triggerBackgroundSync();

    return newRule;
}

export async function updateRecurringRule(id: string, updates: Partial<RecurringRule>): Promise<RecurringRule> {
    const db = await getDatabaseAsync();
    const timestamp = now();

    // Build dynamic update query
    const setClauses: string[] = ['updated_at = $1'];
    const values: unknown[] = [timestamp];
    let paramIndex = 2;

    for (const [key, value] of Object.entries(updates)) {
        if (key === 'id' || key === 'user_id' || key === 'created_at' || key === 'updated_at') continue;

        setClauses.push(`${key} = $${paramIndex}`);
        if (key === 'schedule_config' || key === 'exception_dates') {
            values.push(JSON.stringify(value));
        } else {
            values.push(value ?? null);
        }
        paramIndex++;
    }

    values.push(id);

    await db.query(`
        UPDATE recurring_rules
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
    `, values);

    // Fetch updated record
    const result = await db.query<RecurringRule & { schedule_config: string }>(`
        SELECT * FROM recurring_rules WHERE id = $1
    `, [id]);

    const updated = {
        ...result.rows[0],
        schedule_config: typeof result.rows[0].schedule_config === 'string'
            ? JSON.parse(result.rows[0].schedule_config)
            : result.rows[0].schedule_config,
        exception_dates: typeof result.rows[0].exception_dates === 'string'
            ? JSON.parse(result.rows[0].exception_dates)
            : (result.rows[0].exception_dates || [])
    };

    await trackChange('recurring_rules', id, 'UPDATE', {
        ...updated,
        schedule_config: JSON.stringify(updated.schedule_config),
        exception_dates: JSON.stringify(updated.exception_dates)
    });
    triggerBackgroundSync();

    return updated;
}

export async function deleteRecurringRule(id: string): Promise<void> {
    const db = await getDatabaseAsync();
    const timestamp = now();

    await db.query(`
        UPDATE recurring_rules SET deleted_at = $1 WHERE id = $2
    `, [timestamp, id]);

    await trackChange('recurring_rules', id, 'DELETE', { id, deleted_at: timestamp });
    triggerBackgroundSync();
}

// ============================================================================
// Month Balance (Local Computation)
// ============================================================================

export async function computeMonthBalance(month: string): Promise<{ income: number; expense: number; balance: number; taxes: number }> {
    // `month` is a period anchor (YYYY-MM or YYYY-MM-01); resolve its half-open window.
    const { start, end } = getPeriodRange(month);
    const txs = await fetchTransactionsRange(start, end);

    let income = 0;
    let expense = 0;
    let taxes = 0;

    for (const t of txs) {
        const rate = t.exchange_rate?.rate || 1;
        const amount = t.amount_cents / rate;
        if (t.direction === 'income') {
            income += amount;
        } else {
            expense += amount;
            if (t.category === 'Taxes') {
                taxes += amount;
            }
        }
    }

    return {
        income: Math.round(income),
        expense: Math.round(expense),
        balance: Math.round(income - expense),
        taxes: Math.round(taxes)
    };
}

// ============================================================================
// Parameters
// ============================================================================

export async function fetchParameters(): Promise<Parameter[]> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    const result = await db.query<Parameter & { value: string }>(`
        SELECT * FROM parameters WHERE user_id = $1
    `, [userId]);

    const params = result.rows.map(row => ({
        ...row,
        value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value
    }));

    // Mirror the financial-month start day into localStorage so the synchronous
    // period helpers in dates.ts can read it. Absent → reset to the default (1).
    const startDayParam = params.find(p => p.key === 'month_start_day');
    cacheMonthStartDay(startDayParam != null ? Number(startDayParam.value) : null);

    return params;
}

export async function upsertParameter(key: string, value: unknown): Promise<Parameter> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();
    const timestamp = now();

    // Check if exists
    const existing = await db.query<{ id: string }>(`
        SELECT id FROM parameters WHERE user_id = $1 AND key = $2
    `, [userId, key]);

    let param: Parameter;

    if (existing.rows.length > 0) {
        // Update
        const id = existing.rows[0].id;
        await db.query(`
            UPDATE parameters SET value = $1, updated_at = $2 WHERE id = $3
        `, [JSON.stringify(value), timestamp, id]);

        param = { id, user_id: userId, key, value, updated_at: timestamp };
        await trackChange('parameters', id, 'UPDATE', { ...param, value: JSON.stringify(value) });
    } else {
        // Insert
        const id = generateId();
        await db.query(`
            INSERT INTO parameters (id, user_id, key, value, updated_at)
            VALUES ($1, $2, $3, $4, $5)
        `, [id, userId, key, JSON.stringify(value), timestamp]);

        param = { id, user_id: userId, key, value, updated_at: timestamp };
        await trackChange('parameters', id, 'INSERT', { ...param, value: JSON.stringify(value) });
    }

    triggerBackgroundSync();
    return param;
}

// ============================================================================
// Import Entries (the Inbox)
// ============================================================================
// Rows are inserted server-side by the importer Lambdas and arrive via pull. The client
// only changes their status, and pushes just those fields (never `raw`).

type ImportEntryRow = Omit<ImportEntry, 'raw'> & { raw: string | Record<string, unknown> | null };

function parseImportEntry(row: ImportEntryRow): ImportEntry {
    let raw: Record<string, unknown> | null = null;
    if (typeof row.raw === 'string') {
        try {
            raw = JSON.parse(row.raw);
        } catch {
            raw = { body: row.raw };
        }
    } else {
        raw = row.raw;
    }
    return {
        ...row,
        amount_cents: row.amount_cents != null ? Number(row.amount_cents) : null,
        raw,
    };
}

/**
 * Pending entries (oldest movement first), or resolved ones from the last `sinceDays` days
 * (most recently resolved first).
 */
export async function fetchImportEntries(status: 'pending' | 'resolved', sinceDays: number = 60): Promise<ImportEntry[]> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();

    const result = status === 'pending'
        ? await db.query<ImportEntryRow>(`
            SELECT * FROM import_entries
            WHERE user_id = $1 AND deleted_at IS NULL AND status = 'pending'
            ORDER BY date ASC NULLS LAST, created_at ASC
        `, [userId])
        : await db.query<ImportEntryRow>(`
            SELECT * FROM import_entries
            WHERE user_id = $1 AND deleted_at IS NULL AND status <> 'pending'
              AND resolved_at >= $2
            ORDER BY resolved_at DESC
        `, [userId, new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()]);

    return result.rows.map(parseImportEntry);
}

/** Every non-deleted entry, for Settings (unmapped card references). */
export async function fetchAllImportEntries(): Promise<ImportEntry[]> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();
    const result = await db.query<ImportEntryRow>(`
        SELECT * FROM import_entries WHERE user_id = $1 AND deleted_at IS NULL
    `, [userId]);
    return result.rows.map(parseImportEntry);
}

export async function countPendingImportEntries(): Promise<number> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();
    const result = await db.query<{ count: number }>(`
        SELECT COUNT(*)::int AS count FROM import_entries
        WHERE user_id = $1 AND deleted_at IS NULL AND status = 'pending'
    `, [userId]);
    return result.rows[0]?.count ?? 0;
}

async function setImportEntryStatus(
    id: string,
    status: ImportStatus,
    transactionId: string | null
): Promise<void> {
    const db = await getDatabaseAsync();
    const timestamp = now();
    const resolvedAt = status === 'pending' ? null : timestamp;

    const result = await db.query<{ id: string }>(`
        UPDATE import_entries
        SET status = $1, transaction_id = $2, resolved_at = $3, updated_at = $4
        WHERE id = $5
        RETURNING id
    `, [status, transactionId, resolvedAt, timestamp, id]);
    if (result.rows.length === 0) {
        throw new Error('Import entry not found');
    }

    await trackChange('import_entries', id, 'UPDATE', {
        id,
        status,
        transaction_id: transactionId,
        resolved_at: resolvedAt,
        updated_at: timestamp,
    });
}

/**
 * Turns an entry into a real transaction. The transaction INSERT is queued before the
 * entry UPDATE, so the server's FK on transaction_id holds when they're pushed in order.
 */
export async function confirmImportEntry(entryId: string, transaction: TransactionInput): Promise<Transaction> {
    const tx = await insertTransaction(transaction);
    await setImportEntryStatus(entryId, 'confirmed', tx.id);
    triggerBackgroundSync();
    return tx;
}

/**
 * Turns an entry bought in cuotas into a monthly recurring rule (one occurrence per cuota),
 * the way installment purchases are modelled. The entry is confirmed without a
 * transaction_id: confirmed + no transaction means "added as cuotas".
 */
export async function confirmImportEntryAsInstallments(
    entryId: string,
    rule: Partial<RecurringRule>
): Promise<RecurringRule> {
    const created = await insertRecurringRule(rule);
    await setImportEntryStatus(entryId, 'confirmed', null);
    triggerBackgroundSync();
    return created;
}

export async function dismissImportEntry(entryId: string): Promise<void> {
    await setImportEntryStatus(entryId, 'dismissed', null);
    triggerBackgroundSync();
}

/**
 * Puts a resolved entry back in the Inbox. A transaction created from it is left alone
 * (delete it from the Transactions list if it shouldn't exist).
 */
export async function reopenImportEntry(entryId: string): Promise<void> {
    await setImportEntryStatus(entryId, 'pending', null);
    triggerBackgroundSync();
}
