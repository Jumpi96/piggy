package repositories

import "piggy/internal/domain/entities"

// ParameterRepository defines the interface for parameter storage operations
type ParameterRepository interface {
	// Get retrieves a parameter by key
	Get(key string) (*entities.Parameter, error)
	
	// Set stores or updates a parameter
	Set(parameter *entities.Parameter) error

	// GetCurrencySymbol gets the display symbol for the currency
	GetCurrencySymbol() (string, error)

	// SetCurrencySymbol sets the display symbol for a currency
	SetCurrencySymbol(currency, symbol string) error

	// GetSymbol gets the display symbol for any currency code
	GetSymbol(currency string) (string, error)

	// GetCreditCardCurrencies gets the configured currencies for a credit card
	GetCreditCardCurrencies(cardCode string) ([]string, error)

	// GetCreditCardTags gets the configured tags for a credit card
	GetCreditCardTags(cardCode string) ([]string, error)
}