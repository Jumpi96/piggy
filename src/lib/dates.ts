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
    // Logic: 
    // If transaction day < closing_day 
    //   -> effective date = payment_day of next month
    // Else 
    //   -> effective date = payment_day of month + 2

    const tDay = transactionDate.getDate();

    // Create start of next month
    let targetMonth = new Date(transactionDate.getFullYear(), transactionDate.getMonth() + 1, 1);

    if (tDay < closingDay) {
        // Next month
    } else {
        // Month + 2
        targetMonth.setMonth(targetMonth.getMonth() + 1);
    }

    return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), paymentDay);
}
