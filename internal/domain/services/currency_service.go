package services

import (
	"time"

	"piggy/internal/domain/entities"
)

// CurrencyService defines the interface for currency conversion operations
type CurrencyService interface {
	// ConvertToEUR converts an amount from any currency to EUR
	ConvertToEUR(amount float64, fromCurrency entities.Currency, usdToArs, eurToUsd float64) float64
	
	// SetEntryCurrencyRates updates currency rates for entries in a specific month
	SetEntryCurrencyRates(monthYear time.Time, usdToArs, eurToUsd float64) (int, error)
}