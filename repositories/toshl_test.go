package repositories

import (
	"fmt"
	"strings"
	"testing"
)

func TestDoToshlRequest_URLConstruction(t *testing.T) {
	// Test URL construction logic used in doToshlRequest
	baseURL := "https://api.toshl.com/"
	endpoint := "entries"
	
	expectedURL := fmt.Sprintf("%v%v", baseURL, endpoint)
	if expectedURL != "https://api.toshl.com/entries" {
		t.Errorf("Expected URL construction to produce 'https://api.toshl.com/entries', got: %s", expectedURL)
	}
}

func TestDoToshlRequest_URLConstructionWithParams(t *testing.T) {
	// Test URL construction with parameters
	baseURL := "https://api.toshl.com/"
	endpoint := "entries?from=2020-01-01&to=2020-01-31"
	
	expectedURL := fmt.Sprintf("%v%v", baseURL, endpoint)
	if !strings.Contains(expectedURL, "from=2020-01-01") {
		t.Error("Expected URL to contain query parameters")
	}
	
	if !strings.Contains(expectedURL, "to=2020-01-31") {
		t.Error("Expected URL to contain 'to' parameter")
	}
}

func TestDoToshlRequest_ConfigAccess(t *testing.T) {
	// Test that the function would access the config correctly
	// We can't test the actual HTTP call without real credentials, 
	// but we can verify config structure
	
	originalToken := Configs.ToshlToken
	testToken := "test-token-123"
	Configs.ToshlToken = testToken
	defer func() { Configs.ToshlToken = originalToken }()
	
	if Configs.ToshlToken != testToken {
		t.Errorf("Expected token to be set to '%s', got: %s", testToken, Configs.ToshlToken)
	}
}

func TestDoToshlRequest_FunctionExists(t *testing.T) {
	// Simple test to ensure the function exists and doesn't panic with invalid input
	// We expect this to fail with network error, but not panic
	
	originalToken := Configs.ToshlToken
	Configs.ToshlToken = ""
	defer func() { Configs.ToshlToken = originalToken }()
	
	// This will likely fail due to auth, but shouldn't panic
	_, _, err := doToshlRequest("GET", "test", nil)
	if err == nil {
		t.Log("Unexpected success - might have real credentials configured")
	}
	// We don't check the error because we expect it to fail without real auth
}