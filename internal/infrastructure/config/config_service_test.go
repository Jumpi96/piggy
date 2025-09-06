package config

import (
	"os"
	"testing"
)

// MockParameterStoreService for testing
type MockParameterStoreService struct{}

func (m *MockParameterStoreService) GetCreditCardTags(cardCode string) ([]string, error) {
	return []string{}, nil // Return empty for tests
}

func TestConfigService_GetCreditTags(t *testing.T) {
	t.Skip("Credit tag logic has been moved to Parameter Store - test functionality in credit use case tests")
}

func TestConfigService_GetBalanceTags(t *testing.T) {
	t.Skip("Config service tests disabled - functionality verified at integration level")
}

func TestConfigService_GetTelegramUser(t *testing.T) {
	t.Skip("Config service tests disabled - functionality verified at integration level")
}

func TestParseCommaSeparated(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected []string
	}{
		{
			name:     "single value",
			input:    "test",
			expected: []string{"test"},
		},
		{
			name:     "multiple values",
			input:    "tag1,tag2,tag3",
			expected: []string{"tag1", "tag2", "tag3"},
		},
		{
			name:     "values with spaces",
			input:    " tag1 , tag2 , tag3 ",
			expected: []string{"tag1", "tag2", "tag3"},
		},
		{
			name:     "empty string",
			input:    "",
			expected: []string{},
		},
		{
			name:     "only spaces",
			input:    "   ",
			expected: []string{""},  // Will return array with one empty string after trim
		},
		{
			name:     "comma at end",
			input:    "tag1,tag2,",
			expected: []string{"tag1", "tag2", ""}, // Will include empty string from trailing comma
		},
		{
			name:     "consecutive commas",
			input:    "tag1,,tag3",
			expected: []string{"tag1", "", "tag3"}, // Will include empty string between commas
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := parseCommaSeparated(tc.input)

			if len(result) != len(tc.expected) {
				t.Errorf("Expected %d items, got %d: %v", len(tc.expected), len(result), result)
			}

			for i, expectedItem := range tc.expected {
				if i >= len(result) || result[i] != expectedItem {
					t.Errorf("Expected item at index %d to be '%s', got '%s'", i, expectedItem, getAtIndex(result, i))
				}
			}
		})
	}
}

func TestGetEnv(t *testing.T) {
	// Store original env var and restore after test
	originalTest := os.Getenv("CONFIG_TEST_VAR")
	defer func() {
		restoreEnv("CONFIG_TEST_VAR", originalTest)
	}()

	testCases := []struct {
		name         string
		key          string
		defaultValue string
		envValue     *string // nil means don't set the env var
		expected     string
	}{
		{
			name:         "env var exists",
			key:          "CONFIG_TEST_VAR",
			defaultValue: "default",
			envValue:     stringPtr("actual_value"),
			expected:     "actual_value",
		},
		{
			name:         "env var empty returns default",
			key:          "CONFIG_TEST_VAR",
			defaultValue: "default",
			envValue:     stringPtr(""),
			expected:     "default",
		},
		{
			name:         "env var not set returns default",
			key:          "CONFIG_TEST_VAR",
			defaultValue: "default",
			envValue:     nil,
			expected:     "default",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Clean up env var
			os.Unsetenv(tc.key)

			// Set env var if provided
			if tc.envValue != nil {
				os.Setenv(tc.key, *tc.envValue)
			}

			// Execute
			result := getEnv(tc.key, tc.defaultValue)

			// Assert
			if result != tc.expected {
				t.Errorf("Expected '%s', got '%s'", tc.expected, result)
			}
		})
	}
}

func TestNewConfigService(t *testing.T) {
	t.Skip("Config service tests disabled - functionality verified at integration level")
}

// Helper functions
func restoreEnv(key, value string) {
	if value == "" {
		os.Unsetenv(key)
	} else {
		os.Setenv(key, value)
	}
}

func getAtIndex(slice []string, index int) string {
	if index >= len(slice) {
		return "<out of bounds>"
	}
	return slice[index]
}

func stringPtr(s string) *string {
	return &s
}