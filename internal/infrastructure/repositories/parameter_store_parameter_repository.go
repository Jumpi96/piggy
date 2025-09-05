package repositories

import (
	"piggy/internal/domain/entities"
	"piggy/internal/domain/repositories"
	"piggy/internal/infrastructure/config"
)

// ParameterStoreParameterRepository implements ParameterRepository using AWS Parameter Store
type ParameterStoreParameterRepository struct {
	parameterStore *config.ParameterStoreService
}

// NewParameterStoreParameterRepository creates a new Parameter Store parameter repository
func NewParameterStoreParameterRepository(parameterStore *config.ParameterStoreService) repositories.ParameterRepository {
	return &ParameterStoreParameterRepository{
		parameterStore: parameterStore,
	}
}

// Get retrieves a parameter by key
func (r *ParameterStoreParameterRepository) Get(key string) (*entities.Parameter, error) {
	// First try to get it as a string parameter
	stringValue, stringErr := r.parameterStore.GetStringValue(key)
	if stringErr == nil {
		return entities.NewStringParameter(key, stringValue), nil
	}

	// If not found as string, try as float
	floatValue, floatErr := r.parameterStore.GetFloatValue(key)
	if floatErr == nil {
		return entities.NewParameter(key, floatValue), nil
	}

	// Return the string error if both failed (more descriptive)
	return nil, stringErr
}

// Set stores or updates a parameter
func (r *ParameterStoreParameterRepository) Set(parameter *entities.Parameter) error {
	if parameter.StringValue != "" {
		return r.parameterStore.SetStringValue(parameter.Key, parameter.StringValue)
	}
	return r.parameterStore.SetFloatValue(parameter.Key, parameter.Value)
}

// GetCurrencySymbol gets the display symbol for the currency
func (r *ParameterStoreParameterRepository) GetCurrencySymbol() (string, error) {
	return r.parameterStore.GetCurrencySymbol()
}

// SetCurrencySymbol sets the display symbol for a currency
func (r *ParameterStoreParameterRepository) SetCurrencySymbol(currency, symbol string) error {
	return r.parameterStore.SetCurrencySymbol(currency, symbol)
}

// GetSymbol gets the display symbol for any currency code  
func (r *ParameterStoreParameterRepository) GetSymbol(currency string) (string, error) {
	return r.parameterStore.GetSymbol(currency)
}