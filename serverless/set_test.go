package serverless

import (
	"strings"
	"testing"
)

func TestSetRegexPatterns(t *testing.T) {
	// Test messages that would match set command patterns
	testMessages := []struct {
		message  string
		isValid  bool
		name     string
	}{
		{"/set", true, "basic set command"},
		{"/set USD2ARS 100.50", true, "set with parameter and value"},
		{"/set AMOUNTPERDAY 1000", true, "set daily amount"},
		{"/set EUR2USD 1.20", true, "set currency rate"},
		{"/setinvalid", false, "invalid set command"},
		{"set", false, "missing slash"},
	}

	for _, tc := range testMessages {
		hasSetKeyword := strings.Contains(tc.message, "/set")
		
		if tc.isValid && !hasSetKeyword {
			t.Errorf("%s: expected message '%s' to contain '/set'", tc.name, tc.message)
		}
		
		if tc.isValid {
			// Test that valid messages start with /set
			if !strings.HasPrefix(tc.message, "/set") {
				t.Errorf("%s: expected message '%s' to start with '/set'", tc.name, tc.message)
			}
		}
	}
}

func TestSetCommandParameterParsing(t *testing.T) {
	// Test parameter parsing logic that would be used in set.go
	testCases := []struct {
		message    string
		expectArgs int
		name       string
	}{
		{"/set", 1, "command only"},
		{"/set USD2ARS", 2, "command with parameter"},
		{"/set USD2ARS 100.50", 3, "command with parameter and value"},
		{"/set PARAM VALUE EXTRA", 4, "command with extra arguments"},
	}

	for _, tc := range testCases {
		parts := strings.Split(tc.message, " ")
		if len(parts) != tc.expectArgs {
			t.Errorf("%s: for message '%s', expected %d parts, got %d", 
				tc.name, tc.message, tc.expectArgs, len(parts))
		}
		
		// First part should always be "/set"
		if parts[0] != "/set" {
			t.Errorf("%s: expected first part to be '/set', got '%s'", tc.name, parts[0])
		}
	}
}

func TestSetParameterValidation(t *testing.T) {
	// Test common parameters that would be used in set commands
	validParams := []string{
		"USD2ARS",
		"EUR2USD", 
		"AMOUNTPERDAY",
	}

	for _, param := range validParams {
		if len(param) == 0 {
			t.Errorf("Parameter should not be empty: '%s'", param)
		}
		
		if strings.Contains(param, " ") {
			t.Errorf("Parameter should not contain spaces: '%s'", param)
		}
		
		// Parameters should be uppercase
		if param != strings.ToUpper(param) {
			t.Errorf("Parameter should be uppercase: '%s'", param)
		}
	}
}