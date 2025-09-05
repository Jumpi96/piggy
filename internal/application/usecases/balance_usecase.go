package usecases

import (
    "fmt"
    "time"

    "piggy/internal/application/dto"
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
    entries, err := b.entryRepo.GetFromTo(request.FromDate, request.ToDate, "")
    if err != nil {
        return nil, fmt.Errorf("failed to retrieve entries: %w", err)
    }

    var total float64
    monthly := make(map[string]float64)
    remainingDays := float64(int(request.ToDate.Sub(request.FromDate).Hours()/24) + 1)

    // Process all entries and convert to EUR
    for _, entry := range entries {
        entryValue := b.convertToEUR(entry.Amount, entry.Currency.Code, request.UsdToArs, request.EurToUsd)
        total += entryValue

        // Group by month YYYY-MM
        if entry.Date != "" {
            if t, err := time.Parse("2006-01-02", entry.Date); err == nil {
                key := t.Format("2006-01")
                monthly[key] += entryValue
            }
        }
    }

    // Adjust monthly breakdown by subtracting expected spending per month
    adjusted := make(map[string]float64, len(monthly))
    loc := request.FromDate.Location()
    for monthKey, sum := range monthly {
        // Parse monthKey (YYYY-MM)
        t, err := time.Parse("2006-01", monthKey)
        if err != nil {
            // If parsing fails, keep raw sum
            adjusted[monthKey] = sum
            continue
        }
        monthStart := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, loc)
        monthEnd := time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, loc)

        // Clamp to requested range
        start := monthStart
        if request.FromDate.After(start) {
            start = request.FromDate
        }
        end := monthEnd
        if request.ToDate.Before(end) {
            end = request.ToDate
        }
        days := 0
        if !end.Before(start) {
            days = int(end.Sub(start).Hours()/24) + 1
        }
        adjusted[monthKey] = sum - request.AmountPerDay*float64(days)
    }

    response := &dto.BalanceResponse{
        FromDate:         request.FromDate.Format("2006-01-02"),
        ToDate:           request.ToDate.Format("2006-01-02"),
        Difference:       total,
        DayRemainingDiff: total - request.AmountPerDay*remainingDays,
        MonthlyBreakdown: adjusted,
    }

    return response, nil
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
