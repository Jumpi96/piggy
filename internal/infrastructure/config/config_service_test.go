package config

import (
	"os"
	"testing"

	"piggy/internal/domain/services"
)

func TestConfigService_GetCreditTags(t *testing.T) {
	// Store original env vars and restore after test
	originalCreditAR := os.Getenv("CREDIT_AR_TAG")
	originalCreditNL := os.Getenv("CREDIT_NL_TAG")
	defer func() {
		restoreEnv("CREDIT_AR_TAG", originalCreditAR)
		restoreEnv("CREDIT_NL_TAG", originalCreditNL)
	}()

	testCases := []struct {
		name        string
		countryCode string
		envVars     map[string]string
		expected    []string
	}{
		{
			name:        "AR with single tag",
			countryCode: "AR",
			envVars: map[string]string{
				"CREDIT_TAG": "credit-argentina", // Note: AR uses CREDIT_TAG, not CREDIT_AR_TAG
			},
			expected: []string{"credit-argentina"},
		},
		{
			name:        "AR with multiple tags",
			countryCode: "AR",
			envVars: map[string]string{
				"CREDIT_TAG": "credit,argentina,visa",
			},
			expected: []string{"credit", "argentina", "visa"},
		},
		{
			name:        "NL with single tag",
			countryCode: "NL",
			envVars: map[string]string{
				"CREDIT_NL_TAG": "credit-netherlands",
			},
			expected: []string{"credit-netherlands"},
		},
		{
			name:        "NL with multiple tags",
			countryCode: "NL",
			envVars: map[string]string{
				"CREDIT_NL_TAG": "credit,netherlands,mastercard",
			},
			expected: []string{"credit", "netherlands", "mastercard"},
		},
		{
			name:        "unsupported country code defaults to AR",
			countryCode: "US",
			envVars:     map[string]string{},
			expected:    []string{"123456"}, // Defaults to AR which has default value
		},
		{
			name:        "AR with empty env var uses default",
			countryCode: "AR",
			envVars: map[string]string{
				"CREDIT_TAG": "",
			},
			expected: []string{"123456"}, // Empty env var uses default
		},
		{
			name:        "AR with default fallback",
			countryCode: "AR",
			envVars:     map[string]string{}, // No env var set
			expected:    []string{"123456"},   // Default value from getEnv
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Clear all env vars first
			os.Unsetenv("CREDIT_TAG")
			os.Unsetenv("CREDIT_NL_TAG")
			
			// Set environment variables
			for key, value := range tc.envVars {
				os.Setenv(key, value)
			}

			// Create config service
			config := NewConfigService()

			// Execute
			result := config.GetCreditTags(tc.countryCode)

			// Assert
			if len(result) != len(tc.expected) {
				t.Errorf("Expected %d tags, got %d: %v", len(tc.expected), len(result), result)
			}

			for i, expectedTag := range tc.expected {
				if i >= len(result) || result[i] != expectedTag {
					t.Errorf("Expected tag at index %d to be '%s', got '%s'", i, expectedTag, getAtIndex(result, i))
				}
			}
		})
	}
}

func TestConfigService_GetBalanceTags(t *testing.T) {
	// Store original env var and restore after test
	originalBalance := os.Getenv("BALANCE_TAG")
	defer func() {
		restoreEnv("BALANCE_TAG", originalBalance)
	}()

	testCases := []struct {
		name     string
		envValue string
		expected []string
	}{
		{
			name:     "single balance tag",
			envValue: "balance",
			expected: []string{"balance"},
		},
		{
			name:     "multiple balance tags",
			envValue: "balance,savings,checking",
			expected: []string{"balance", "savings", "checking"},
		},
		{
			name:     "empty env var",
			envValue: "",
			expected: []string{"123456"}, // Uses default when empty
		},
		{
			name:     "tags with spaces (should be trimmed)",
			envValue: " balance , savings , checking ",
			expected: []string{"balance", "savings", "checking"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Clear env var first
			os.Unsetenv("BALANCE_TAG")
			
			// Set environment variable
			os.Setenv("BALANCE_TAG", tc.envValue)

			// Create config service
			config := NewConfigService()

			// Execute
			result := config.GetBalanceTags()

			// Assert
			if len(result) != len(tc.expected) {
				t.Errorf("Expected %d tags, got %d: %v", len(tc.expected), len(result), result)
			}

			for i, expectedTag := range tc.expected {
				if i >= len(result) || result[i] != expectedTag {
					t.Errorf("Expected tag at index %d to be '%s', got '%s'", i, expectedTag, getAtIndex(result, i))
				}
			}
		})
	}
}

func TestConfigService_GetTelegramUser(t *testing.T) {
	// Store original env var and restore after test
	originalUser := os.Getenv("TELEGRAM_USER")
	defer func() {
		restoreEnv("TELEGRAM_USER", originalUser)
	}()

	testCases := []struct {
		name     string
		envValue string
		expected string
	}{
		{
			name:     "user set",
			envValue: "testuser",
			expected: "testuser",
		},
		{
			name:     "empty env var returns empty string",
			envValue: "",
			expected: "", // TelegramUser uses os.Getenv directly, no default
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Clear env var first
			os.Unsetenv("TELEGRAM_USER")
			
			// Set environment variable
			os.Setenv("TELEGRAM_USER", tc.envValue)

			// Create config service
			config := NewConfigService()

			// Execute
			result := config.GetTelegramUser()

			// Assert
			if result != tc.expected {
				t.Errorf("Expected telegram user '%s', got '%s'", tc.expected, result)
			}
		})
	}
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
	config := NewConfigService()

	if config == nil {
		t.Error("Expected config service instance, got nil")
	}

	// Test that it implements the ConfigService interface
	_, ok := config.(services.ConfigService)
	if !ok {
		t.Error("ConfigService does not implement services.ConfigService interface")
	}
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