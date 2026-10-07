import type { Transaction } from '@electric-sql/pglite';
import { supabase } from '../../supabase';
import { getDatabaseAsync, getLastSyncTimestamp, setLastSyncTimestamp } from '../database';
import { SYNC_TABLES, tableHasUpdatedAt, type SyncTableName } from '../schema';
import { resolveConflict, type SyncRecord } from './conflict';
import { getPendingChanges, notifyPendingChanges } from './queue';

export interface PullResult {
    success: boolean;
    tablesUpdated: number;
    recordsProcessed: number;
    errors: string[];
}

// Anything that can run a query: the PGlite instance itself or an open transaction.
type Queryable = Pick<Transaction, 'query'>;

// PostgREST caps every response at max_rows (1000 on Supabase by default). An unpaginated
// select silently returns an arbitrary first page, and the watermark then skips the rest.
const PAGE_SIZE = 1000;

// Each incremental pull re-reads this much time before the last watermark. The watermark
// comes from the device clock while updated_at comes from the server's, so a little skew
// (or a row committed just after its now()) would otherwise slip between two pulls for
// good. Re-pulled rows are no-ops: same updated_at → skipped in upsertLocalRecord.
const PULL_OVERLAP_MS = 2 * 60 * 1000;

// Local tables whose rows reference each parent table (local FKs have no ON DELETE
// action). Used so a full resync never deletes a parent row something still points at.
const REFERENCED_BY: Partial<Record<SyncTableName, Array<[SyncTableName, string]>>> = {
    exchange_rates: [['transactions', 'exchange_rate_id']],
    credit_cards: [['transactions', 'credit_card_id'], ['recurring_rules', 'credit_card_id']],
    recurring_rules: [['transactions', 'recurring_rule_id']],
};

/**
 * Pulls changes from Supabase server to local SQLite.
 * Uses incremental sync based on updated_at timestamps.
 */
export async function pullChanges(): Promise<PullResult> {
    const result: PullResult = {
        success: true,
        tablesUpdated: 0,
        recordsProcessed: 0,
        errors: []
    };

    const lastSync = await getLastSyncTimestamp();
    // Capture the watermark BEFORE issuing any query. The next pull filters on the
    // server's updated_at >= this value, so it must be a lower bound on "when this pull
    // observed the server". Stamping it AFTER the queries (as before) skipped any row
    // written during the pull window: its updated_at landed between a table's query and
    // the post-loop stamp, so it was in neither this result set nor the next pull's
    // filter — a permanent silent divergence.
    const watermark = new Date().toISOString();
    const since = lastSync
        ? new Date(new Date(lastSync).getTime() - PULL_OVERLAP_MS).toISOString()
        : null;
    console.log(`[Sync Pull] Starting pull, last sync: ${lastSync || 'never'}`);
    const pendingChanges = await getPendingChanges();
    const pendingByTable = new Map<SyncTableName, Set<string>>(
        SYNC_TABLES.map(table => [table, new Set<string>()])
    );

    for (const change of pendingChanges) {
        pendingByTable.get(change.table_name)?.add(change.record_id);
    }

    for (const table of SYNC_TABLES) {
        try {
            const { processed, failed } = await pullTable(table, since, pendingByTable.get(table) || new Set());
            if (processed > 0) {
                result.tablesUpdated++;
                result.recordsProcessed += processed;
            }
            // A row that failed to apply must be retried, so the watermark can't move past it.
            if (failed > 0) {
                result.errors.push(`Failed to apply ${failed} ${table} row(s)`);
                result.success = false;
            }
        } catch (error) {
            const errorMsg = `Failed to pull ${table}: ${error instanceof Error ? error.message : String(error)}`;
            console.error(`[Sync Pull] ${errorMsg}`);
            result.errors.push(errorMsg);
            result.success = false;
        }
    }

    // Update last sync timestamp if successful (using the pre-query watermark).
    if (result.success) {
        await setLastSyncTimestamp(watermark);
    }

    console.log(`[Sync Pull] Complete: ${result.recordsProcessed} records from ${result.tablesUpdated} tables`);
    return result;
}

async function pullTable(
    table: SyncTableName,
    since: string | null,
    pendingRecordIds: Set<string>
): Promise<{ processed: number; failed: number }> {
    // Skip currencies after first sync (reference data, rarely changes)
    if (table === 'currencies' && since) {
        return { processed: 0, failed: 0 };
    }

    const db = await getDatabaseAsync();
    const data = await fetchAllRows(table, tableHasUpdatedAt(table) ? since : null);

    let processed = 0;
    let failed = 0;
    const pkColumn = getPrimaryKeyColumn(table);

    for (const serverRecord of data) {
        try {
            if (await upsertLocalRecord(db, table, serverRecord, pendingRecordIds)) {
                processed++;
            }
        } catch (error) {
            failed++;
            console.error(`[Sync Pull] Failed to upsert ${table}/${serverRecord[pkColumn]}:`, error);
        }
    }

    return { processed, failed };
}

