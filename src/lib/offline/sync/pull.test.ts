import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record when each server query runs so we can assert the watermark predates them.
const selectTimes: number[] = [];
const queryResult = { data: [] as unknown[], error: null };
const builder = {
    gte: vi.fn(() => builder),
    then: (resolve: (v: typeof queryResult) => void) => resolve(queryResult),
};
const selectMock = vi.fn((_cols: string) => {
    selectTimes.push(Date.now());
    return builder;
});
const fromMock = vi.fn((_table: string) => ({ select: selectMock }));

const setLastSyncMock = vi.fn((_ts: string) => Promise.resolve());

vi.mock('../../supabase', () => ({ supabase: { from: (t: string) => fromMock(t) } }));
vi.mock('../database', () => ({
    getDatabaseAsync: () => Promise.resolve({ query: vi.fn(() => Promise.resolve({ rows: [] })) }),
    getLastSyncTimestamp: () => Promise.resolve(null),
    setLastSyncTimestamp: (ts: string) => setLastSyncMock(ts),
}));
vi.mock('./queue', () => ({ getPendingChanges: () => Promise.resolve([]) }));

import { pullChanges } from './pull';

describe('pullChanges watermark', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selectTimes.length = 0;
    });

    it('stamps last-sync from a watermark captured BEFORE the queries run', async () => {
        const result = await pullChanges();
        expect(result.success).toBe(true);
        expect(setLastSyncMock).toHaveBeenCalledTimes(1);
        expect(selectTimes.length).toBeGreaterThan(0);

        const stampedAt = new Date(setLastSyncMock.mock.calls[0][0]).getTime();
        const firstQueryAt = Math.min(...selectTimes);
        // A watermark captured before querying is <= the first query time. The old code
        // captured it after the whole loop, so it would be > the first query time.
        expect(stampedAt).toBeLessThanOrEqual(firstQueryAt);
    });
});
