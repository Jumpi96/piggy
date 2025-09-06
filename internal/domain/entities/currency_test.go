package entities

import (
	"testing"
)

func TestCurrency_ConvertAmount(t *testing.T) {
	testCases := []struct {
		name     string
		currency Currency
		amount   float64
		expected float64
	}{
		{
			name: "no conversion needed (rate 1.0)",
			currency: Currency{
				Code:     "EUR",
				Rate:     1.0,
				MainRate: 1.0,
				Fixed:    false,
			},
			amount:   100.0,
			expected: 100.0,
		},
		{
			name: "USD to EUR conversion",
			currency: Currency{
				Code:     "USD",
				Rate:     0.85, // 1 USD = 0.85 EUR
				MainRate: 1.0,
				Fixed:    true,
			},
			amount:   100.0,
			expected: 85.0,
		},
		{
			name: "ARS to EUR conversion",
			currency: Currency{
				Code:     "ARS",
				Rate:     0.01, // 1 ARS = 0.01 EUR
				MainRate: 100.0,
				Fixed:    true,
			},
			amount:   1000.0,
			expected: 10.0,
		},
		{
			name: "zero amount",
			currency: Currency{
				Code:     "USD",
				Rate:     0.85,
				MainRate: 1.0,
				Fixed:    true,
			},
			amount:   0.0,
			expected: 0.0,
		},
		{
			name: "negative amount",
			currency: Currency{
				Code:     "USD",
				Rate:     0.85,
				MainRate: 1.0,
				Fixed:    true,
			},
			amount:   -100.0,
			expected: -85.0,
		},
		{
			name: "high rate conversion",
			currency: Currency{
				Code:     "JPY",
				Rate:     0.0067, // 1 JPY = 0.0067 EUR
				MainRate: 1.0,
				Fixed:    true,
			},
			amount:   15000.0,
			expected: 100.5,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := tc.currency.ConvertAmount(tc.amount)
			if result != tc.expected {
				t.Errorf("ConvertAmount(%f) for %s with rate %f: expected %f, got %f", 
					tc.amount, tc.currency.Code, tc.currency.Rate, tc.expected, result)
			}
		})
	}
}

func TestCurrency_IsFixed(t *testing.T) {
	testCases := []struct {
		name     string
		currency Currency
		expected bool
	}{
		{
			name: "fixed currency",
			currency: Currency{
				Code:     "USD",
				Rate:     0.85,
				MainRate: 1.0,
				Fixed:    true,
			},
			expected: true,
		},
		{
			name: "non-fixed currency",
			currency: Currency{
				Code:     "EUR",
				Rate:     1.0,
				MainRate: 1.0,
				Fixed:    false,
			},
			expected: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := tc.currency.IsFixed()
			if result != tc.expected {
				t.Errorf("IsFixed() for %s: expected %v, got %v", 
					tc.currency.Code, tc.expected, result)
			}
		})
	}
}

func TestNewCurrency(t *testing.T) {
	testCases := []struct {
		name     string
		code     string
		rate     float64
		mainRate float64
		fixed    bool
	}{
		{"EUR currency", "EUR", 1.0, 1.0, false},
		{"USD currency", "USD", 0.85, 1.0, true},
		{"ARS currency", "ARS", 0.01, 100.0, true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			currency := Currency{
				Code:     tc.code,
				Rate:     tc.rate,
				MainRate: tc.mainRate,
				Fixed:    tc.fixed,
			}

			if currency.Code != tc.code {
				t.Errorf("Code: expected %s, got %s", tc.code, currency.Code)
			}
			if currency.Rate != tc.rate {
				t.Errorf("Rate: expected %f, got %f", tc.rate, currency.Rate)
			}
			if currency.MainRate != tc.mainRate {
				t.Errorf("MainRate: expected %f, got %f", tc.mainRate, currency.MainRate)
			}
			if currency.Fixed != tc.fixed {
				t.Errorf("Fixed: expected %v, got %v", tc.fixed, currency.Fixed)
			}
		})
	}
}

func TestCurrency_ConvertToMainCurrency(t *testing.T) {
	testCases := []struct {
		name     string
		currency Currency
		amount   float64
		expected float64
	}{
		{
			name: "convert using MainRate",
			currency: Currency{
				Code:     "ARS",
				Rate:     0.01,
				MainRate: 100.0, // 100 ARS = 1 EUR
				Fixed:    true,
			},
			amount:   500.0,
			expected: 5.0,
		},
		{
			name: "MainRate of 1.0",
			currency: Currency{
				Code:     "EUR",
				Rate:     1.0,
				MainRate: 1.0,
				Fixed:    false,
			},
			amount:   100.0,
			expected: 100.0,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Simulate conversion using MainRate
			result := tc.amount / tc.currency.MainRate
			if result != tc.expected {
				t.Errorf("MainRate conversion for %f with MainRate %f: expected %f, got %f", 
					tc.amount, tc.currency.MainRate, tc.expected, result)
			}
		})
	}
}