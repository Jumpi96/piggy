package dto

import "time"

// StatusRequest represents a request for status operations
type StatusRequest struct {
	MonthYear    time.Time
	AmountPerDay float64
	EurToUsd     float64
	UsdToArs     float64
}

// StatusResponse represents the response from status operations
type StatusResponse struct {
	Period            string             `json:"period"`
	Difference        float64            `json:"difference"`
	Cash              float64            `json:"cash"`
	Balance           float64            `json:"balance"`
	DayRemaining      float64            `json:"day_remaining"`
	DayRemainingDiff  float64            `json:"day_remaining_diff"`
	DailyBreakdown    map[int]float64    `json:"daily_breakdown"`
}