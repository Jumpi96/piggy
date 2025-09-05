package usecases

import (
    "fmt"
    "strings"

    "piggy/internal/application/dto"
    "piggy/internal/domain/entities"
    "piggy/internal/domain/repositories"
    "piggy/internal/domain/services"
)

// CreditUseCase handles credit card related operations
type CreditUseCase struct {
	entryRepo     repositories.EntryRepository
	parameterRepo repositories.ParameterRepository
	configService services.ConfigService
}

// NewCreditUseCase creates a new credit use case
func NewCreditUseCase(entryRepo repositories.EntryRepository, parameterRepo repositories.ParameterRepository, configService services.ConfigService) *CreditUseCase {
	return &CreditUseCase{
		entryRepo:     entryRepo,
		parameterRepo: parameterRepo,
		configService: configService,
	}
}

// GetCreditStatus retrieves credit card status for a specific period
func (c *CreditUseCase) GetCreditStatus(request dto.CreditRequest) (*dto.CreditResponse, error) {
	// Get credit tags based on country code
	creditTags := c.configService.GetCreditTags(request.CountryCode)
	creditTagsStr := strings.Join(creditTags, ",")
	
	// Retrieve credit entries for the month
	entries, err := c.entryRepo.GetByMonth(request.MonthYear, creditTagsStr)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve credit entries: %w", err)
	}

	// Get base currency for display
    pBase, err := c.parameterRepo.Get("CURRENCY")
    var baseCurrencyCode string = "EUR" // default fallback
    if err == nil && pBase.StringValue != "" {
        baseCurrencyCode = services.GetCurrencyCode(pBase.StringValue)
    }

	// Calculate totals and prepare response
    response := &dto.CreditResponse{
        Period: request.MonthYear.Format("2006-01"),
        Items:  make([]dto.CreditItem, 0),
    }

    var totalBase float64
    eurToUsd := request.EurToUsd
    if eurToUsd == 0 {
        eurToUsd = 1.0
    }
    usdToArs := request.UsdToArs
    if usdToArs == 0 {
        usdToArs = 1.0
    }

    for _, entry := range entries {
        // Convert all to base currency, then flip sign so expenses display positive
        var baseAmount float64
        switch entry.Currency.Code {
        case "EUR":
            if baseCurrencyCode == "EUR" {
                baseAmount = entry.Amount
            } else {
                // Convert EUR to base currency (this would need additional rates)
                baseAmount = entry.Amount / eurToUsd
            }
        case "USD":
            if baseCurrencyCode == "USD" {
                baseAmount = entry.Amount
            } else {
                baseAmount = entry.Amount / eurToUsd
            }
        case "ARS":
            if baseCurrencyCode == "ARS" {
                baseAmount = entry.Amount
            } else {
                baseAmount = entry.Amount / (usdToArs * eurToUsd)
            }
        default:
            baseAmount = entry.Amount / eurToUsd
        }

        displayAmount := -baseAmount
        totalBase += displayAmount

        response.Items = append(response.Items, dto.CreditItem{
            Description: fmt.Sprintf("%s %s", entry.Category, entry.Desc),
            Amount:      displayAmount,
            Currency:    baseCurrencyCode,
        })
    }

    response.Total = totalBase
    return response, nil
}

// PayCredit marks credit entries as paid
func (c *CreditUseCase) PayCredit(request dto.CreditRequest) error {
	creditTags := c.configService.GetCreditTags(request.CountryCode)
	creditTagsStr := strings.Join(creditTags, ",")
	
	entries, err := c.entryRepo.GetByMonth(request.MonthYear, creditTagsStr)
	if err != nil {
		return fmt.Errorf("failed to retrieve credit entries: %w", err)
	}

	// Mark each entry as paid
	for _, entry := range entries {
		minimalEntry := c.convertToPaymentEntry(entry, creditTags, request.UsdToArs)
		if err := c.entryRepo.Update(minimalEntry); err != nil {
			return fmt.Errorf("failed to mark entry %s as paid: %w", entry.ID, err)
		}
	}

	return nil
}

// convertToPaymentEntry converts an entry to a paid entry
func (c *CreditUseCase) convertToPaymentEntry(entry entities.Entry, creditTags []string, usdToArs float64) entities.MinimalEntry {
	minimalEntry := entities.MinimalEntry{
		ID:        entry.ID,
		Date:      entry.Date,
		Account:   entry.Account,
		Category:  entry.Category,
		Modified:  entry.Modified,
		Completed: true,
	}

	// Remove credit tags from entry tags
	var newTags []string
	for _, tag := range entry.Tags {
		isCreditTag := false
		for _, creditTag := range creditTags {
			if tag == creditTag {
				isCreditTag = true
				break
			}
		}
		if !isCreditTag {
			newTags = append(newTags, tag)
		}
	}
	minimalEntry.Tags = newTags

	// Convert currency if needed
	if entry.Currency.Code == "USD" {
		minimalEntry.Currency = entities.Currency{
			Code:     "ARS",
			Rate:     1.0,
			MainRate: 1.0,
			Fixed:    false,
		}
		minimalEntry.Amount = entry.Amount * usdToArs
	} else {
		minimalEntry.Currency = entry.Currency
		minimalEntry.Amount = entry.Amount
	}

	return minimalEntry
}
