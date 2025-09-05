package config

import (
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/service/ssm"
	"github.com/aws/aws-sdk-go/service/ssm/ssmiface"
)

// mockSSMClient is a mock implementation of the SSM interface for testing
type mockSSMClient struct {
	ssmiface.SSMAPI
	parameters map[string]string
	putError   error
	getError   error
}

func (m *mockSSMClient) GetParameter(input *ssm.GetParameterInput) (*ssm.GetParameterOutput, error) {
	if m.getError != nil {
		return nil, m.getError
	}

	value, exists := m.parameters[*input.Name]
	if !exists {
		return nil, errors.New("parameter not found")
	}

	return &ssm.GetParameterOutput{
		Parameter: &ssm.Parameter{
			Value: aws.String(value),
		},
	}, nil
}

func (m *mockSSMClient) PutParameter(input *ssm.PutParameterInput) (*ssm.PutParameterOutput, error) {
	if m.putError != nil {
		return nil, m.putError
	}

	if m.parameters == nil {
		m.parameters = make(map[string]string)
	}
	m.parameters[*input.Name] = *input.Value

	return &ssm.PutParameterOutput{}, nil
}

func TestParameterStoreService_GetConfig(t *testing.T) {
	configJSON := `{
		"currency": "ARS",
		"conversions": {
			"ARS2USD": 0.001,
			"ARS2EUR": 0.0009
		},
		"budgeting": {
			"amountPerDay": 150.0
		}
	}`

	mockClient := &mockSSMClient{
		parameters: map[string]string{
			"/piggy/config": configJSON,
		},
	}

	service := NewParameterStoreServiceWithInterface(mockClient, "/piggy/config")

	config, err := service.GetConfig()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if config.Currency != "ARS" {
		t.Errorf("Expected currency ARS, got %s", config.Currency)
	}

	if config.Conversions["ARS2USD"] != 0.001 {
		t.Errorf("Expected ARS2USD rate 0.001, got %f", config.Conversions["ARS2USD"])
	}

	if config.Budgeting.AmountPerDay != 150.0 {
		t.Errorf("Expected amount per day 150.0, got %f", config.Budgeting.AmountPerDay)
	}
}

func TestParameterStoreService_GetStringValue(t *testing.T) {
	configJSON := `{
		"currency": "ARS",
		"conversions": {},
		"budgeting": {
			"amountPerDay": 100.0
		}
	}`

	mockClient := &mockSSMClient{
		parameters: map[string]string{
			"/piggy/config": configJSON,
		},
	}

	service := NewParameterStoreServiceWithInterface(mockClient, "/piggy/config")

	currency, err := service.GetStringValue("CURRENCY")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if currency != "ARS" {
		t.Errorf("Expected currency ARS, got %s", currency)
	}
}

func TestParameterStoreService_GetFloatValue(t *testing.T) {
	configJSON := `{
		"currency": "EUR",
		"conversions": {
			"ARS2USD": 0.001
		},
		"budgeting": {
			"amountPerDay": 125.5
		}
	}`

	mockClient := &mockSSMClient{
		parameters: map[string]string{
			"/piggy/config": configJSON,
		},
	}

	service := NewParameterStoreServiceWithInterface(mockClient, "/piggy/config")

	tests := []struct {
		key      string
		expected float64
	}{
		{"ApD", 125.5},
		{"ARS2USD", 0.001},
	}

	for _, test := range tests {
		value, err := service.GetFloatValue(test.key)
		if err != nil {
			t.Fatalf("Expected no error for key %s, got %v", test.key, err)
		}

		if value != test.expected {
			t.Errorf("Expected value %f for key %s, got %f", test.expected, test.key, value)
		}
	}
}

