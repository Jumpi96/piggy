package usecases

import (
	"fmt"
	"time"

	"piggy/internal/domain/entities"
	"piggy/internal/domain/repositories"
	"piggy/internal/domain/services"
)

// ParameterUseCase handles parameter operations
type ParameterUseCase struct {
	entryRepo     repositories.EntryRepository
	parameterRepo repositories.ParameterRepository
	configService services.ConfigService
}

// NewParameterUseCase creates a new parameter use case
func NewParameterUseCase(entryRepo repositories.EntryRepository, parameterRepo repositories.ParameterRepository, configService services.ConfigService) *ParameterUseCase {
	return &ParameterUseCase{
		entryRepo:     entryRepo,
		parameterRepo: parameterRepo,
		configService: configService,
	}
}

// SetCurrencies updates currency rates for entries in a specific month
func (p *ParameterUseCase) SetCurrencies(monthYear time.Time, usdToArs, eurToUsd float64) (int, error) {
	entries, err := p.entryRepo.GetByMonth(monthYear, "")
	if err != nil {
		return 0, fmt.Errorf("failed to retrieve entries: %w", err)
	}

	var updateCount int

	for _, entry := range entries {
		if entry.Currency.Code == "ARS" {
			minimalEntry := entities.MinimalEntry{
				ID:        entry.ID,
				Date:      entry.Date,
				Account:   entry.Account,
				Category:  entry.Category,
				Modified:  entry.Modified,
				Amount:    entry.Amount,
				Tags:      entry.Tags,
				Completed: entry.Completed,
				Currency: entities.Currency{
					Code:     entry.Currency.Code,
					Rate:     usdToArs * eurToUsd,
					MainRate: entry.Currency.MainRate,
					Fixed:    true,
				},
			}

			if err := p.entryRepo.Update(minimalEntry); err != nil {
				return updateCount, fmt.Errorf("failed to update entry %s: %w", entry.ID, err)
			}
			updateCount++
		}
	}

	return updateCount, nil
}

// SetParameter stores a parameter value
func (p *ParameterUseCase) SetParameter(key string, value float64) error {
	parameter := entities.NewParameter(key, value)
	return p.parameterRepo.Set(parameter)
}

// GetParameter retrieves a parameter value
func (p *ParameterUseCase) GetParameter(key string) (*entities.Parameter, error) {
	return p.parameterRepo.Get(key)
}