/**
 * Formats a Date object to YYYY-MM-DD in local time.
 */
export function formatLocalDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Formats a Date object to YYYY-MM in local time.
 */
export function formatLocalMonth(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * Parses YYYY-MM-DD string into a local Date object (midnight).
 */
export function parseLocalDate(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

/**
 * Returns today's date formatted as YYYY-MM-DD in local time.
 */
export function getTodayLocalDate(): string {
    return formatLocalDate(new Date());
}

/**
 * Adds `months` to a date, clamping the day-of-month to the last valid day of the
 * target month.
 *
 * Unlike `Date.prototype.setMonth` — which rolls e.g. Jan 31 + 1 month over into
 * early March, and drifts further on every subsequent step — this keeps a monthly
 * occurrence anchored to its intended day: Jan 31 + 1 => Feb 28/29, + 2 => Mar 31.
 * Because the result depends only on (anchor, months) and never on how many
 * intermediate steps were taken, occurrence dates are stable and independent of the
 * window you iterate over. Handles negative `months` too.
 */
export function addMonthsClamped(date: Date, months: number): Date {
    const monthIndex = date.getMonth() + months;
    const targetYear = date.getFullYear() + Math.floor(monthIndex / 12);
    const targetMonth = ((monthIndex % 12) + 12) % 12;
    const daysInTarget = new Date(targetYear, targetMonth + 1, 0).getDate();
    const day = Math.min(date.getDate(), daysInTarget);
    return new Date(targetYear, targetMonth, day);
}

// ============================================================================
// Financial period (custom month start day)
// ============================================================================
//
// A "financial period" is a month-length window that can start on an arbitrary
// day-of-month (the `month_start_day` setting) instead of the 1st. A period is
// identified by an *anchor* — the YYYY-MM of the calendar month it STARTS in —
// which is unique and contiguous, so it is safe to use as a navigation/storage
// key. When the start day is 1 (the default) every helper below collapses to
// plain calendar-month behaviour.
//
// The start day lives in the `parameters` table (synced across devices) but is
// mirrored into localStorage so these synchronous helpers can read it.

export const MONTH_START_DAY_KEY = 'month_start_day';

/** Reads the configured financial-month start day (1–28). Defaults to 1. */
export function getMonthStartDay(): number {
    try {
        const raw = localStorage.getItem(MONTH_START_DAY_KEY);
        if (raw) {
            const day = parseInt(raw, 10);
            if (!isNaN(day)) return Math.min(28, Math.max(1, day));
        }
    } catch {
        // localStorage unavailable — fall through to the default
    }
    return 1;
}

/** Mirrors the start day into localStorage. Pass null to clear (reset to default). */
export function cacheMonthStartDay(day: number | null | undefined): void {
    try {
        if (day == null) {
            localStorage.removeItem(MONTH_START_DAY_KEY);
            return;
        }
        const clamped = Math.min(28, Math.max(1, Math.floor(day)));
        localStorage.setItem(MONTH_START_DAY_KEY, String(clamped));
    } catch {
        // localStorage unavailable — no-op
    }
}

/**
 * Half-open date range [start, end) for the period anchored to `anchor`.
 * `anchor` may be YYYY-MM or YYYY-MM-DD (only year+month are used).
 * With start day D the period runs from D of the anchor month to D of the
 * next month (exclusive). D is capped at 28 so the range is always valid.
 */
export function getPeriodRange(anchor: string): { start: string; end: string } {
    const [year, month] = anchor.split('-').map(Number); // month is 1-indexed
    const day = getMonthStartDay();
    const start = new Date(year, month - 1, day);
    const end = new Date(year, month, day); // day D of the following month
    return { start: formatLocalDate(start), end: formatLocalDate(end) };
}

/**
 * Returns the anchor (YYYY-MM) of the period a given YYYY-MM-DD date falls in.
 * A date on/after the start day belongs to its own calendar month's period;
 * a date before the start day belongs to the previous month's period.
 */
export function getPeriodForDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-').map(Number); // month is 1-indexed
    const startDay = getMonthStartDay();
    let anchorYear = year;
    let anchorMonth = month;
    if (day < startDay) {
        anchorMonth -= 1;
        if (anchorMonth < 1) {
            anchorMonth = 12;
            anchorYear -= 1;
        }
    }
    return `${anchorYear}-${String(anchorMonth).padStart(2, '0')}`;
}

/** The anchor Date (pinned to the 1st of the anchor month) for today's period. */
export function getCurrentPeriodAnchor(): Date {
    const anchor = getPeriodForDate(getTodayLocalDate());
    const [year, month] = anchor.split('-').map(Number);
    return new Date(year, month - 1, 1);
}

/**
 * Human label for a period: the calendar month holding the MAJORITY of the
 * period's days, defaulting to the END month on a tie (~50/50). Display only —
 * labels are not guaranteed unique across periods, so never key state on them.
 */
/**
 * The calendar month (YYYY-MM) a period is labelled by: the month holding the MAJORITY
 * of the period's days, defaulting to the END month on a tie. For a start day of 1 this
 * is just the anchor. This is the single source of truth for both the display label and
 * the filter, so they never disagree.
 */
export function getPeriodLabelMonth(anchor: string): string {
    const [year, month] = anchor.split('-').map(Number); // month is 1-indexed
    const startDay = getMonthStartDay();
    const daysInStartMonth = new Date(year, month, 0).getDate(); // last day of the month
    const daysFromStartMonth = daysInStartMonth - startDay + 1;
    const daysInEndMonth = startDay - 1;

    let labelYear = year;
    let labelMonth = month;
    if (daysFromStartMonth <= daysInEndMonth) {
        // Tie or end-month majority → use the end month.
        labelMonth += 1;
        if (labelMonth > 12) {
            labelMonth = 1;
            labelYear += 1;
        }
    }
    return `${labelYear}-${String(labelMonth).padStart(2, '0')}`;
}

export function getPeriodLabel(anchor: string): string {
    const [y, m] = getPeriodLabelMonth(anchor).split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
        .format(new Date(y, m - 1, 1));
}

function shiftMonth(ym: string, delta: number): string {
    let [y, m] = ym.split('-').map(Number);
    m += delta;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Inverse of {@link getPeriodLabelMonth}: given a label month (what the user sees and
 * picks in the filter), return the period anchor it names. A period labelled month L is
 * anchored in L, L-1 or L+1 depending on the start day, so we search those candidates.
 */
export function anchorFromPeriodLabelMonth(labelMonth: string): string {
    for (const candidate of [shiftMonth(labelMonth, -1), labelMonth, shiftMonth(labelMonth, 1)]) {
        if (getPeriodLabelMonth(candidate) === labelMonth) return candidate;
    }
    return labelMonth;
}

/** Short inclusive date-range label for a period, e.g. "Feb 15 – Mar 14". */
export function formatPeriodRangeLabel(anchor: string): string {
    const { start, end } = getPeriodRange(anchor);
    const startDate = parseLocalDate(start);
    const endExclusive = parseLocalDate(end);
    const endInclusive = new Date(
        endExclusive.getFullYear(),
        endExclusive.getMonth(),
        endExclusive.getDate() - 1
    );
    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
    return `${fmt.format(startDate)} – ${fmt.format(endInclusive)}`;
}

export function calculateCreditCardEffectiveDate(
    transactionDate: Date,
    closingDay: number,
    paymentDay: number
): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tDate = new Date(transactionDate);
    tDate.setHours(0, 0, 0, 0);

    // If transaction date is in the future and is already a payment day, keep it
    if (tDate > today && tDate.getDate() === paymentDay) {
        return tDate;
    }

    // Otherwise, calculate the next payment day from the transaction date
    const tDay = tDate.getDate();
    let targetMonth = new Date(tDate.getFullYear(), tDate.getMonth() + 1, 1);

    if (tDay < closingDay) {
        // Next month
    } else {
        // Month + 2
        targetMonth.setMonth(targetMonth.getMonth() + 1);
    }

    const nextPaymentDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), paymentDay);

    // If today is a payment day, move to the next payment day
    if (today.getDate() === paymentDay && nextPaymentDate.getTime() === today.getTime()) {
        targetMonth.setMonth(targetMonth.getMonth() + 1);
        return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), paymentDay);
    }

    return nextPaymentDate;
}

