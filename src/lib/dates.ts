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
