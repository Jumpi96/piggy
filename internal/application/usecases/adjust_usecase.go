package usecases

import (
	"fmt"
	"time"

	"piggy/internal/application/dto"
	"piggy/internal/domain/entities"
	"piggy/internal/domain/repositories"
	"piggy/internal/domain/services"
)

// AdjustUseCase handles currency rate adjustment operations
type AdjustUseCase struct {
	entryRepo     repositories.EntryRepository
	parameterRepo repositories.ParameterRepository
	configService services.ConfigService
}

// NewAdjustUseCase creates a new adjust use case
func NewAdjustUseCase(entryRepo repositories.EntryRepository, parameterRepo repositories.ParameterRepository, configService services.ConfigService) *AdjustUseCase {
	return &AdjustUseCase{
		entryRepo:     entryRepo,
		parameterRepo: parameterRepo,
		configService: configService,
	}
}

// AdjustCurrencyRates adjusts Toshl conversion rates for all entries in a given month
func (a *AdjustUseCase) AdjustCurrencyRates(request dto.AdjustRequest) (*dto.AdjustResponse, error) {
	// Get base currency from parameter store
	baseCurrencyParam, err := a.parameterRepo.Get("CURRENCY")
	if err != nil {
		return nil, fmt.Errorf("failed to get base currency: %w", err)
	}
	baseCurrency := baseCurrencyParam.StringValue
	if baseCurrency == "" {
		baseCurrency = "EUR" // fallback
	}

	// Get all entries for the specified month (using empty tags to get all entries)
	entries, err := a.entryRepo.GetByMonth(request.MonthYear, "")
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve entries: %w", err)
	}

	updatedCount := 0
	for _, entry := range entries {
		// Skip if entry is already in base currency
		if entry.Currency.Code == baseCurrency {
			continue
		}

		// Get the conversion rate from parameter store
		newRate, err := a.getConversionRate(entry.Currency.Code, baseCurrency)
		if err != nil {
			// Skip entries we can't convert
			continue
		}

		// Update the entry's currency rate if it's different
		if entry.Currency.Rate != newRate {
			updatedEntry := a.createUpdatedEntry(entry, newRate)
			if err := a.entryRepo.Update(updatedEntry); err != nil {
				return nil, fmt.Errorf("failed to update entry %s: %w", entry.ID, err)
			}
			updatedCount++
		}
	}

	return &dto.AdjustResponse{
		Period:       request.MonthYear.Format("2006-01"),
		UpdatedCount: updatedCount,
		BaseCurrency: baseCurrency,
		Message:      fmt.Sprintf("Updated %d entries with new conversion rates", updatedCount),
	}, nil
}

// getConversionRate gets the conversion rate from the parameter store
func (a *AdjustUseCase) getConversionRate(fromCurrency, baseCurrency string) (float64, error) {
	// Try direct conversion rate: FROM2BASE
	directRateKey := fmt.Sprintf("%s2%s", fromCurrency, baseCurrency)
	if param, err := a.parameterRepo.Get(directRateKey); err == nil {
		return param.Value, nil
	}

	// Try inverse conversion rate: BASE2FROM
	inverseRateKey := fmt.Sprintf("%s2%s", baseCurrency, fromCurrency)
	if param, err := a.parameterRepo.Get(inverseRateKey); err == nil {
		return 1.0 / param.Value, nil
	}

	return 0, fmt.Errorf("no conversion rate found between %s and %s", fromCurrency, baseCurrency)
}

// createUpdatedEntry creates a minimal entry with updated currency rate
func (a *AdjustUseCase) createUpdatedEntry(entry entities.Entry, newRate float64) entities.MinimalEntry {
	return entities.MinimalEntry{
		ID:       entry.ID,
		Amount:   entry.Amount,
		Currency: entities.Currency{
			Code:     entry.Currency.Code,
			Rate:     newRate,
			MainRate: newRate, // Set MainRate to same value
			Fixed:    false,
		},
		Date:      entry.Date,
		Account:   entry.Account,
		Category:  entry.Category,
		Tags:      entry.Tags,
		Modified:  time.Now().Format("2006-01-02T15:04:05Z"),
		Completed: entry.Completed,
	}
}