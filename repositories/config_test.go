package repositories

import (
	"os"
	"testing"
)

func TestGetEnv_WithEnvVar(t *testing.T) {
	key := "TEST_VAR_EXISTS"
	value := "test_value"
	defaultValue := "default_value"

	// Set environment variable
	os.Setenv(key, value)
	defer os.Unsetenv(key)

	result := getEnv(key, defaultValue)

	if result != value {
		t.Errorf("Expected %s, got %s", value, result)
	}
}

func TestGetEnv_WithoutEnvVar(t *testing.T) {
	key := "TEST_VAR_NOT_EXISTS"
	defaultValue := "default_value"

	// Ensure environment variable doesn't exist
	os.Unsetenv(key)

	result := getEnv(key, defaultValue)

	if result != defaultValue {
		t.Errorf("Expected %s, got %s", defaultValue, result)
	}
}

func TestGetEnv_WithEmptyEnvVar(t *testing.T) {
	key := "TEST_VAR_EMPTY"
	defaultValue := "default_value"

	// Set empty environment variable
	os.Setenv(key, "")
	defer os.Unsetenv(key)

	result := getEnv(key, defaultValue)

	if result != defaultValue {
		t.Errorf("Expected %s, got %s", defaultValue, result)
	}
}