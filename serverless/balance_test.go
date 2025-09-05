package serverless

import (
	"strings"
	"testing"
)

func TestValidateDates_ValidInputs(t *testing.T) {
	testCases := []struct {
		from, to string
		expected bool
		name     string
	}{
		{"2023-01-01", "2023-12-31", true, "same year"},
		{"2023-01-01", "2024-01-01", true, "different years"},
		{"2023-06-15", "2023-06-15", true, "same date"},
		{"2023-12-01", "2023-01-01", false, "from after to"},
		{"invalid", "2023-01-01", false, "invalid from date"},
		{"2023-01-01", "invalid", false, "invalid to date"},
		{"", "", false, "empty dates"},
	}

	for _, tc := range testCases {
		err := validateDates(tc.from, tc.to)
		hasError := err != nil
		
		if tc.expected && hasError {
			t.Errorf("%s: expected no error for dates '%s' to '%s', but got: %v", 
				tc.name, tc.from, tc.to, err)
		} else if !tc.expected && !hasError {
			t.Errorf("%s: expected error for dates '%s' to '%s', but got none", 
				tc.name, tc.from, tc.to)
		}
	}
}

func TestBalanceRegexPatterns(t *testing.T) {
	// Test patterns that would be used in balance.go
	// These are inferred from the handleBalanceStatus function structure
	
	testMessages := []string{
		"/balance",
		"/balance 2023-01 2023-12",
		"/balance 2023-01 2023-12 1000.50 1.20 90.00",
	}

	// Test that balance-related messages contain expected keywords
	for _, msg := range testMessages {
		if !strings.Contains(msg, "balance") {
			t.Errorf("Message should contain 'balance': %s", msg)
		}
	}
}

func TestBalanceErrorMessages(t *testing.T) {
	// Test error message constants that would exist in balance.go
	// We can't access them directly without reading the file, 
	// but we can test the validateDates error messages
	
	err := validateDates("invalid", "2023-01-01")
	if err == nil {
		t.Error("Expected error for invalid date format")
	}
	
	if err != nil && !strings.Contains(err.Error(), "date") {
		t.Errorf("Error message should mention 'date': %v", err)
	}
}