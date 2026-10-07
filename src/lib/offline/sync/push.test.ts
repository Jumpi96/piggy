import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingChange } from './queue';

type SbError = { code: string; message: string } | null;
type SbResult = { data?: Array<{ id: string }>; error: SbError };

// Terminal result for update/delete chains; mutated per test to simulate zero rows.
let terminalResult: SbResult = { data: [{ id: 'srv-id' }], error: null };
// Result of the adopt lookup: which server id (if any) owns the occurrence.
let serverSelectResult: { data: { id: string } | null; error: SbError } = { data: { id: 'srv-id' }, error: null };

// --- Controllable, chainable supabase mock --------------------------------------
const insertMock = vi.fn((_payload?: unknown): Promise<{ error: SbError }> => Promise.resolve({ error: null }));

// update(...).eq(...).eq(...)  (natural-key update, awaited)
// update(...).eq(...).select() (pushUpdate/pushDelete)
const selectMock = vi.fn((_cols?: string) => Promise.resolve(terminalResult));
const eqMock = vi.fn((_col: string, _val: unknown) => updateChain);
const updateChain = {
    eq: eqMock,
    select: selectMock,
    then: (resolve: (v: SbResult) => void) => resolve(terminalResult),
};
const updateMock = vi.fn((_fields: Record<string, unknown>) => updateChain);

// select('id').eq(...).eq(...).maybeSingle()  (adopt lookup)
const maybeSingleMock = vi.fn(() => Promise.resolve(serverSelectResult));
const selectEqMock = vi.fn((_col: string, _val: unknown) => selectChain);
const selectChain = { eq: selectEqMock, maybeSingle: maybeSingleMock };
const fromSelectMock = vi.fn((_cols: string) => selectChain);

const upsertMock = vi.fn();
const fromMock = vi.fn((_table: string) => ({
    insert: insertMock,
    update: updateMock,
    select: fromSelectMock,
    upsert: upsertMock,
}));

const dbQueryMock = vi.fn((_sql: string, _params?: unknown[]) => Promise.resolve({ rows: [] }));

vi.mock('../../supabase', () => ({ supabase: { from: (table: string) => fromMock(table) } }));
vi.mock('../database', () => ({ getDatabaseAsync: () => Promise.resolve({ query: dbQueryMock }) }));
vi.mock('./queue', () => ({
    markChangeAsSynced: vi.fn(() => Promise.resolve()),
    recordSyncError: vi.fn(() => Promise.resolve()),
    getPendingChanges: vi.fn(() => Promise.resolve([])),
    clearSyncedChanges: vi.fn(() => Promise.resolve()),
}));

import { pushChangeImmediately, pushChanges } from './push';
import * as queue from './queue';

function change(op: PendingChange['operation'], payload: Record<string, unknown>): PendingChange {
    return {
        id: 1,
        table_name: 'transactions',
        record_id: String(payload.id ?? 'rec'),
        operation: op,
        payload: JSON.stringify(payload),
        created_at: '2026-07-30T00:00:00Z',
        synced_at: null,
        retry_count: 0,
        error: null,
    };
}

const overridePayload = {
    id: 'local-uuid', user_id: 'u1', recurring_rule_id: 'rule-1',
    original_date: '2026-07-30', date: '2026-07-30', amount_cents: 1000,
    created_at: '2026-07-30T00:00:00Z',
};

describe('pushInsert override conflict handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        terminalResult = { data: [{ id: 'srv-id' }], error: null };
        serverSelectResult = { data: { id: 'srv-id' }, error: null };
    });

    it('inserts a new override by id (no upsert that could rename the PK)', async () => {
        insertMock.mockResolvedValueOnce({ error: null });
        const ok = await pushChangeImmediately(change('INSERT', overridePayload));
        expect(ok).toBe(true);
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(upsertMock).not.toHaveBeenCalled();
        expect(updateMock).not.toHaveBeenCalled();
        expect(dbQueryMock).not.toHaveBeenCalled();
    });

    it('on unique conflict, updates by natural key WITHOUT touching id/created_at', async () => {
        insertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
        const ok = await pushChangeImmediately(change('INSERT', overridePayload));
        expect(ok).toBe(true);

        expect(upsertMock).not.toHaveBeenCalled();
        expect(updateMock).toHaveBeenCalledTimes(1);
        const updatePayload = updateMock.mock.calls[0][0];
        expect(updatePayload).not.toHaveProperty('id');
        expect(updatePayload).not.toHaveProperty('created_at');
        expect(updatePayload).toMatchObject({ amount_cents: 1000 });
        expect(eqMock).toHaveBeenCalledWith('recurring_rule_id', 'rule-1');
        expect(eqMock).toHaveBeenCalledWith('original_date', '2026-07-30');
    });

    it('adopts the server id locally when it differs (repoints row + pending changes)', async () => {
        insertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
        serverSelectResult = { data: { id: 'srv-id' }, error: null };

        const ok = await pushChangeImmediately(change('INSERT', overridePayload));
        expect(ok).toBe(true);

        const idUpdate = dbQueryMock.mock.calls.find(c => /UPDATE transactions SET id/.test(c[0]));
        expect(idUpdate).toBeDefined();
        expect(idUpdate![1]).toEqual(['srv-id', 'local-uuid']);

        const pendingRemap = dbQueryMock.mock.calls.find(c => /_pending_changes SET record_id/.test(c[0]));
        expect(pendingRemap).toBeDefined();
        expect(pendingRemap![1]).toEqual(['srv-id', 'transactions', 'local-uuid']);
    });

    it('does not touch local ids when the server already holds our id', async () => {
        insertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
        serverSelectResult = { data: { id: 'local-uuid' }, error: null }; // same id -> nothing to adopt

        const ok = await pushChangeImmediately(change('INSERT', overridePayload));
        expect(ok).toBe(true);
        expect(dbQueryMock).not.toHaveBeenCalled();
    });
});

