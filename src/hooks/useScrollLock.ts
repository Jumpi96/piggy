import { useEffect } from 'react';

/**
 * Stops the page behind a modal from scrolling while it is open. The app scrolls inside the
 * layout's <main>, not the document, so that is the element to lock. Restores the previous
 * value on close.
 */
export function useScrollLock(active: boolean = true): void {
    useEffect(() => {
        if (!active) return;
        const scroller = document.querySelector('main');
        if (!scroller) return;
        const previous = scroller.style.overflow;
        scroller.style.overflow = 'hidden';
        return () => {
            scroller.style.overflow = previous;
        };
    }, [active]);
}
