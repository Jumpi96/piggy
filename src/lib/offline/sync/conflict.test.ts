import { describe, it, expect } from 'vitest';
import { resolveConflict } from './conflict';

describe('resolveConflict', () => {
    it('chooses local when local timestamp is newer', () => {
        const result = resolveConflict(
            { id: 'tx-1', updated_at: '2026-01-02T10:00:00.000Z' },
            { id: 'tx-1', updated_at: '2026-01-01T10:00:00.000Z' },
            'transactions'
        );

        expect(result.resolution).toBe('local');
    });

    it('chooses server when local timestamp is invalid', () => {
        const result = resolveConflict(
            { id: 'tx-1', updated_at: 'not-a-date' },
            { id: 'tx-1', updated_at: '2026-01-01T10:00:00.000Z' },
            'transactions'
        );

        expect(result.resolution).toBe('server');
    });
});
