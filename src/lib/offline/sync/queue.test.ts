import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn((_sql: string) => Promise.resolve({ rows: [] }));
vi.mock('../database', () => ({ getDatabaseAsync: () => Promise.resolve({ query: queryMock }) }));

import { getPendingChanges } from './queue';

describe('getPendingChanges ordering', () => {
    beforeEach(() => vi.clearAllMocks());

    it('orders by created_at then the monotonic id (FIFO tiebreaker)', async () => {
        await getPendingChanges();
        const sql = queryMock.mock.calls[0][0].replace(/\s+/g, ' ');
        expect(sql).toContain('ORDER BY created_at ASC, id ASC');
    });
});
