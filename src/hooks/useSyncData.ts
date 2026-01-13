import { useState, useEffect } from 'react';
import { subscribeSyncState, getSyncState, type SyncState } from '../lib/offline/sync';

export function useSyncData() {
    const [lastDataUpdate, setLastDataUpdate] = useState<number>(Date.now());

    useEffect(() => {
        // Initial state
        getSyncState().then(state => {
            setLastDataUpdate(state.lastDataUpdate);
        });

        // Subscribe to changes
        const unsubscribe = subscribeSyncState((state: SyncState) => {
            setLastDataUpdate(state.lastDataUpdate);
        });

        return () => {
            unsubscribe();
        };
    }, []);

    return lastDataUpdate;
}
