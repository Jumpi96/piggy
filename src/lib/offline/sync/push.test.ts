import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingChange } from './queue';

// --- Controllable supabase mock -------------------------------------------------
type SbError = { code: string; message: string } | null;
const insertMock = vi.fn((_payload?: unknown): Promise<{ error: SbError }> => Promise.resolve({ error: null }));
const eqInner = vi.fn((_col: string, _val: unknown) => Promise.resolve({ error: null }));
const eqOuter = vi.fn((_col: string, _val: unknown) => ({ eq: eqInner }));
const updateMock = vi.fn((_fields: Record<string, unknown>) => ({ eq: eqOuter }));
const upsertMock = vi.fn();
const fromMock = vi.fn((_table: string) => ({ insert: insertMock, update: updateMock, upsert: upsertMock }));

vi.mock('../../supabase', () => ({ supabase: { from: (table: string) => fromMock(table) } }));
vi.mock('./queue', () => ({
    markChangeAsSynced: vi.fn(() => Promise.resolve()),
    recordSyncError: vi.fn(() => Promise.resolve()),
    getPendingChanges: vi.fn(() => Promise.resolve([])),
    clearSyncedChanges: vi.fn(() => Promise.resolve()),
}));

import { pushChangeImmediately } from './push';

function overrideChange(): PendingChange {
    return {
        id: 1,
        table_name: 'transactions',
        record_id: 'local-uuid',
        operation: 'INSERT',
        payload: JSON.stringify({
            id: 'local-uuid',
            user_id: 'u1',
            recurring_rule_id: 'rule-1',
            original_date: '2026-07-30',
            date: '2026-07-30',
            amount_cents: 1000,
            created_at: '2026-07-30T00:00:00Z',
        }),
        created_at: '2026-07-30T00:00:00Z',
        synced_at: null,
        retry_count: 0,
        error: null,
    };
}

describe('pushInsert override conflict handling', () => {
    beforeEach(() => vi.clearAllMocks());

    it('inserts a new override by id (no upsert that could rename the PK)', async () => {
        insertMock.mockResolvedValueOnce({ error: null });
        const ok = await pushChangeImmediately(overrideChange());
        expect(ok).toBe(true);
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(upsertMock).not.toHaveBeenCalled();
        expect(updateMock).not.toHaveBeenCalled();
    });

    it('on unique conflict, updates by natural key WITHOUT touching id/created_at', async () => {
        insertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
        const ok = await pushChangeImmediately(overrideChange());
        expect(ok).toBe(true);

        expect(upsertMock).not.toHaveBeenCalled();
        expect(updateMock).toHaveBeenCalledTimes(1);
        const updatePayload = updateMock.mock.calls[0][0];
        // The id must never be part of the update — that is the PK-rewrite bug.
        expect(updatePayload).not.toHaveProperty('id');
        expect(updatePayload).not.toHaveProperty('created_at');
        expect(updatePayload).toMatchObject({ amount_cents: 1000 });
        // Targeted by the natural key, not by id.
        expect(eqOuter).toHaveBeenCalledWith('recurring_rule_id', 'rule-1');
        expect(eqInner).toHaveBeenCalledWith('original_date', '2026-07-30');
    });
});
