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

    const tDate = new Date(transactionDate);
    const tDay = tDate.getDate();

    // Create start of next month
    let targetMonth = new Date(tDate.getFullYear(), tDate.getMonth() + 1, 1);

    if (tDay < closingDay) {
        // Next month
    } else {
        // Month + 2
        targetMonth.setMonth(targetMonth.getMonth() + 1);
    }

    // Set to payment day
    // Handle edge cases where paymentDay doesn't exist in that month (e.g. 31st) - though cards usually have valid dates.
    // JS Date autocompletes 31st Feb to March X. This might be desired or not.
    // Standard CC logic usually implies rigid cycles.
    // The spec says: effective date = payment_day of [next month | month+2]

    // Let's set the date to existing month, then set date.
    // If we overflow, we overflow. But for "accounting month" it might be safer to clamp?
    // Spec doesn't specify clamping for CC dates, only for recurring.
    // Assuming standard valid payment days (1-28 usually).

    const effectiveDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), paymentDay);

    return effectiveDate;
}
