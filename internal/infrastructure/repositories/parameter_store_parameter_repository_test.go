package repositories

import (
	"errors"
	"testing"

	"piggy/internal/domain/entities"
	"piggy/internal/infrastructure/config"

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

func TestParameterStoreParameterRepository_Get(t *testing.T) {
	configJSON := `{
		"currency": "ARS",
		"conversions": {
			"ARS2USD": 0.001
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

	parameterStore := config.NewParameterStoreServiceWithInterface(mockClient, "/piggy/config")
	repo := NewParameterStoreParameterRepository(parameterStore)

	// Test getting string parameter
	param, err := repo.Get("CURRENCY")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if param.Key != "CURRENCY" {
		t.Errorf("Expected key CURRENCY, got %s", param.Key)
	}

	if param.StringValue != "ARS" {
		t.Errorf("Expected string value ARS, got %s", param.StringValue)
	}

	// Test getting float parameter
	param, err = repo.Get("ApD")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if param.Key != "ApD" {
		t.Errorf("Expected key ApD, got %s", param.Key)
	}

	if param.Value != 150.0 {
		t.Errorf("Expected value 150.0, got %f", param.Value)
	}

	// Test getting conversion rate
	param, err = repo.Get("ARS2USD")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if param.Key != "ARS2USD" {
		t.Errorf("Expected key ARS2USD, got %s", param.Key)
	}

	if param.Value != 0.001 {
		t.Errorf("Expected value 0.001, got %f", param.Value)
	}
}

func TestParameterStoreParameterRepository_Set(t *testing.T) {
	configJSON := `{
		"currency": "EUR",
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

	parameterStore := config.NewParameterStoreServiceWithInterface(mockClient, "/piggy/config")
	repo := NewParameterStoreParameterRepository(parameterStore)

	// Test setting string parameter
	stringParam := entities.NewStringParameter("CURRENCY", "USD")
	err := repo.Set(stringParam)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Verify it was set
	param, err := repo.Get("CURRENCY")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if param.StringValue != "USD" {
		t.Errorf("Expected string value USD, got %s", param.StringValue)
	}

	// Test setting float parameter
	floatParam := entities.NewParameter("ApD", 200.0)
	err = repo.Set(floatParam)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Verify it was set
	param, err = repo.Get("ApD")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if param.Value != 200.0 {
		t.Errorf("Expected value 200.0, got %f", param.Value)
	}
}

func TestParameterStoreParameterRepository_GetNonExistent(t *testing.T) {
	mockClient := &mockSSMClient{
		getError: errors.New("parameter not found"),
	}

	parameterStore := config.NewParameterStoreServiceWithInterface(mockClient, "/piggy/config")
	repo := NewParameterStoreParameterRepository(parameterStore)

	_, err := repo.Get("NON_EXISTENT")
	if err == nil {
		t.Fatal("Expected error for non-existent parameter")
	}
}