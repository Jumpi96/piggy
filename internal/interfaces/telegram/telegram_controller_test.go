package telegram

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	appdto "piggy/internal/application/dto"
	"piggy/internal/domain/entities"

	"github.com/aws/aws-lambda-go/events"
)

// Mock use cases for testing
type mockCreditUseCase struct {
	response *appdto.CreditResponse
	err      error
}

func (m *mockCreditUseCase) GetCreditStatus(request appdto.CreditRequest) (*appdto.CreditResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.response, nil
}

type mockStatusUseCase struct {
	response *appdto.StatusResponse
	err      error
}

func (m *mockStatusUseCase) GetMonthlyStatus(request appdto.StatusRequest) (*appdto.StatusResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.response, nil
}

type mockBalanceUseCase struct {
	response *appdto.BalanceResponse
	err      error
}

func (m *mockBalanceUseCase) GetBalanceReport(request appdto.BalanceRequest) (*appdto.BalanceResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.response, nil
}

type mockParameterUseCase struct {
	parameters map[string]*entities.Parameter
	err        error
}

func (m *mockParameterUseCase) SetParameter(key string, value float64) error {
	if m.err != nil {
		return m.err
	}
	if m.parameters == nil {
		m.parameters = make(map[string]*entities.Parameter)
	}
	m.parameters[key] = entities.NewParameter(key, value)
	return nil
}

func (m *mockParameterUseCase) GetParameter(key string) (*entities.Parameter, error) {
	if m.err != nil {
		return nil, m.err
	}
	if param, exists := m.parameters[key]; exists {
		return param, nil
	}
	return nil, fmt.Errorf("parameter not found: %s", key)
}

func (m *mockParameterUseCase) SetCurrencies(monthYear time.Time, usdToArs, eurToUsd float64) (int, error) {
	if m.err != nil {
		return 0, m.err
	}
	return 0, nil
}

type mockConfigService struct {
	telegramUser string
}

func (m *mockConfigService) GetCreditTags(countryCode string) []string {
	return []string{"credit"}
}

func (m *mockConfigService) GetBalanceTags() []string {
	return []string{"balance"}
}

func (m *mockConfigService) GetTelegramUser() string {
	return m.telegramUser
}

func (m *mockConfigService) GetTimeZone() string {
	return "UTC"
}

func TestTelegramController_HandleWebhook(t *testing.T) {
	testCases := []struct {
		name           string
		requestBody    string
		telegramUser   string
		expectedStatus int
		expectedError  bool
	}{
		{
			name: "successful webhook processing",
			requestBody: `{
				"message": {
					"chat": {
						"id": 12345,
						"username": "testuser"
					},
					"text": "/status"
				}
			}`,
			telegramUser:   "testuser",
			expectedStatus: 200,
			expectedError:  false,
		},
		{
			name: "unauthorized user",
			requestBody: `{
				"message": {
					"chat": {
						"id": 12345,
						"username": "unauthorized"
					},
					"text": "/status"
				}
			}`,
			telegramUser:   "testuser",
			expectedStatus: 200, // Still returns 200, but with error message
			expectedError:  false,
		},
		{
			name:           "invalid JSON",
			requestBody:    `invalid json`,
			telegramUser:   "testuser",
			expectedStatus: 400,
			expectedError:  true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mocks
			mockCredit := &mockCreditUseCase{}
			mockStatus := &mockStatusUseCase{
				response: &appdto.StatusResponse{
					Period:           "2023-01",
					Difference:       100.0,
					Cash:             500.0,
					Balance:          200.0,
					DayRemaining:     150.0,
					DayRemainingDiff: 50.0,
				},
			}
			mockBalance := &mockBalanceUseCase{}
			mockParameter := &mockParameterUseCase{
				parameters: map[string]*entities.Parameter{
					"ApD":     entities.NewParameter("ApD", 100.0),
					"EUR2USD": entities.NewParameter("EUR2USD", 1.18),
					"USD2ARS": entities.NewParameter("USD2ARS", 350.0),
				},
			}
			mockConfig := &mockConfigService{telegramUser: tc.telegramUser}

			// Create controller using interface constructor
			controller := NewTelegramControllerWithInterfaces(
				mockCredit,
				mockStatus,
				mockBalance,
				mockParameter,
				mockConfig,
				"fake-token",
			)

			// Create request
			request := events.APIGatewayProxyRequest{
				Body: tc.requestBody,
			}

			// Execute
			response, err := controller.HandleWebhook(context.Background(), request)

			// Assert
			if tc.expectedError {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
			}

			if response.StatusCode != tc.expectedStatus {
				t.Errorf("Expected status %d, got %d", tc.expectedStatus, response.StatusCode)
			}
		})
	}
}

