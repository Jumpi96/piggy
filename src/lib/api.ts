import { getDatabaseAsync, getCurrentUserId } from './offline/database';
import { trackChange, triggerBackgroundSync } from './offline/sync';
import type { Currency, CreditCard, Transaction, RecurringRule, Parameter } from '../types';
import { getTodayLocalDate, getPeriodRange, getPeriodForDate, cacheMonthStartDay } from './dates';
import { generateOccurrences, mergeTransactions } from './recurringUtils';
import { normalizeForComparison } from './utils';
import { pickRateForDate } from './currency';

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
export async function deleteFutureTransactionsForRule(ruleId: string, startDate: string): Promise<void> {
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
        ORDER BY name
    `, [userId]);

    return result.rows;
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
        enabled: true,
        created_at: timestamp,
        deleted_at: null
    };

    await db.query(`
        INSERT INTO credit_cards (id, user_id, name, closing_day, payment_day, enabled, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [id, userId, name, closingDay, paymentDay, true, timestamp]);

    await trackChange('credit_cards', id, 'INSERT', card);
    triggerBackgroundSync();

    return card;
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
          AND t.date <= $4
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
          AND original_date <= $4
          AND (date < $3 OR date > $4)
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
            recurring_rule_id, original_date, to_be_balanced, note, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `, [
        id, userId, transaction.date, transaction.direction, transaction.amount_cents,
        transaction.currency_code, transaction.exchange_rate_id || null, transaction.category,
        transaction.tag, transaction.payment_method, transaction.credit_card_id || null,
        transaction.recurring_rule_id || null, transaction.original_date || null,
        transaction.to_be_balanced, transaction.note || null,
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
        'original_date', 'to_be_balanced', 'note'
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

export async function clearBalancedTransactions(monthStart: string): Promise<number> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();
    const timestamp = now();

    // monthStart is a period anchor; derive the period window.
    const { start: startStr, end: endStr } = getPeriodRange(monthStart);

    // Get all balanced transactions for the period
    const result = await db.query<{ id: string }>(`
        SELECT id FROM transactions
        WHERE user_id = $1
          AND deleted_at IS NULL
          AND to_be_balanced = true
          AND date >= $2
          AND date < $3
    `, [userId, startStr, endStr]);

    // Update each transaction and track changes
    for (const row of result.rows) {
        await db.query(`
            UPDATE transactions
            SET to_be_balanced = false, updated_at = $1
            WHERE id = $2
        `, [timestamp, row.id]);

        await trackChange('transactions', row.id, 'UPDATE', {
            id: row.id,
            to_be_balanced: false,
            updated_at: timestamp
        });
    }

    if (result.rows.length > 0) {
        triggerBackgroundSync();
    }

    return result.rows.length;
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
// Recurring Generation (Local Implementation)
// ============================================================================

export async function cleanupFutureRecurring(): Promise<void> {
    const db = await getDatabaseAsync();
    const userId = await getUserId();
    const today = getTodayLocalDate();

    await db.query(`
        UPDATE transactions
        SET deleted_at = $1
        WHERE user_id = $2
          AND recurring_rule_id IS NOT NULL
          AND date >= $3
          AND original_date IS NULL
    `, [now(), userId, today]);
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
