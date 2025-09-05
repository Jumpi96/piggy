package services

import (
	"time"
)

// EntryService defines the interface for entry business operations
type EntryService interface {
	// CalculateBalance calculates balance for a date range
	CalculateBalance(from, to time.Time, amountPerDay, usdToArs, eurToUsd float64) (map[string]float64, error)
	
	// GenerateMonthlyReport generates a detailed monthly financial report
	GenerateMonthlyReport(monthYear time.Time, amountPerDay, usdToArs, eurToUsd float64) (map[string]float64, map[int]float64, error)
	
	// MarkCreditPayment marks credit entries as paid for a specific month
	MarkCreditPayment(monthYear time.Time, creditTag string, usdToArs float64) error
}