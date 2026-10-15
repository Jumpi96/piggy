import { supabase } from '../../supabase';
import { getDatabaseAsync, getSyncMeta, setSyncMeta } from '../database';
import { LEGACY_BALANCE_FLAGS_KEY } from '../schema';
import { signedBalanceCents } from '../../balance';
import { trackChange } from './queue';
import type { Direction } from '../../../types';

/** A transaction that was flagged to_be_balanced, with changes still queued, when schema v7 dropped the flag. */
export interface LegacyBalanceFlag {
    id: string;
    user_id: string;
    date: string;
    direction: Direction;
    amount_cents: number;
    currency_code: string;
    exchange_rate_id: string | null;
}

/**
 * Turns the flags remembered by the v7 migration into balance entries, once it is safe to
 * tell whether the server already did.
 *
 * The server migration converted every flagged row it had. A flag set offline only reaches
 * it through the queued push, which no longer carries the flag, so the server has no entry
 * for it. For each remembered transaction, after its queued changes have been pushed:
 * - an entry for it already exists (here or on the server): nothing to do;
 * - otherwise: add a full-amount entry linked to it, the way the server migration would have.
 * Ones still waiting to push, or whose server check failed, are kept for the next sync.
 * Returns the number of entries created (they are queued for push).
 */
export async function convertLegacyBalanceFlags(): Promise<number> {
    const stored = await getSyncMeta(LEGACY_BALANCE_FLAGS_KEY);
    if (!stored) return 0;

    let flags: LegacyBalanceFlag[];
    try {
        flags = JSON.parse(stored);
    } catch {
        console.error('[Sync] Unreadable legacy balance flags, dropping them');
        await setSyncMeta(LEGACY_BALANCE_FLAGS_KEY, '');
        return 0;
    }

    const db = await getDatabaseAsync();
    const remaining: LegacyBalanceFlag[] = [];
    let created = 0;

    for (const flag of flags) {
        const queued = await db.query(`
            SELECT 1 FROM _pending_changes
            WHERE table_name = 'transactions' AND record_id = $1 AND synced_at IS NULL
            LIMIT 1
        `, [flag.id]);
        if (queued.rows.length > 0) {
            remaining.push(flag);
            continue;
        }

        const local = await db.query(`SELECT 1 FROM balance_entries WHERE transaction_id = $1 LIMIT 1`, [flag.id]);
        if (local.rows.length > 0) continue;

        const { data, error } = await supabase
            .from('balance_entries')
            .select('id')
            .eq('transaction_id', flag.id)
            .limit(1);
        if (error) {
            console.warn('[Sync] Could not check balance entries for', flag.id, error.message);
            remaining.push(flag);
            continue;
        }
        if (data && data.length > 0) continue;

        const tx = await db.query<{ deleted_at: string | null }>(`SELECT deleted_at FROM transactions WHERE id = $1`, [flag.id]);
        if (tx.rows.length === 0 || tx.rows[0].deleted_at) continue;

        const timestamp = new Date().toISOString();
        const entry = {
            id: crypto.randomUUID(),
            user_id: flag.user_id,
            date: flag.date,
            amount_cents: signedBalanceCents(flag.direction, Number(flag.amount_cents)),
            currency_code: flag.currency_code,
            exchange_rate_id: flag.exchange_rate_id,
            transaction_id: flag.id,
            kind: 'entry' as const,
            note: null,
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
        await trackChange('balance_entries', entry.id, 'INSERT', entry);
        created++;
    }

    await setSyncMeta(LEGACY_BALANCE_FLAGS_KEY, remaining.length > 0 ? JSON.stringify(remaining) : '');
    return created;
}