func TestParameterStoreService_SetStringValue(t *testing.T) {
	mockClient := &mockSSMClient{
		parameters: map[string]string{
			"/piggy/config": `{
				"currency": "EUR",
				"conversions": {},
				"budgeting": {
					"amountPerDay": 100.0
				}
			}`,
		},
	}

	service := NewParameterStoreServiceWithInterface(mockClient, "/piggy/config")

	err := service.SetStringValue("CURRENCY", "USD")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Verify the value was updated
	currency, err := service.GetStringValue("CURRENCY")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if currency != "USD" {
		t.Errorf("Expected currency USD, got %s", currency)
	}
}

func TestParameterStoreService_SetFloatValue(t *testing.T) {
	mockClient := &mockSSMClient{
		parameters: map[string]string{
			"/piggy/config": `{
				"currency": "EUR",
				"conversions": {},
				"budgeting": {
					"amountPerDay": 100.0
				}
			}`,
		},
	}

	service := NewParameterStoreServiceWithInterface(mockClient, "/piggy/config")

	// Test setting ApD
	err := service.SetFloatValue("ApD", 200.0)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Test setting conversion rate
	err = service.SetFloatValue("USD2EUR", 0.85)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Verify the values were updated
	apd, err := service.GetFloatValue("ApD")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if apd != 200.0 {
		t.Errorf("Expected ApD 200.0, got %f", apd)
	}

	rate, err := service.GetFloatValue("USD2EUR")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if rate != 0.85 {
		t.Errorf("Expected USD2EUR rate 0.85, got %f", rate)
	}
}

func TestParameterStoreService_GetCurrencySymbol(t *testing.T) {
	tests := []struct {
		name             string
		configJSON       string
		expectedSymbol   string
	}{
		{
			name: "Currency without symbol",
			configJSON: `{
				"currency": "USD",
				"conversions": {},
				"budgeting": {"amountPerDay": 100.0}
			}`,
			expectedSymbol: "USD",
		},
		{
			name: "Currency with symbol",
			configJSON: `{
				"currency": "ARS/AR$",
				"conversions": {},
				"budgeting": {"amountPerDay": 100.0}
			}`,
			expectedSymbol: "AR$",
		},
		{
			name: "USD with $ symbol",
			configJSON: `{
				"currency": "USD/$",
				"conversions": {},
				"budgeting": {"amountPerDay": 100.0}
			}`,
			expectedSymbol: "$",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mockClient := &mockSSMClient{
				parameters: map[string]string{
					"/piggy/config": test.configJSON,
				},
			}

			service := NewParameterStoreServiceWithInterface(mockClient, "/piggy/config")

			symbol, err := service.GetCurrencySymbol()
			if err != nil {
				t.Fatalf("Expected no error, got %v", err)
			}

			if symbol != test.expectedSymbol {
				t.Errorf("Expected symbol %s, got %s", test.expectedSymbol, symbol)
			}
		})
	}
}

func TestParameterStoreService_GetCurrencyCode(t *testing.T) {
	tests := []struct {
		name           string
		configJSON     string
		expectedCode   string
	}{
		{
			name: "Currency without symbol",
			configJSON: `{
				"currency": "USD",
				"conversions": {},
				"budgeting": {"amountPerDay": 100.0}
			}`,
			expectedCode: "USD",
		},
		{
			name: "Currency with symbol",
			configJSON: `{
				"currency": "ARS/AR$",
				"conversions": {},
				"budgeting": {"amountPerDay": 100.0}
			}`,
			expectedCode: "ARS",
		},
		{
			name: "USD with $ symbol",
			configJSON: `{
				"currency": "USD/$",
				"conversions": {},
				"budgeting": {"amountPerDay": 100.0}
			}`,
			expectedCode: "USD",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mockClient := &mockSSMClient{
				parameters: map[string]string{
					"/piggy/config": test.configJSON,
				},
			}

			service := NewParameterStoreServiceWithInterface(mockClient, "/piggy/config")

			code, err := service.GetCurrencyCode()
			if err != nil {
				t.Fatalf("Expected no error, got %v", err)
			}

			if code != test.expectedCode {
				t.Errorf("Expected code %s, got %s", test.expectedCode, code)
			}
		})
	}
}