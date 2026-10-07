import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn((_sql: string) => Promise.resolve({ rows: [] }));
vi.mock('../database', () => ({ getDatabaseAsync: () => Promise.resolve({ query: queryMock }) }));

import { getPendingChanges } from './queue';

describe('getPendingChanges ordering', () => {
    beforeEach(() => vi.clearAllMocks());

    it('orders by the monotonic id only (device-clock created_at can go backwards)', async () => {
        await getPendingChanges();
        const sql = queryMock.mock.calls[0][0].replace(/\s+/g, ' ');
        expect(sql).toContain('ORDER BY id ASC');
        expect(sql).not.toContain('created_at');
    });
});
