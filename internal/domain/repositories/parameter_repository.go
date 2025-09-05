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

	// GetCurrencyCode gets the currency code (without symbol)
	GetCurrencyCode() (string, error)
}