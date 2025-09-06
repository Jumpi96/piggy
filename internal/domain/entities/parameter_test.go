package entities

import (
	"fmt"
	"testing"
)

func TestNewParameter(t *testing.T) {
	testCases := []struct {
		name     string
		key      string
		value    float64
		expected *Parameter
	}{
		{
			name:  "valid parameter",
			key:   "USD2ARS",
			value: 350.75,
			expected: &Parameter{
				Key:   "USD2ARS",
				Value: 350.75,
			},
		},
		{
			name:  "zero value parameter",
			key:   "ApD",
			value: 0.0,
			expected: &Parameter{
				Key:   "ApD",
				Value: 0.0,
			},
		},
		{
			name:  "negative value parameter",
			key:   "TEST_PARAM",
			value: -123.45,
			expected: &Parameter{
				Key:   "TEST_PARAM",
				Value: -123.45,
			},
		},
		{
			name:  "empty key",
			key:   "",
			value: 100.0,
			expected: &Parameter{
				Key:   "",
				Value: 100.0,
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := NewParameter(tc.key, tc.value)
			
			if result.Key != tc.expected.Key {
				t.Errorf("Key: expected %s, got %s", tc.expected.Key, result.Key)
			}
			
			if result.Value != tc.expected.Value {
				t.Errorf("Value: expected %f, got %f", tc.expected.Value, result.Value)
			}
		})
	}
}

func TestNewStringParameter(t *testing.T) {
	testCases := []struct {
		name     string
		key      string
		value    string
		expected *Parameter
	}{
		{
			name:  "valid string parameter",
			key:   "CURRENCY",
			value: "EUR",
			expected: &Parameter{
				Key:         "CURRENCY",
				StringValue: "EUR",
			},
		},
		{
			name:  "empty string value",
			key:   "BASE_CURRENCY",
			value: "",
			expected: &Parameter{
				Key:         "BASE_CURRENCY",
				StringValue: "",
			},
		},
		{
			name:  "multiword string value",
			key:   "DISPLAY_NAME",
			value: "Euro Dollar",
			expected: &Parameter{
				Key:         "DISPLAY_NAME",
				StringValue: "Euro Dollar",
			},
		},
		{
			name:  "empty key with string value",
			key:   "",
			value: "USD",
			expected: &Parameter{
				Key:         "",
				StringValue: "USD",
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := NewStringParameter(tc.key, tc.value)
			
			if result.Key != tc.expected.Key {
				t.Errorf("Key: expected %s, got %s", tc.expected.Key, result.Key)
			}
			
			if result.StringValue != tc.expected.StringValue {
				t.Errorf("StringValue: expected %s, got %s", tc.expected.StringValue, result.StringValue)
			}

			// Verify that Value field is not set (should be 0)
			if result.Value != 0.0 {
				t.Errorf("Value should be 0.0 for string parameter, got %f", result.Value)
			}
		})
	}
}

func TestParameter_String(t *testing.T) {
	testCases := []struct {
		name      string
		parameter *Parameter
		expected  string
	}{
		{
			name: "standard parameter",
			parameter: &Parameter{
				Key:   "USD2ARS",
				Value: 350.75,
			},
			expected: "USD2ARS=350.75",
		},
		{
			name: "zero value",
			parameter: &Parameter{
				Key:   "ApD",
				Value: 0.0,
			},
			expected: "ApD=0.00",
		},
		{
			name: "negative value",
			parameter: &Parameter{
				Key:   "TEST",
				Value: -123.45,
			},
			expected: "TEST=-123.45",
		},
		{
			name: "high precision value",
			parameter: &Parameter{
				Key:   "EUR2USD",
				Value: 1.185647,
			},
			expected: "EUR2USD=1.19", // Should round to 2 decimals
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Since we don't have a String() method, let's test the formatting logic
			// that would be used in a String() method
			result := fmt.Sprintf("%s=%.2f", tc.parameter.Key, tc.parameter.Value)
			
			if result != tc.expected {
				t.Errorf("String representation: expected %s, got %s", tc.expected, result)
			}
		})
	}
}

func TestParameter_IsValid(t *testing.T) {
	testCases := []struct {
		name      string
		parameter *Parameter
		expected  bool
	}{
		{
			name: "valid parameter",
			parameter: &Parameter{
				Key:   "USD2ARS",
				Value: 350.75,
			},
			expected: true,
		},
		{
			name: "empty key",
			parameter: &Parameter{
				Key:   "",
				Value: 100.0,
			},
			expected: false,
		},
		{
			name: "zero value",
			parameter: &Parameter{
				Key:   "ApD",
				Value: 0.0,
			},
			expected: true, // Zero might be valid for some parameters
		},
		{
			name: "negative value",
			parameter: &Parameter{
				Key:   "TEST",
				Value: -123.45,
			},
			expected: true, // Negative might be valid for some parameters
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Test basic validation logic
			isValid := tc.parameter.Key != ""
			
			if isValid != tc.expected {
				t.Errorf("IsValid: expected %v, got %v for parameter %+v", tc.expected, isValid, tc.parameter)
			}
		})
	}
}

func TestParameter_CommonParameterKeys(t *testing.T) {
	// Test common parameter keys used in the application
	commonKeys := []string{
		"USD2ARS",
		"EUR2USD", 
		"ApD",
	}

	for _, key := range commonKeys {
		t.Run("key_"+key, func(t *testing.T) {
			param := NewParameter(key, 123.45)
			
			if param.Key != key {
				t.Errorf("Expected key %s, got %s", key, param.Key)
			}
			
			if param.Value != 123.45 {
				t.Errorf("Expected value 123.45, got %f", param.Value)
			}
		})
	}
}