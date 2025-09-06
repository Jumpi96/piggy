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
	// Get credit tags directly from parameter store
	creditTags, err := c.parameterRepo.GetCreditCardTags(request.CountryCode)
	if err != nil {
		return nil, fmt.Errorf("failed to get credit card tags: %w", err)
	}
	creditTagsStr := strings.Join(creditTags, ",")
	
	// Retrieve credit entries for the month
	entries, err := c.entryRepo.GetByMonth(request.MonthYear, creditTagsStr)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve credit entries: %w", err)
	}

	// Get credit card currencies configuration
	currencies, err := c.getCreditCardCurrencies(request.CountryCode)
	if err != nil {
		return nil, fmt.Errorf("failed to get credit card currencies: %w", err)
	}

	// If no currencies configured, default to EUR for backwards compatibility
	if len(currencies) == 0 {
		currencies = []string{"EUR"}
	}

	// Initialize currency totals
	currencyTotals := make(map[string]float64)
	for _, currency := range currencies {
		currencyTotals[currency] = 0.0
	}

	// Process entries and calculate totals
	response := &dto.CreditResponse{
		Period: request.MonthYear.Format("2006-01"),
		Items:  make([]dto.CreditItem, 0),
	}

	for _, entry := range entries {
		targetCurrency := c.findTargetCurrency(entry.Currency.Code, currencies)
		convertedAmount, err := c.convertToTargetCurrency(entry.Amount, entry.Currency.Code, targetCurrency)
		if err != nil {
			return nil, fmt.Errorf("failed to convert %s to %s: %w", entry.Currency.Code, targetCurrency, err)
		}

		// Flip sign so expenses display positive
		displayAmount := -convertedAmount
		currencyTotals[targetCurrency] += displayAmount

		response.Items = append(response.Items, dto.CreditItem{
			Description: fmt.Sprintf("%s %s", entry.Category, entry.Desc),
			Amount:      displayAmount,
			Currency:    targetCurrency,
		})
	}

	// Set total - if only one currency, use that total; otherwise use first currency total
	if len(currencies) == 1 {
		response.Total = currencyTotals[currencies[0]]
	} else {
		response.Total = currencyTotals[currencies[0]] // First currency as main total
		response.CurrencyTotals = currencyTotals       // Include all currency totals
	}

	return response, nil
}

// PayCredit marks credit entries as paid
func (c *CreditUseCase) PayCredit(request dto.CreditRequest) error {
	creditTags, err := c.parameterRepo.GetCreditCardTags(request.CountryCode)
	if err != nil {
		return fmt.Errorf("failed to get credit card tags: %w", err)
	}
	creditTagsStr := strings.Join(creditTags, ",")
	
	entries, err := c.entryRepo.GetByMonth(request.MonthYear, creditTagsStr)
	if err != nil {
		return fmt.Errorf("failed to retrieve credit entries: %w", err)
	}

	// Mark each entry as paid
	for _, entry := range entries {
		minimalEntry := c.convertToPaymentEntry(entry, creditTags)
		if err := c.entryRepo.Update(minimalEntry); err != nil {
			return fmt.Errorf("failed to mark entry %s as paid: %w", entry.ID, err)
		}
	}

	return nil
}

// convertToPaymentEntry converts an entry to a paid entry
func (c *CreditUseCase) convertToPaymentEntry(entry entities.Entry, creditTags []string) entities.MinimalEntry {
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

	// Keep original currency and amount (no conversion needed for payment)
	minimalEntry.Currency = entry.Currency
	minimalEntry.Amount = entry.Amount

	return minimalEntry
}

// getCreditCardCurrencies gets the configured currencies for a credit card
func (c *CreditUseCase) getCreditCardCurrencies(countryCode string) ([]string, error) {
	return c.parameterRepo.GetCreditCardCurrencies(countryCode)
}

// findTargetCurrency finds which configured currency to use for an entry
func (c *CreditUseCase) findTargetCurrency(entryCurrency string, configuredCurrencies []string) string {
	// Check if entry currency is in configured currencies
	for _, currency := range configuredCurrencies {
		if entryCurrency == currency {
			return currency
		}
	}
	// If not found, use first configured currency
	return configuredCurrencies[0]
}

// convertToTargetCurrency converts an amount from one currency to another
func (c *CreditUseCase) convertToTargetCurrency(amount float64, fromCurrency, toCurrency string) (float64, error) {
	if fromCurrency == toCurrency {
		return amount, nil
	}
	
	// Try direct conversion rate
	directRateKey := fmt.Sprintf("%s2%s", fromCurrency, toCurrency)
	if param, err := c.parameterRepo.Get(directRateKey); err == nil {
		return amount * param.Value, nil
	}
	
	// Try inverse conversion rate
	inverseRateKey := fmt.Sprintf("%s2%s", toCurrency, fromCurrency)
	if param, err := c.parameterRepo.Get(inverseRateKey); err == nil {
		return amount / param.Value, nil
	}
	
	return 0, fmt.Errorf("no conversion rate found between %s and %s", fromCurrency, toCurrency)
}