func TestTelegramController_routeCommand(t *testing.T) {
	testCases := []struct {
		name         string
		message      string
		username     string
		telegramUser string
		expected     string
	}{
		{
			name:         "unauthorized user",
			message:      "/status",
			username:     "unauthorized",
			telegramUser: "authorized",
			expected:     "Sir, who are you?🤔",
		},
		{
			name:         "unknown command",
			message:      "/unknown",
			username:     "authorized",
			telegramUser: "authorized",
			expected:     "❓ Use one of the Piggy commands:\n /status\n /credit[CODE]\n /pay[CODE]\n /set\n /balance",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mocks
			mockConfig := &mockConfigService{telegramUser: tc.telegramUser}
			controller := NewTelegramControllerWithInterfaces(
				nil, nil, nil, nil, // Use cases not needed for routing test
				mockConfig,
				"fake-token",
			)

			// Execute
			result := controller.routeCommand(tc.message, tc.username)

			// Assert authorization check
			if tc.username != tc.telegramUser {
				if result != tc.expected {
					t.Errorf("Expected '%s', got '%s'", tc.expected, result)
				}
				return
			}

			// For authorized users, check if we get expected response or handle via command handlers
			if tc.expected != "" && result != tc.expected {
				t.Errorf("Expected '%s', got '%s'", tc.expected, result)
			}
		})
	}
}

func TestTelegramController_handleStatusCommand(t *testing.T) {
	testCases := []struct {
		name              string
		message           string
		mockParameters    map[string]*entities.Parameter
		mockStatusResponse *appdto.StatusResponse
		mockError         error
		expectedContains  []string
		expectError       bool
	}{
		{
			name:    "successful status command",
			message: "/status",
			mockParameters: map[string]*entities.Parameter{
				"ApD":     entities.NewParameter("ApD", 100.0),
				"EUR2USD": entities.NewParameter("EUR2USD", 1.18),
				"USD2ARS": entities.NewParameter("USD2ARS", 350.0),
			},
			mockStatusResponse: &appdto.StatusResponse{
				Period:           "2023-01",
				Difference:       150.0,
				Cash:             500.0,
				Balance:          200.0,
				DayRemaining:     180.0,
				DayRemainingDiff: 30.0,
			},
			mockError: nil,
			expectedContains: []string{
				"🐷PERIOD: 2023-01",
				"💵YOUR CURRENT SITUATION: €150.00",
				"💰Your available cash should be: €500.00",
			},
			expectError: false,
		},
		{
			name:    "missing parameter",
			message: "/status",
			mockParameters: map[string]*entities.Parameter{
				// Missing ApD parameter
				"EUR2USD": entities.NewParameter("EUR2USD", 1.18),
				"USD2ARS": entities.NewParameter("USD2ARS", 350.0),
			},
			expectedContains: []string{"❓", "amount per day not configured"},
			expectError: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mocks
			mockStatus := &mockStatusUseCase{
				response: tc.mockStatusResponse,
				err:      tc.mockError,
			}
			mockParameter := &mockParameterUseCase{
				parameters: tc.mockParameters,
			}
			mockConfig := &mockConfigService{}

			controller := NewTelegramControllerWithInterfaces(
				nil, // credit use case not needed
				mockStatus,
				nil, // balance use case not needed
				mockParameter,
				mockConfig,
				"fake-token",
			)

			// Execute
			result := controller.handleStatusCommand(tc.message)

			// Assert
			if tc.expectError {
				if !strings.Contains(result, "❌") {
					t.Errorf("Expected error response, got: %s", result)
				}
			} else {
				for _, expected := range tc.expectedContains {
					if !strings.Contains(result, expected) {
						t.Errorf("Expected result to contain '%s', got: %s", expected, result)
					}
				}
			}
		})
	}
}