/**
 * Fetches every row of a table (optionally only those updated since `since`), page by
 * page. Ordered by primary key: rows never leave the result set while paging (deletes are
 * soft, and an update only raises updated_at, so it still matches the filter), so offsets
 * can only shift forward on concurrent inserts — at worst a duplicate, never a skip.
 */
async function fetchAllRows(
    table: SyncTableName,
    since: string | null
): Promise<Record<string, unknown>[]> {
    const pkColumn = getPrimaryKeyColumn(table);
    const rows: Record<string, unknown>[] = [];

    // Advance by rows actually returned: a server max_rows below PAGE_SIZE returns short
    // pages, and stepping by PAGE_SIZE would skip the rows in between.
    for (let offset = 0; ; offset = rows.length) {
        let query = supabase.from(table).select('*', { count: 'exact' });
        if (since) {
            query = query.gte('updated_at', since);
        }

        const { data, error, count } = await query
            .order(pkColumn, { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            throw new Error(`Supabase query failed: ${error.message}`);
        }
        if (!data || data.length === 0) break;

        rows.push(...data);
        // Stop on the server's total rather than on a short page, for the same reason.
        if (count !== null && rows.length >= count) break;
    }

    return rows;
}

// Get the primary key column for a table
function getPrimaryKeyColumn(table: SyncTableName): string {
    if (table === 'currencies') return 'code';
    return 'id';
}

function sameTimestamp(a: SyncRecord, b: SyncRecord): boolean {
    const ta = a.updated_at ? new Date(a.updated_at).getTime() : NaN;
    const tb = b.updated_at ? new Date(b.updated_at).getTime() : NaN;
    return Number.isFinite(ta) && ta === tb;
}

/**
 * Finds a local row that holds the same natural key as `record` under a different id.
 * Inserting `record` would violate the local UNIQUE constraint on that key, failing the
 * row forever. This happens when two devices created the same parameter key or the same
 * recurring override offline, and push settled on the server's row.
 */
async function findNaturalKeyConflict(
    db: Queryable,
    table: SyncTableName,
    record: Record<string, unknown>
): Promise<string | null> {
    let result: { rows: Array<{ id: string }> } | null = null;

    if (table === 'parameters') {
        result = await db.query<{ id: string }>(
            `SELECT id FROM parameters WHERE user_id = $1 AND key = $2 AND id <> $3`,
            [record.user_id, record.key, record.id]
        );
    } else if (table === 'transactions' && record.recurring_rule_id && record.original_date) {
        result = await db.query<{ id: string }>(
            `SELECT id FROM transactions WHERE recurring_rule_id = $1 AND original_date = $2 AND id <> $3`,
            [record.recurring_rule_id, record.original_date, record.id]
        );
    }

    return result?.rows[0]?.id ?? null;
}

async function upsertLocalRecord(
    db: Queryable,
    table: SyncTableName,
    serverRecord: Record<string, unknown>,
    pendingRecordIds?: Set<string>,
    // force: the server copy is authoritative (full resync) — skip last-write-wins.
    { force = false }: { force?: boolean } = {}
): Promise<boolean> {
    const pkColumn = getPrimaryKeyColumn(table);
    const pkValue = serverRecord[pkColumn] as string;

    if (pendingRecordIds?.has(pkValue)) {
        console.log(`[Sync Pull] Skipping ${table}/${pkValue} due to pending local changes`);
        return false;
    }

    // Check if local record exists
    const existing = await db.query<SyncRecord>(`
        SELECT * FROM ${table} WHERE ${pkColumn} = $1
    `, [pkValue]);

    const localRecord = existing.rows[0] || null;

    // If local record exists, resolve conflict (skip for reference tables like currencies)
    if (localRecord && table !== 'currencies' && !force) {
        // Same version we already hold (e.g. re-pulled by the overlap window).
        if (sameTimestamp(localRecord, serverRecord as SyncRecord)) {
            return false;
        }

        const { resolution } = resolveConflict(
            localRecord,
            serverRecord as SyncRecord,
            table
        );

        if (resolution === 'local') {
            // Local wins - don't update
            return false;
        }
    }

    // Prepare record for local storage
    const preparedRecord = prepareRecordForLocal(table, serverRecord);

    const conflictingId = await findNaturalKeyConflict(db, table, preparedRecord);
    if (conflictingId) {
        if (pendingRecordIds?.has(conflictingId)) {
            // The local copy still has to be pushed; push resolves the key onto the
            // server's id, and the next pull lands cleanly.
            console.log(`[Sync Pull] Skipping ${table}/${pkValue}: local ${conflictingId} holds its key with pending changes`);
            return false;
        }
        // The local copy was already pushed and merged into the server row, so the server
        // row is canonical. Nothing references parameters or transactions, so drop it.
        console.log(`[Sync Pull] Replacing local ${table}/${conflictingId} with server ${pkValue} (same natural key)`);
        await db.query(`DELETE FROM ${table} WHERE id = $1`, [conflictingId]);
    }

    // Build upsert query dynamically
    const columns = Object.keys(preparedRecord);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateClauses = columns
        .filter(c => c !== pkColumn)
        .map(c => `${c} = EXCLUDED.${c}`)
        .join(', ');

    const values = columns.map(c => preparedRecord[c]);

    // Handle case where there are no columns to update (e.g., currencies with only code and name)
    const conflictClause = updateClauses
        ? `ON CONFLICT (${pkColumn}) DO UPDATE SET ${updateClauses}`
        : `ON CONFLICT (${pkColumn}) DO NOTHING`;

    await db.query(`
        INSERT INTO ${table} (${columns.join(', ')})
        VALUES (${placeholders})
        ${conflictClause}
    `, values);

    return true;
}

function prepareRecordForLocal(
    _table: SyncTableName,
    record: Record<string, unknown>
): Record<string, unknown> {
    const prepared: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
        // Convert JSONB fields to string. These columns are jsonb on Supabase but TEXT
        // locally, and every local reader JSON.parse()s them — pass an array through
        // unstringified and the exception list is silently lost on the next pull.
        if (key === 'schedule_config' || key === 'value' || key === 'exception_dates') {
            prepared[key] = typeof value === 'object' ? JSON.stringify(value) : value;
        }
        // Keep everything else as-is
        else {
            prepared[key] = value;
        }
    }

    return prepared;
}

