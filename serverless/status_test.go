package serverless

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestParseMonthYear_ValidFormat(t *testing.T) {
	testCases := []struct {
		input    string
		expected time.Time
	}{
		{"2023-01", time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)},
		{"2023-12", time.Date(2023, 12, 1, 0, 0, 0, 0, time.UTC)},
		{"2020-06", time.Date(2020, 6, 1, 0, 0, 0, 0, time.UTC)},
	}

	for _, tc := range testCases {
		result, err := ParseMonthYear(tc.input)
		if err != nil {
			t.Errorf("Unexpected error for input '%s': %v", tc.input, err)
		}

		if result.Year() != tc.expected.Year() || result.Month() != tc.expected.Month() {
			t.Errorf("For input '%s', expected %v, got %v", tc.input, tc.expected, result)
		}
	}
}

func TestParseMonthYear_InvalidFormat(t *testing.T) {
	testCases := []string{
		"invalid",
		"2023",
		"2023-13", // Invalid month
		"2023-00", // Invalid month
		"23-01",   // Invalid year format
		"2023-1",  // Single digit month
		"",
	}

	for _, tc := range testCases {
		_, err := ParseMonthYear(tc)
		if err == nil {
			t.Errorf("Expected error for invalid input '%s', but got none", tc)
		}
	}
}

func TestStatusRegexPatterns(t *testing.T) {
	testCases := []struct {
		pattern  *regexp.Regexp
		message  string
		expected bool
		name     string
	}{
		{regAllParam, "/status 2023-01 1000.50 1.20 90.00", true, "regAllParam - full params"},
		{regAllParam, "/status 2023-01 1000 1 90", true, "regAllParam - integer params"},
		{regAllParam, "/status 2023-01 1000.5 1.2 90.5", true, "regAllParam - decimal params"},
		{regAllParam, "/status 2023-01 1000", false, "regAllParam - missing params"},
		
		{regDateButMinimum, "/status 2023-01", true, "regDateButMinimum - date only"},
		{regDateButMinimum, "/status 2023-1", false, "regDateButMinimum - invalid date format"},
		
		{regButDate, "/status 1000.50 1.20 90.00", true, "regButDate - params without date"},
		{regButDate, "/status 1000", false, "regButDate - incomplete params"},
		
		{regMinimum, "/status", true, "regMinimum - minimal command"},
		{regMinimum, "/status anything", true, "regMinimum - with any text"},
	}

	for _, tc := range testCases {
		result := tc.pattern.MatchString(tc.message)
		if result != tc.expected {
			t.Errorf("%s: for message '%s', expected %v, got %v", 
				tc.name, tc.message, tc.expected, result)
		}
	}
}

func TestStatusErrorMessages(t *testing.T) {
	if errorNoParameters == "" {
		t.Error("errorNoParameters should not be empty")
	}

	if errorStatus == "" {
		t.Error("errorStatus should not be empty")
	}

	// Check that error messages contain expected content
	expectedNoParamsContent := "parameters"
	if !contains([]string{errorNoParameters}, expectedNoParamsContent) {
		t.Errorf("errorNoParameters should contain '%s'", expectedNoParamsContent)
	}

	expectedStatusContent := "/status"
	if !contains([]string{errorStatus}, expectedStatusContent) {
		t.Errorf("errorStatus should contain '%s'", expectedStatusContent)
	}
}

func TestHandleStatus_RegexMatching(t *testing.T) {
	// We can't fully test handleStatus without DynamoDB, 
	// but we can test the regex logic it uses
	testMessages := []string{
		"/status",
		"/status 2023-01",
		"/status 2023-01 1000.50 1.20 90.00",
		"/status 1000.50 1.20 90.00",
	}

	for _, msg := range testMessages {
		// Test that at least one regex matches
		matched := regAllParam.MatchString(msg) || 
				  regDateButMinimum.MatchString(msg) || 
				  regButDate.MatchString(msg) || 
				  regMinimum.MatchString(msg)

		if !matched {
			t.Errorf("No regex pattern matched message: '%s'", msg)
		}
	}
}

// Helper function to check if a string contains a substring (for error message testing)
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if strings.Contains(s, item) {
			return true
		}
	}
	return false
}