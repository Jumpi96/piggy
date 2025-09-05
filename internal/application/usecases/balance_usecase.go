package usecases

import (
    "fmt"
    "time"

    "piggy/internal/application/dto"
    "piggy/internal/domain/entities"
    "piggy/internal/domain/repositories"
    "piggy/internal/domain/services"
)

// BalanceUseCase handles balance operations
type BalanceUseCase struct {
    entryRepo     repositories.EntryRepository
    parameterRepo repositories.ParameterRepository
    configService services.ConfigService
}

// NewBalanceUseCase creates a new balance use case
func NewBalanceUseCase(entryRepo repositories.EntryRepository, parameterRepo repositories.ParameterRepository, configService services.ConfigService) *BalanceUseCase {
	return &BalanceUseCase{
		entryRepo:     entryRepo,
		parameterRepo: parameterRepo,
		configService: configService,
	}
}

// GetBalanceReport generates a balance report for a date range
func (b *BalanceUseCase) GetBalanceReport(request dto.BalanceRequest) (*dto.BalanceResponse, error) {
    // Resolve parameters
    amountPerDay, err := b.resolveAmountPerDay(request)
    if err != nil {
        return nil, err
    }

    // Load entries for range
    entries, err := b.entryRepo.GetFromTo(request.FromDate, request.ToDate, "")
    if err != nil {
        return nil, fmt.Errorf("failed to retrieve entries: %w", err)
    }

    // Determine base currency
    pBase, err := b.parameterRepo.Get("CURRENCY")
    if err != nil || pBase.StringValue == "" {
        return nil, fmt.Errorf("base currency not configured. Use /set CURRENCY <CODE>")
    }
    base := pBase.StringValue

    // Compute totals and monthly sums in base
    usedRates := make(map[string]float64)
    total, monthly, err := b.computeMonthlyTotalsBase(entries, base, usedRates)
    if err != nil {
        return nil, err
    }

    // Adjust per-month by expected spending within range
    adjusted := b.adjustMonthlyBreakdown(monthly, request.FromDate, request.ToDate, amountPerDay)

    // Remaining days in the whole range (inclusive)
    remainingDays := float64(b.daysInclusive(request.FromDate, request.ToDate))

    // Build response
    resp := &dto.BalanceResponse{
        FromDate:         request.FromDate.Format("2006-01-02"),
        ToDate:           request.ToDate.Format("2006-01-02"),
        Difference:       total,
        DayRemainingDiff: total - amountPerDay*remainingDays,
        MonthlyBreakdown: adjusted,
        UsedAmountPerDay: amountPerDay,
        UsedBase:         base,
        UsedRates:        usedRates,
    }

    return resp, nil
}

// resolveAmountPerDay fetches ApD if not provided
func (b *BalanceUseCase) resolveAmountPerDay(request dto.BalanceRequest) (amountPerDay float64, err error) {
    amountPerDay = request.AmountPerDay
    if amountPerDay == 0 {
        var p *entities.Parameter
        p, err = b.parameterRepo.Get("ApD")
        if err != nil {
            return 0, fmt.Errorf("amount per day not configured. Use /set ApD <amount>")
        }
        amountPerDay = p.Value
    }
    return amountPerDay, nil
}

// computeMonthlyTotals returns total EUR and a map of YYYY-MM to monthly totals
func (b *BalanceUseCase) computeMonthlyTotalsBase(entries []entities.Entry, base string, usedRates map[string]float64) (total float64, monthly map[string]float64, err error) {
    monthly = make(map[string]float64)
    for _, entry := range entries {
        v, errConv := b.convertToBase(entry.Amount, entry.Currency.Code, base, usedRates)
        if errConv != nil {
            return 0, nil, errConv
        }
        total += v
        if entry.Date != "" {
            if t, err := time.Parse("2006-01-02", entry.Date); err == nil {
                key := t.Format("2006-01")
                monthly[key] += v
            }
        }
    }
    return total, monthly, nil
}

// adjustMonthlyBreakdown subtracts expected spending per day within each month slice
func (b *BalanceUseCase) adjustMonthlyBreakdown(monthly map[string]float64, from, to time.Time, amountPerDay float64) map[string]float64 {
    adjusted := make(map[string]float64, len(monthly))
    loc := from.Location()
    for monthKey, sum := range monthly {
        t, err := time.Parse("2006-01", monthKey)
        if err != nil {
            adjusted[monthKey] = sum
            continue
        }
        monthStart := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, loc)
        monthEnd := time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, loc)
        // clamp
        start := monthStart
        if from.After(start) { start = from }
        end := monthEnd
        if to.Before(end) { end = to }
        days := 0
        if !end.Before(start) { days = b.daysInclusive(start, end) }
        adjusted[monthKey] = sum - amountPerDay*float64(days)
    }
    return adjusted
}

// daysInclusive returns number of days including both end points
func (b *BalanceUseCase) daysInclusive(from, to time.Time) int {
    return int(to.Sub(from).Hours()/24) + 1
}

// convertToBase converts an amount in given code to configured base using stored rate BASE2CODE
func (b *BalanceUseCase) convertToBase(amount float64, code, base string, usedRates map[string]float64) (float64, error) {
    if code == base {
        return amount, nil
    }
    rateKey := fmt.Sprintf("%s2%s", base, code)
    p, err := b.parameterRepo.Get(rateKey)
    if err != nil {
        return 0, fmt.Errorf("missing rate %s. Use /set %s <value>", rateKey, rateKey)
    }
    usedRates[rateKey] = p.Value
    return amount * p.Value, nil
}

// convertToEUR converts an amount to EUR based on currency
func (b *BalanceUseCase) convertToEUR(amount float64, currency string, usdToArs, eurToUsd float64) float64 {
	switch currency {
	case "EUR":
		return amount
	case "ARS":
		return amount / (usdToArs * eurToUsd)
	case "USD":
		return amount / eurToUsd
	default:
		return amount / eurToUsd
	}
}