/**
 * Decides whether a credit-card transaction's effective date should be (re)derived
 * from the entered date via {@link calculateCreditCardEffectiveDate}.
 *
 * That function is NOT idempotent — applying it to an already-shifted stored date
 * marches the transaction forward a month on every save (and compounds), because it
 * keys off today's date. So on edit we only recompute when the user actually entered
 * a new raw purchase date, or (re)assigned the card. Editing any other field (note,
 * amount, category…) preserves the stored effective date.
 */
export function shouldDeriveCardEffectiveDate(params: {
    isNew: boolean;
    enteredDate: string;
    storedDate?: string | null;
    storedMethod?: string | null;
    storedCardId?: string | null;
    cardId: string;
}): boolean {
    const { isNew, enteredDate, storedDate, storedMethod, storedCardId, cardId } = params;
    if (isNew) return true;
    if (enteredDate !== storedDate) return true;
    const wasSameCard = storedMethod === 'card' && (storedCardId || '') === cardId;
    return !wasSameCard;
}

export function getPersistentMonth(): Date {
    const saved = localStorage.getItem('selected_month');
    if (saved) {
        const [year, month] = saved.split('-').map(Number);
        const d = new Date(year, month - 1, 1);
        if (!isNaN(d.getTime())) return d;
    }
    return getCurrentPeriodAnchor();
}

export function setPersistentMonth(d: Date): void {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    localStorage.setItem('selected_month', `${year}-${month}`);
}
