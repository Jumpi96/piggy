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
    Period     string             `json:"period"`
    TotalUSD   float64            `json:"total_usd"`
    TotalARS   float64            `json:"total_ars"`
    Total      float64            `json:"total"`
    Items      []CreditItem       `json:"items"`
}

// CreditItem represents a single credit item
type CreditItem struct {
	Description string  `json:"description"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
}
