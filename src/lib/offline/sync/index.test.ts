import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const meta = new Map<string, string>();
const pushMock = vi.fn();
const pullMock = vi.fn();
const reconcileMock = vi.fn();
const resyncMock = vi.fn();

vi.mock('../database', () => ({
    getLastSyncTimestamp: () => Promise.resolve('2026-10-06T00:00:00.000Z'),
    getSyncMeta: (key: string) => Promise.resolve(meta.get(key) ?? null),
    setSyncMeta: (key: string, value: string) => {
        meta.set(key, value);
        return Promise.resolve();
    },
}));
vi.mock('./push', () => ({ pushChanges: () => pushMock() }));
vi.mock('./pull', () => ({
    pullChanges: () => pullMock(),
    initialHydration: vi.fn(),
    fullTableResync: (t: string) => resyncMock(t),
    discardLocalChanges: vi.fn(),
}));
vi.mock('./reconcile', () => ({ checkReconciliation: () => reconcileMock() }));
vi.mock('./queue', () => ({
    getPendingChangesCount: () => Promise.resolve(0),
    getFailedChanges: vi.fn(),
    resetFailedChange: vi.fn(),
}));

const okPush = { success: true, changesPushed: 0, changesFailed: 0, errors: [] };
const okPull = { success: true, tablesUpdated: 0, recordsProcessed: 0, errors: [] };
const cleanReconcile = { checked: true, mismatches: [], skipped: [] };
const HOUR = 60 * 60 * 1000;

// Fresh module per test: the cooldown and lock live in module state.
async function load() {
    vi.resetModules();
    return import('./index');
}

function becomeVisible() {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
}

// Lets the fire-and-forget syncs started by event handlers run to completion.
const settle = () => new Promise(r => setTimeout(r, 0));

describe('runSync reconciliation gate', () => {
    beforeEach(() => {
        meta.clear();
        vi.clearAllMocks();
        pushMock.mockResolvedValue(okPush);
        pullMock.mockResolvedValue(okPull);
        reconcileMock.mockResolvedValue(cleanReconcile);
    });

    it('reconciles when it has never run, then not again within the interval', async () => {
        const { runSync } = await load();
        await runSync();
        await runSync();
        expect(reconcileMock).toHaveBeenCalledTimes(1);
    });

    it('reconciles again once the interval has elapsed', async () => {
        meta.set('last_reconcile_at', new Date(Date.now() - HOUR - 1000).toISOString());
        const { runSync } = await load();
        await runSync();
        expect(reconcileMock).toHaveBeenCalledTimes(1);
    });

    it('forceReconcile bypasses the interval', async () => {
        meta.set('last_reconcile_at', new Date().toISOString());
        const { runSync } = await load();
        await runSync({ forceReconcile: true });
        expect(reconcileMock).toHaveBeenCalledTimes(1);
    });

    it('a stamp in the future (clock moved back) does not suppress reconciliation', async () => {
        meta.set('last_reconcile_at', new Date(Date.now() + HOUR).toISOString());
        const { runSync } = await load();
        await runSync();
        expect(reconcileMock).toHaveBeenCalledTimes(1);
    });

    it('stays due after a failed check or one that skipped tables', async () => {
        const { runSync } = await load();
        reconcileMock.mockResolvedValueOnce({ checked: false, mismatches: [], skipped: [], error: 'boom' });
        await runSync();
        reconcileMock.mockResolvedValueOnce({ checked: true, mismatches: [], skipped: ['transactions'] });
        await runSync();
        await runSync();
        expect(reconcileMock).toHaveBeenCalledTimes(3);
        expect(meta.has('last_reconcile_at')).toBe(true);
    });

    it('resyncs mismatched tables and starts the interval', async () => {
        reconcileMock.mockResolvedValueOnce({ checked: true, mismatches: ['transactions'], skipped: [] });
        const { runSync } = await load();
        await runSync();
        expect(resyncMock).toHaveBeenCalledWith('transactions');
        expect(meta.has('last_reconcile_at')).toBe(true);
    });
});

describe('resume (visibilitychange) cooldown', () => {
    let mod: Awaited<ReturnType<typeof load>>;

    beforeEach(async () => {
        meta.clear();
        vi.clearAllMocks();
        pushMock.mockResolvedValue(okPush);
        pullMock.mockResolvedValue(okPull);
        reconcileMock.mockResolvedValue(cleanReconcile);
        mod = await load();
        mod.startPeriodicSync();
    });

    afterEach(() => {
        mod.stopPeriodicSync();
        vi.useRealTimers();
    });

    it('only pushes when the last successful sync was moments ago', async () => {
        await mod.runSync();
        expect(pullMock).toHaveBeenCalledTimes(1);

        becomeVisible();
        await settle();
        expect(pullMock).toHaveBeenCalledTimes(1);
        expect(pushMock).toHaveBeenCalledTimes(2);
    });

    it('runs a full sync once the cooldown has passed', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        await mod.runSync();

        vi.setSystemTime(Date.now() + mod.RESUME_SYNC_COOLDOWN_MS + 1);
        becomeVisible();
        await settle();
        expect(pullMock).toHaveBeenCalledTimes(2);
    });

    it('runs a full sync if the previous one failed', async () => {
        pullMock.mockResolvedValueOnce({ ...okPull, success: false, errors: ['x'] });
        await mod.runSync();

        becomeVisible();
        await settle();
        expect(pullMock).toHaveBeenCalledTimes(2);
    });
});
