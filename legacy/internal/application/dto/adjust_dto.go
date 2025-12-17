package dto

import "time"

// AdjustRequest represents a request to adjust currency conversion rates
type AdjustRequest struct {
	MonthYear time.Time
}

// AdjustResponse represents the response from currency rate adjustment
type AdjustResponse struct {
	Period        string  `json:"period"`
	UpdatedCount  int     `json:"updated_count"`
	BaseCurrency  string  `json:"base_currency"`
	Message       string  `json:"message"`
}