/**
 * Performs initial hydration - downloads all user data on first sync.
 */
export async function initialHydration(
    onProgress?: (table: string, current: number, total: number) => void
): Promise<void> {
    const lastSync = await getLastSyncTimestamp();

    if (lastSync) {
        console.log('[Sync] Already hydrated, skipping initial hydration');
        return;
    }

    console.log('[Sync] Starting initial hydration...');
    // Capture the watermark before downloading so any row written during the (possibly
    // long) hydration is picked up by the first incremental pull rather than skipped.
    const watermark = new Date().toISOString();
    const db = await getDatabaseAsync();

    for (let i = 0; i < SYNC_TABLES.length; i++) {
        const table = SYNC_TABLES[i];
        onProgress?.(table, i + 1, SYNC_TABLES.length);

        try {
            await hydrateTable(db, table);
        } catch (error) {
            console.error(`[Sync] Failed to hydrate ${table}:`, error);
            throw error;
        }
    }

    await setLastSyncTimestamp(watermark);
    console.log('[Sync] Initial hydration complete');
}

async function hydrateTable(
    db: Queryable,
    table: SyncTableName
): Promise<void> {
    const data = await fetchAllRows(table, null);

    for (const record of data) {
        await upsertLocalRecord(db, table, record);
    }

    console.log(`[Sync] Hydrated ${table}: ${data.length} records`);
}

// FK dependencies: table -> tables it depends on (in order they should be hydrated)
const FK_DEPENDENCIES: Partial<Record<SyncTableName, SyncTableName[]>> = {
    'exchange_rates': ['currencies'],
    'recurring_rules': ['currencies', 'credit_cards'],
    'transactions': ['currencies', 'exchange_rates', 'credit_cards', 'recurring_rules'],
};

/**
 * Ensures all FK dependency tables are populated before resyncing a table.
 */
async function ensureDependenciesPopulated(
    db: Queryable,
    table: SyncTableName
): Promise<void> {
    const dependencies = FK_DEPENDENCIES[table];
    if (!dependencies) return;

    for (const depTable of dependencies) {
        const countResult = await db.query<{ count: number }>(
            `SELECT COUNT(*)::int as count FROM ${depTable}`
        );
        if ((countResult.rows[0]?.count ?? 0) === 0) {
            console.log(`[Sync] Dependency ${depTable} empty, hydrating before ${table} resync...`);
            await hydrateTable(db, depTable);
        }
    }
}

