package dto

import "time"

// CreditRequest represents a request for credit operations
type CreditRequest struct {
    MonthYear time.Time
    UsdToArs  float64
    EurToUsd  float64
    CountryCode string // "AR" or "NL"
}

// CreditResponse represents the response from credit operations
type CreditResponse struct {
    Period         string                    `json:"period"`
    TotalUSD       float64                   `json:"total_usd"`       // Deprecated: use CurrencyTotals
    TotalARS       float64                   `json:"total_ars"`       // Deprecated: use CurrencyTotals
    Total          float64                   `json:"total"`
    CurrencyTotals map[string]float64        `json:"currency_totals,omitempty"`
    Items          []CreditItem              `json:"items"`
}

// CreditItem represents a single credit item
type CreditItem struct {
	Description string  `json:"description"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
}
