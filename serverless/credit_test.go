package serverless

import (
	"strings"
	"testing"
)

func TestCreditRegexPatterns(t *testing.T) {
	testCases := []struct {
		pattern  string
		message  string
		expected bool
		name     string
	}{
		{"regCreditDate", "/creditAR 2023-01", true, "creditAR with date"},
		{"regCreditDate", "/creditNL 2023-12", true, "creditNL with date"},
		{"regCreditDate", "/payAR 2020-06", true, "payAR with date"},
		{"regCreditDate", "/payNL 2020-06", true, "payNL with date"},
		{"regCreditDate", "/creditAR", false, "creditAR without date"},
		{"regCreditDate", "/creditXY 2023-01", false, "invalid country code"},
		
		{"regCreditMinimum", "/creditAR", true, "creditAR minimum"},
		{"regCreditMinimum", "/creditNL", true, "creditNL minimum"},
		{"regCreditMinimum", "/payAR", true, "payAR minimum"},
		{"regCreditMinimum", "/payNL", true, "payNL minimum"},
		{"regCreditMinimum", "/credit", false, "credit without country code"},
	}

	for _, tc := range testCases {
		var matched bool
		switch tc.pattern {
		case "regCreditDate":
			matched = regCreditDate.MatchString(tc.message)
		case "regCreditMinimum":
			matched = regCreditMinimum.MatchString(tc.message)
		}

		if matched != tc.expected {
			t.Errorf("%s: for message '%s', expected %v, got %v", 
				tc.name, tc.message, tc.expected, matched)
		}
	}
}

func TestCreditErrorMessage(t *testing.T) {
	if errCreditPay == "" {
		t.Error("errCreditPay should not be empty")
	}

	// Check that error message contains expected content
	expectedContent := "/credit"
	if !strings.Contains(errCreditPay, expectedContent) {
		t.Errorf("errCreditPay should contain '%s'", expectedContent)
	}
	
	expectedPayContent := "/pay"
	if !strings.Contains(errCreditPay, expectedPayContent) {
		t.Errorf("errCreditPay should contain '%s'", expectedPayContent)
	}
}