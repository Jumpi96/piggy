package services

import "strings"

// CurrencyInfo represents currency code and its display symbol
type CurrencyInfo struct {
	Code   string // e.g., "ARS", "USD"
	Symbol string // e.g., "AR$", "$"
}

// ParseCurrency parses a currency string that can be in format "CODE" or "CODE/SYMBOL"
// Examples:
//   - "ARS" -> CurrencyInfo{Code: "ARS", Symbol: "ARS"}
//   - "ARS/AR$" -> CurrencyInfo{Code: "ARS", Symbol: "AR$"}
//   - "USD/$" -> CurrencyInfo{Code: "USD", Symbol: "$"}
func ParseCurrency(currencyStr string) CurrencyInfo {
	if currencyStr == "" {
		return CurrencyInfo{Code: "EUR", Symbol: "EUR"}
	}

	parts := strings.Split(currencyStr, "/")
	if len(parts) == 2 {
		// Format: CODE/SYMBOL
		return CurrencyInfo{
			Code:   strings.TrimSpace(parts[0]),
			Symbol: strings.TrimSpace(parts[1]),
		}
	}

	// Format: CODE only
	code := strings.TrimSpace(currencyStr)
	return CurrencyInfo{
		Code:   code,
		Symbol: code, // Use code as symbol if no symbol provided
	}
}

// FormatCurrency formats a currency for storage (returns just the code/symbol format)
func FormatCurrency(code, symbol string) string {
	if code == symbol {
		return code
	}
	return code + "/" + symbol
}

// GetDisplaySymbol gets the display symbol for a currency string
func GetDisplaySymbol(currencyStr string) string {
	return ParseCurrency(currencyStr).Symbol
}

// GetCurrencyCode gets the currency code from a currency string
func GetCurrencyCode(currencyStr string) string {
	return ParseCurrency(currencyStr).Code
}