/**
 * Drops every unsynced change for one record and restores the server's copy locally (or
 * removes the row if it never reached the server). Used to give up on a change that keeps
 * failing. The server read happens first, so being offline changes nothing.
 */
export async function discardLocalChanges(table: SyncTableName, recordId: string): Promise<void> {
    const pkColumn = getPrimaryKeyColumn(table);
    const { data: serverRow, error } = await supabase
        .from(table)
        .select('*')
        .eq(pkColumn, recordId)
        .maybeSingle();
    if (error) {
        throw new Error(`Supabase query failed: ${error.message}`);
    }

    const db = await getDatabaseAsync();
    await db.transaction(async (tx) => {
        await tx.query(
            `DELETE FROM _pending_changes WHERE table_name = $1 AND record_id = $2 AND synced_at IS NULL`,
            [table, recordId]
        );

        if (serverRow) {
            await upsertLocalRecord(tx, table, serverRow, undefined, { force: true });
            return;
        }

        // Never reached the server. If local rows still point at it, dropping it would
        // strand them: their own pushes need this parent on the server. Refuse (throwing
        // rolls back the queue delete above) and let the user discard those first.
        for (const [refTable, refColumn] of REFERENCED_BY[table] ?? []) {
            const ref = await tx.query(`SELECT 1 FROM ${refTable} WHERE ${refColumn} = $1 LIMIT 1`, [recordId]);
            if (ref.rows.length > 0) {
                throw new Error(
                    `Can't discard: this ${table.replace(/_/g, ' ').replace(/s$/, '')} never reached the server and local ${refTable.replace(/_/g, ' ')} still use it. Discard or fix those changes first.`
                );
            }
        }
        await tx.query(`DELETE FROM ${table} WHERE ${pkColumn} = $1`, [recordId]);
    });

    await notifyPendingChanges();
}

/**
 * Performs a full resync of a single table: local becomes an exact copy of the server.
 * Used when reconciliation detects a count mismatch.
 *
 * The download happens first and the local swap runs in one transaction, so a network
 * drop mid-resync leaves the table untouched (it used to be emptied first and refilled
 * page by page), and pages never see a half-filled table. Instead of DELETE-all, rows are
 * upserted and only rows the server no longer has are removed: a blanket DELETE on
 * credit_cards / recurring_rules / exchange_rates violates the local FKs from
 * transactions and aborted every sync.
 */
export async function fullTableResync(table: SyncTableName): Promise<number> {
    console.log(`[Sync] Starting full resync for ${table}...`);
    const db = await getDatabaseAsync();

    // Ensure FK dependencies are populated before resyncing
    await ensureDependenciesPopulated(db, table);

    const serverRows = await fetchAllRows(table, null);
    const pkColumn = getPrimaryKeyColumn(table);

    await db.transaction(async (tx) => {
        // Rows with unsynced local changes stay as they are: overwriting them would revert
        // a pending edit/soft-delete or drop a row whose insert hasn't reached the server.
        // Read inside the transaction (via tx — the db handle would deadlock) so a write
        // made during the download is respected.
        const pending = await tx.query<{ record_id: string }>(
            `SELECT record_id FROM _pending_changes WHERE synced_at IS NULL AND table_name = $1`,
            [table]
        );
        const pendingIds = new Set(pending.rows.map(r => r.record_id));

        for (const row of serverRows) {
            await upsertLocalRecord(tx, table, row, pendingIds, { force: true });
        }

        const keepIds = [...serverRows.map(r => String(r[pkColumn])), ...pendingIds];
        const stillReferenced = (REFERENCED_BY[table] ?? [])
            .map(([refTable, refColumn]) =>
                `AND NOT EXISTS (SELECT 1 FROM ${refTable} r WHERE r.${refColumn} = ${table}.${pkColumn})`)
            .join(' ');

        const removed = await tx.query(
            `DELETE FROM ${table} WHERE NOT (${pkColumn} = ANY($1)) ${stillReferenced}`,
            [keepIds]
        );
        console.log(`[Sync] Resync ${table}: ${serverRows.length} server rows applied, ${removed.affectedRows ?? 0} local-only rows removed (${pendingIds.size} pending preserved)`);
    });

    // Get new count
    const countResult = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM ${table}`
    );
    const newCount = countResult.rows[0]?.count ?? 0;

    console.log(`[Sync] Full resync completed for ${table}: ${newCount} records`);
    return newCount;
}
