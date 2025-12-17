package usecases

import (
    "fmt"
    "time"

    "piggy/internal/application/dto"
    "piggy/internal/domain/entities"
    "piggy/internal/domain/repositories"
    "piggy/internal/domain/services"
)

// StatusUseCase handles monthly status operations
type StatusUseCase struct {
    entryRepo     repositories.EntryRepository
    parameterRepo repositories.ParameterRepository
    configService services.ConfigService
}

// NewStatusUseCase creates a new status use case
func NewStatusUseCase(entryRepo repositories.EntryRepository, parameterRepo repositories.ParameterRepository, configService services.ConfigService) *StatusUseCase {
    return &StatusUseCase{
        entryRepo:     entryRepo,
        parameterRepo: parameterRepo,
        configService: configService,
    }
}

// GetMonthlyStatus generates a comprehensive monthly status report
func (s *StatusUseCase) GetMonthlyStatus(request dto.StatusRequest) (*dto.StatusResponse, error) {
    amountPerDay, err := s.resolveAmountPerDay(request)
    if err != nil {
        return nil, err
    }

    entries, err := s.entryRepo.GetByMonth(request.MonthYear, "")
    if err != nil {
        return nil, fmt.Errorf("failed to retrieve entries: %w", err)
    }

    balanceTags := s.configService.GetBalanceTags()
    loc, _ := time.LoadLocation(s.configService.GetTimeZone())
    year, month, day := time.Now().In(loc).Date()
    today := time.Date(year, month, day, 0, 0, 0, 0, loc)

    // Determine base currency
    pBase, err := s.parameterRepo.Get("CURRENCY")
    if err != nil || pBase.StringValue == "" {
        return nil, fmt.Errorf("base currency not configured. Use /set CURRENCY <CODE>")
    }
    base := pBase.StringValue

    // Convert and aggregate
    usedRates := make(map[string]float64)
    total, cash, balance, err := s.accumulateMonthlyBase(entries, balanceTags, today, loc, base, usedRates)
    if err != nil {
        return nil, err
    }

    remainingDays := s.calculateRemainingDays(request.MonthYear, today)
    daysModifier := s.getDaysModifier(request.MonthYear, today)

    resp := &dto.StatusResponse{
        Period:           request.MonthYear.Format("2006-01"),
        Difference:       total,
        Cash:             cash,
        Balance:          balance,
        DayRemaining:     total / remainingDays,
        DayRemainingDiff: total - amountPerDay*(remainingDays-daysModifier),
        DailyBreakdown:   s.calculateDailyBreakdown(request.MonthYear, total, today),
        UsedAmountPerDay: amountPerDay,
        UsedBase:         base,
        UsedRates:        usedRates,
    }

    return resp, nil
}

// resolveAmountPerDay returns ApD, fetching when not provided
func (s *StatusUseCase) resolveAmountPerDay(request dto.StatusRequest) (float64, error) {
    amountPerDay := request.AmountPerDay
    if amountPerDay == 0 {
        p, err := s.parameterRepo.Get("ApD")
        if err != nil {
            return 0, fmt.Errorf("amount per day not configured. Use /set ApD <amount>")
        }
        amountPerDay = p.Value
    }
    return amountPerDay, nil
}

// accumulateMonthly converts and aggregates totals, cash and balance
func (s *StatusUseCase) accumulateMonthlyBase(entries []entities.Entry, balanceTags []string, today time.Time, loc *time.Location, base string, usedRates map[string]float64) (total, cash, balance float64, err error) {
    for _, entry := range entries {
        entryDate, _ := time.ParseInLocation("2006-01-02", entry.Date, loc)
        amountInBase, errConv := s.convertToBase(entry.Amount, entry.Currency.Code, base, usedRates)
        if errConv != nil {
            return 0, 0, 0, errConv
        }

        total += amountInBase
        if entryDate.Before(today) || entryDate.Equal(today) {
            cash += amountInBase
        }
        if s.entryHasBalanceTags(entry.Tags, balanceTags) {
            balance -= amountInBase
        }
    }
    return total, cash, balance, nil
}

func (s *StatusUseCase) convertToBase(amount float64, code, base string, usedRates map[string]float64) (float64, error) {
    if code == base {
        return amount, nil
    }
    
    // First try direct rate: CODE2BASE
    directRateKey := fmt.Sprintf("%s2%s", code, base)
    p, err := s.parameterRepo.Get(directRateKey)
    if err == nil {
        // Found direct rate, use it: amount * rate
        usedRates[directRateKey] = p.Value
        return amount * p.Value, nil
    }
    
    // Try inverse rate: BASE2CODE
    inverseRateKey := fmt.Sprintf("%s2%s", base, code)
    p, err = s.parameterRepo.Get(inverseRateKey)
    if err == nil {
        // Found inverse rate, use 1/rate: amount / rate
        usedRates[inverseRateKey] = p.Value
        return amount / p.Value, nil
    }
    
    // Neither rate found
    return 0, fmt.Errorf("missing rate %s or %s. Use /set %s <value>", directRateKey, inverseRateKey, directRateKey)
}

// entryHasBalanceTags checks if entry has any of the balance tags
func (s *StatusUseCase) entryHasBalanceTags(entryTags, balanceTags []string) bool {
	for _, entryTag := range entryTags {
		for _, balanceTag := range balanceTags {
			if entryTag == balanceTag {
				return true
			}
		}
	}
	return false
}

// (old convertToEUR removed; using base-agnostic conversion now)

// calculateRemainingDays calculates remaining days in the month
func (s *StatusUseCase) calculateRemainingDays(monthYear, today time.Time) float64 {
	daysInMonth := s.getDaysInMonth(monthYear)

	if s.isFutureMonth(monthYear, today) {
		return float64(daysInMonth)
	} else if s.isCurrentMonth(monthYear, today) {
		return float64(daysInMonth - today.Day() + 1)
	}
	return 1
}

// calculateDailyBreakdown calculates daily spending breakdown
func (s *StatusUseCase) calculateDailyBreakdown(monthYear time.Time, total float64, today time.Time) map[int]float64 {
	breakdown := make(map[int]float64)
	
	var dayStart int
	if s.isCurrentMonth(monthYear, today) {
		dayStart = today.Day()
	} else {
		dayStart = 1
	}

	daysInMonth := s.getDaysInMonth(monthYear)
	for i := dayStart; i <= daysInMonth; i++ {
		breakdown[i] = total / float64(daysInMonth-i+1)
	}

	return breakdown
}

// Helper methods
func (s *StatusUseCase) getDaysInMonth(monthYear time.Time) int {
	t := time.Date(monthYear.Year(), monthYear.Month()+1, 0, 0, 0, 0, 0, time.UTC)
	return t.Day()
}

func (s *StatusUseCase) isFutureMonth(monthYear, now time.Time) bool {
	return monthYear.Year() > now.Year() ||
		(monthYear.Year() == now.Year() && monthYear.Month() > now.Month())
}

func (s *StatusUseCase) isCurrentMonth(monthYear, today time.Time) bool {
	return monthYear.Month() == today.Month() && monthYear.Year() == today.Year()
}

func (s *StatusUseCase) getDaysModifier(monthYear, today time.Time) float64 {
	if s.isCurrentMonth(monthYear, today) {
		return 1.0
	}
	return 0.0
}
