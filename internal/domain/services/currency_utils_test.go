package services

import "testing"

func TestParseCurrency(t *testing.T) {
	tests := []struct {
		name           string
		currencyStr    string
		expectedCode   string
		expectedSymbol string
	}{
		{
			name:           "Empty string should return EUR default",
			currencyStr:    "",
			expectedCode:   "EUR",
			expectedSymbol: "EUR",
		},
		{
			name:           "Code only - ARS",
			currencyStr:    "ARS",
			expectedCode:   "ARS",
			expectedSymbol: "ARS",
		},
		{
			name:           "Code only - USD",
			currencyStr:    "USD",
			expectedCode:   "USD",
			expectedSymbol: "USD",
		},
		{
			name:           "Code with symbol - ARS/AR$",
			currencyStr:    "ARS/AR$",
			expectedCode:   "ARS",
			expectedSymbol: "AR$",
		},
		{
			name:           "Code with symbol - USD/$",
			currencyStr:    "USD/$",
			expectedCode:   "USD",
			expectedSymbol: "$",
		},
		{
			name:           "Code with symbol - EUR/€",
			currencyStr:    "EUR/€",
			expectedCode:   "EUR",
			expectedSymbol: "€",
		},
		{
			name:           "With spaces - should be trimmed",
			currencyStr:    " ARS / AR$ ",
			expectedCode:   "ARS",
			expectedSymbol: "AR$",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := ParseCurrency(test.currencyStr)
			
			if result.Code != test.expectedCode {
				t.Errorf("Expected code %s, got %s", test.expectedCode, result.Code)
			}
			
			if result.Symbol != test.expectedSymbol {
				t.Errorf("Expected symbol %s, got %s", test.expectedSymbol, result.Symbol)
			}
		})
	}
}

func TestFormatCurrency(t *testing.T) {
	tests := []struct {
		name     string
		code     string
		symbol   string
		expected string
	}{
		{
			name:     "Same code and symbol",
			code:     "USD",
			symbol:   "USD",
			expected: "USD",
		},
		{
			name:     "Different code and symbol",
			code:     "ARS",
			symbol:   "AR$",
			expected: "ARS/AR$",
		},
		{
			name:     "USD with $ symbol",
			code:     "USD",
			symbol:   "$",
			expected: "USD/$",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := FormatCurrency(test.code, test.symbol)
			if result != test.expected {
				t.Errorf("Expected %s, got %s", test.expected, result)
			}
		})
	}
}

func TestGetDisplaySymbol(t *testing.T) {
	tests := []struct {
		name        string
		currencyStr string
		expected    string
	}{
		{
			name:        "Code only",
			currencyStr: "USD",
			expected:    "USD",
		},
		{
			name:        "Code with symbol",
			currencyStr: "USD/$",
			expected:    "$",
		},
		{
			name:        "ARS with symbol",
			currencyStr: "ARS/AR$",
			expected:    "AR$",
		},
		{
			name:        "Empty string",
			currencyStr: "",
			expected:    "EUR",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := GetDisplaySymbol(test.currencyStr)
			if result != test.expected {
				t.Errorf("Expected %s, got %s", test.expected, result)
			}
		})
	}
}

func TestGetCurrencyCode(t *testing.T) {
	tests := []struct {
		name        string
		currencyStr string
		expected    string
	}{
		{
			name:        "Code only",
			currencyStr: "USD",
			expected:    "USD",
		},
		{
			name:        "Code with symbol",
			currencyStr: "USD/$",
			expected:    "USD",
		},
		{
			name:        "ARS with symbol",
			currencyStr: "ARS/AR$",
			expected:    "ARS",
		},
		{
			name:        "Empty string",
			currencyStr: "",
			expected:    "EUR",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := GetCurrencyCode(test.currencyStr)
			if result != test.expected {
				t.Errorf("Expected %s, got %s", test.expected, result)
			}
		})
	}
}