describe('pushUpdate / pushDelete zero-row handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        terminalResult = { data: [{ id: 'srv-id' }], error: null };
        serverSelectResult = { data: { id: 'srv-id' }, error: null };
    });

    it('succeeds when the update matches a server row', async () => {
        const ok = await pushChangeImmediately(change('UPDATE', { id: 't1', amount_cents: 5, updated_at: 'x' }));
        expect(ok).toBe(true);
        expect(selectMock).toHaveBeenCalled();
    });

    it('fails (retries) when the update matches NO server row', async () => {
        terminalResult = { data: [], error: null };
        const ok = await pushChangeImmediately(change('UPDATE', { id: 't1', amount_cents: 5, updated_at: 'x' }));
        expect(ok).toBe(false);
    });

    it('fails (retries) when a delete matches NO server row — prevents resurrection', async () => {
        terminalResult = { data: [], error: null };
        const ok = await pushChangeImmediately(change('DELETE', { id: 't1', deleted_at: 'x' }));
        expect(ok).toBe(false);
    });
});

describe('pushChanges retry policy', () => {
    const queued = (id: number, table: PendingChange['table_name'], op: PendingChange['operation'], payload: Record<string, unknown>, retry_count = 0): PendingChange => ({
        ...change(op, payload), id, table_name: table, retry_count,
    });

    beforeEach(() => {
        vi.clearAllMocks();
        terminalResult = { data: [{ id: 'srv-id' }], error: null };
        serverSelectResult = { data: { id: 'srv-id' }, error: null };
    });

    it('does not count a network error toward the retry cap, and stops the run', async () => {
        vi.mocked(queue.getPendingChanges).mockResolvedValueOnce([
            queued(1, 'credit_cards', 'INSERT', { id: 'c1' }),
            queued(2, 'credit_cards', 'INSERT', { id: 'c2' }),
        ]);
        insertMock.mockResolvedValueOnce({ error: { code: '', message: 'TypeError: Failed to fetch' } });

        const result = await pushChanges();

        expect(result.success).toBe(false);
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(queue.recordSyncError).toHaveBeenCalledWith(1, 'TypeError: Failed to fetch', { countAttempt: false });
    });

    it('holds back later changes to a record whose earlier change failed, but pushes other records', async () => {
        vi.mocked(queue.getPendingChanges).mockResolvedValueOnce([
            queued(1, 'credit_cards', 'INSERT', { id: 'c1' }),
            queued(2, 'credit_cards', 'UPDATE', { id: 'c1', name: 'x' }),
            queued(3, 'credit_cards', 'INSERT', { id: 'c2' }),
        ]);
        insertMock
            .mockResolvedValueOnce({ error: { code: '23514', message: 'check constraint' } })
            .mockResolvedValueOnce({ error: null });

        const result = await pushChanges();

        expect(updateMock).not.toHaveBeenCalled();
        expect(insertMock).toHaveBeenCalledTimes(2);
        expect(queue.recordSyncError).toHaveBeenCalledTimes(1);
        expect(queue.recordSyncError).toHaveBeenCalledWith(1, 'check constraint', { countAttempt: true });
        expect(queue.markChangeAsSynced).toHaveBeenCalledWith(3);
        expect(result.changesPushed).toBe(1);
    });

    it('sends later changes to the server id adopted earlier in the same run', async () => {
        vi.mocked(queue.getPendingChanges).mockResolvedValueOnce([
            queued(1, 'transactions', 'INSERT', overridePayload),
            queued(2, 'transactions', 'UPDATE', { id: 'local-uuid', amount_cents: 5 }),
        ]);
        insertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });

        const result = await pushChanges();

        expect(result.success).toBe(true);
        expect(eqMock).toHaveBeenLastCalledWith('id', 'srv-id');
    });

    it('on a duplicate parameter key, writes by key and adopts the server id', async () => {
        insertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
        const ok = await pushChangeImmediately({
            ...change('INSERT', { id: 'local-param', user_id: 'u1', key: 'month_start_day', value: '15', updated_at: 'x' }),
            table_name: 'parameters',
        });

        expect(ok).toBe(true);
        const updatePayload = updateMock.mock.calls[0][0];
        expect(updatePayload).not.toHaveProperty('id');
        expect(updatePayload).toMatchObject({ key: 'month_start_day', value: 15 });
        expect(eqMock).toHaveBeenCalledWith('key', 'month_start_day');
        const idUpdate = dbQueryMock.mock.calls.find(c => /UPDATE parameters SET id/.test(c[0]));
        expect(idUpdate![1]).toEqual(['srv-id', 'local-param']);
    });
});
