package usecases

import (
	"fmt"
	"time"

	"piggy/internal/application/dto"
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
	entries, err := s.entryRepo.GetByMonth(request.MonthYear, "")
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve entries: %w", err)
	}

	// Get balance tags from config
	balanceTags := s.configService.GetBalanceTags()

	// Calculate current date and remaining days
	currentLocation, _ := time.LoadLocation(s.configService.GetTimeZone())
	year, month, day := time.Now().In(currentLocation).Date()
	today := time.Date(year, month, day, 0, 0, 0, 0, currentLocation)
	
	remainingDays := s.calculateRemainingDays(request.MonthYear, today)
	daysModifier := s.getDaysModifier(request.MonthYear, today)

	var total, cash, balance float64

	// Process all entries
	for _, entry := range entries {
		entryDate, _ := time.ParseInLocation("2006-01-02", entry.Date, currentLocation)
		entryValue := s.convertToEUR(entry.Amount, entry.Currency.Code, request.UsdToArs, request.EurToUsd)

		total += entryValue

		// Add to cash if entry is in the past or today
		if entryDate.Before(today) || entryDate.Equal(today) {
			cash += entryValue
		}

		// Add to balance if entry has any balance tag
		if s.entryHasBalanceTags(entry.Tags, balanceTags) {
			balance -= entryValue
		}
	}

	response := &dto.StatusResponse{
		Period:           request.MonthYear.Format("2006-01"),
		Difference:       total,
		Cash:             cash,
		Balance:          balance,
		DayRemaining:     total / remainingDays,
		DayRemainingDiff: total - request.AmountPerDay*(remainingDays-daysModifier),
		DailyBreakdown:   s.calculateDailyBreakdown(request.MonthYear, total, today),
	}

	return response, nil
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

// convertToEUR converts an amount to EUR based on currency
func (s *StatusUseCase) convertToEUR(amount float64, currency string, usdToArs, eurToUsd float64) float64 {
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