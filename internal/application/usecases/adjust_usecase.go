package usecases

import (
	"fmt"
	"sync"
	"sync/atomic"

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

	rateCache := make(map[string]float64)
	toUpdate := make([]entities.MinimalEntry, 0, len(entries))

	for _, entry := range entries {
		// Skip if entry is already in base currency
		if entry.Currency.Code == baseCurrency {
			continue
		}

		// Get the conversion rate from cache or parameter store
		newRate, err := func(currency string) (float64, error) {
			if rate, ok := rateCache[currency]; ok {
				return rate, nil
			}

			rate, getErr := a.getConversionRate(currency, baseCurrency)
			if getErr != nil {
				return 0, getErr
			}
			rateCache[currency] = rate
			return rate, nil
		}(entry.Currency.Code)
		if err != nil {
			// Skip entries we can't convert
			continue
		}

		// Update the entry's currency rate if it's different
		if entry.Currency.Rate != newRate {
			toUpdate = append(toUpdate, a.createUpdatedEntry(entry, newRate))
		}
	}

	const maxParallelUpdates = 5
	sem := make(chan struct{}, maxParallelUpdates)

	var (
		wg        sync.WaitGroup
		errMu     sync.Mutex
		firstErr  error
		updateSum int64
	)

	for _, entry := range toUpdate {
		wg.Add(1)
		sem <- struct{}{}

		go func(e entities.MinimalEntry) {
			defer wg.Done()
			defer func() { <-sem }()

			if err := a.entryRepo.Update(e); err != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = fmt.Errorf("failed to update entry %s: %w", e.ID, err)
				}
				errMu.Unlock()
				return
			}

			atomic.AddInt64(&updateSum, 1)
		}(entry)
	}

	wg.Wait()

	if firstErr != nil {
		return nil, firstErr
	}

	updatedCount := int(updateSum)

	return &dto.AdjustResponse{
		Period:       request.MonthYear.Format("2006-01"),
		UpdatedCount: updatedCount,
		BaseCurrency: baseCurrency,
		Message:      fmt.Sprintf("Updated %d entries with new conversion rates", updatedCount),
	}, nil
}

// getConversionRate gets the conversion rate from the parameter store
// Returns the rate FROM base currency TO entry currency (for Toshl Rate field)
func (a *AdjustUseCase) getConversionRate(fromCurrency, baseCurrency string) (float64, error) {
	// Try direct conversion rate: BASE2FROM (e.g., EUR2ARS = 1598.69)
	directRateKey := fmt.Sprintf("%s2%s", baseCurrency, fromCurrency)
	if param, err := a.parameterRepo.Get(directRateKey); err == nil {
		return param.Value, nil // Use the EUR2ARS rate directly
	}

	// Try inverse conversion rate: FROM2BASE (e.g., ARS2EUR = 0.000626)
	// If we have ARS2EUR, we need EUR2ARS = 1/ARS2EUR
	inverseRateKey := fmt.Sprintf("%s2%s", fromCurrency, baseCurrency)
	if param, err := a.parameterRepo.Get(inverseRateKey); err == nil {
		return 1.0 / param.Value, nil
	}

	return 0, fmt.Errorf("no conversion rate found between %s and %s", fromCurrency, baseCurrency)
}

// createUpdatedEntry creates a minimal entry with updated currency rate
func (a *AdjustUseCase) createUpdatedEntry(entry entities.Entry, newRate float64) entities.MinimalEntry {
	return entities.MinimalEntry{
		ID:     entry.ID,
		Amount: entry.Amount,
		Currency: entities.Currency{
			Code:     entry.Currency.Code,
			Rate:     newRate,
			MainRate: entry.Currency.MainRate, // Keep original MainRate
			Fixed:    true,                    // Set to true to force Toshl to use our rate
		},
		Date:      entry.Date,
		Account:   entry.Account,
		Category:  entry.Category,
		Tags:      entry.Tags,
		Modified:  entry.Modified, // Keep original modified timestamp
		Completed: entry.Completed,
	}
}