func TestTelegramController_handleCreditCommand(t *testing.T) {
	testCases := []struct {
		name               string
		message            string
		isPay              bool
		mockParameters     map[string]*entities.Parameter
		mockCreditResponse *appdto.CreditResponse
		expectedContains   []string
		expectError        bool
	}{
		{
			name:    "successful credit AR command",
			message: "/creditAR",
			isPay:   false,
			mockParameters: map[string]*entities.Parameter{
				"USD2ARS": entities.NewParameter("USD2ARS", 350.0),
			},
			mockCreditResponse: &appdto.CreditResponse{
				Period:   "2023-01",
				TotalUSD: 100.0,
				TotalARS: 5000.0,
				Total:    200.0,
				Items:    []appdto.CreditItem{},
			},
			expectedContains: []string{
				"💳CREDIT REPORT",
				"🗓️Period: 2023-01",
				"💵Total USD: $100.00",
				"💰Total: €200.00",
			},
			expectError: false,
		},
		{
			name:             "missing country code",
			message:          "/credit",
			isPay:            false,
			mockParameters:   map[string]*entities.Parameter{},
			expectedContains: []string{"❓", "specify country code"},
			expectError:      false,
		},
		{
			name:             "missing USD2ARS parameter",
			message:          "/creditAR",
			isPay:            false,
			mockParameters:   map[string]*entities.Parameter{},
			expectedContains: []string{"❓", "USD to ARS rate not configured"},
			expectError:      false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mocks
			mockCredit := &mockCreditUseCase{
				response: tc.mockCreditResponse,
			}
			mockParameter := &mockParameterUseCase{
				parameters: tc.mockParameters,
			}

			controller := NewTelegramControllerWithInterfaces(
				mockCredit,
				nil, // status use case not needed
				nil, // balance use case not needed
				mockParameter,
				nil, // config service not needed for this test
				"fake-token",
			)

			// Execute
			result := controller.handleCreditCommand(tc.message, tc.isPay)

			// Assert
			for _, expected := range tc.expectedContains {
				if !strings.Contains(result, expected) {
					t.Errorf("Expected result to contain '%s', got: %s", expected, result)
				}
			}
		})
	}
}

func TestTelegramController_handleSetCommand(t *testing.T) {
	testCases := []struct {
		name             string
		message          string
		mockError        error
		expectedContains []string
		expectError      bool
	}{
		{
			name:             "successful set command",
			message:          "/set USD2ARS 350.75",
			mockError:        nil,
			expectedContains: []string{"✅", "USD2ARS", "set to", "350.75"},
			expectError:      false,
		},
		{
			name:             "insufficient parameters",
			message:          "/set USD2ARS",
			mockError:        nil,
			expectedContains: []string{"❓", "Usage: /set <parameter> <value>"},
			expectError:      false,
		},
		{
			name:             "invalid value",
			message:          "/set USD2ARS invalid",
			mockError:        nil,
			expectedContains: []string{"❓", "Invalid value"},
			expectError:      false,
		},
		{
			name:             "repository error",
			message:          "/set USD2ARS 350.75",
			mockError:        fmt.Errorf("database error"),
			expectedContains: []string{"❌", "Error setting parameter"},
			expectError:      false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mocks
			mockParameter := &mockParameterUseCase{
				err:        tc.mockError,
				parameters: make(map[string]*entities.Parameter),
			}

			controller := NewTelegramControllerWithInterfaces(
				nil, // credit use case not needed
				nil, // status use case not needed
				nil, // balance use case not needed
				mockParameter,
				nil, // config service not needed for this test
				"fake-token",
			)

			// Execute
			result := controller.handleSetCommand(tc.message)

			// Assert
			for _, expected := range tc.expectedContains {
				if !strings.Contains(result, expected) {
					t.Errorf("Expected result to contain '%s', got: %s", expected, result)
				}
			}
		})
	}
}

func TestNewTelegramController(t *testing.T) {
	mockCredit := &mockCreditUseCase{}
	mockStatus := &mockStatusUseCase{}
	mockBalance := &mockBalanceUseCase{}
	mockParameter := &mockParameterUseCase{}
	mockConfig := &mockConfigService{}
	token := "test-token"

	controller := NewTelegramControllerWithInterfaces(
		mockCredit,
		mockStatus,
		mockBalance,
		mockParameter,
		mockConfig,
		token,
	)

	if controller == nil {
		t.Error("Expected controller instance, got nil")
	}

	if controller.creditUseCase != mockCredit {
		t.Error("Credit use case not set correctly")
	}

	if controller.statusUseCase != mockStatus {
		t.Error("Status use case not set correctly")
	}

	if controller.balanceUseCase != mockBalance {
		t.Error("Balance use case not set correctly")
	}

	if controller.parameterUseCase != mockParameter {
		t.Error("Parameter use case not set correctly")
	}

	if controller.configService != mockConfig {
		t.Error("Config service not set correctly")
	}

	if controller.telegramToken != token {
		t.Error("Telegram token not set correctly")
	}
}