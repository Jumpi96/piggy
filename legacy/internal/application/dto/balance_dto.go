package dto

import "time"

// BalanceRequest represents a request for balance operations
type BalanceRequest struct {
	FromDate     time.Time
	ToDate       time.Time
	AmountPerDay float64
	UsdToArs     float64
	EurToUsd     float64
}

// BalanceResponse represents the response from balance operations
type BalanceResponse struct {
    FromDate         string  `json:"from_date"`
    ToDate           string  `json:"to_date"`
    Difference       float64 `json:"difference"`
    DayRemainingDiff float64 `json:"day_remaining_diff"`
    MonthlyBreakdown map[string]float64 `json:"monthly_breakdown"`
    UsedAmountPerDay float64 `json:"used_amount_per_day"`
    UsedBase         string  `json:"used_base"`
    UsedRates        map[string]float64 `json:"used_rates"`
}
