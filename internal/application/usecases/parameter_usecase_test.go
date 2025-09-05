package usecases

import (
	"fmt"
	"testing"
	"time"

	"piggy/internal/domain/entities"
)

func TestParameterUseCase_SetParameter(t *testing.T) {
	testCases := []struct {
		name          string
		key           string
		value         float64
		mockError     error
		expectedError bool
	}{
		{
			name:          "successful parameter set",
			key:           "USD2ARS",
			value:         350.75,
			mockError:     nil,
			expectedError: false,
		},
		{
			name:          "parameter set with zero value",
			key:           "ApD",
			value:         0.0,
			mockError:     nil,
			expectedError: false,
		},
		{
			name:          "parameter set with negative value",
			key:           "TEST_PARAM",
			value:         -123.45,
			mockError:     nil,
			expectedError: false,
		},
		{
			name:          "repository error",
			key:           "EUR2USD",
			value:         1.18,
			mockError:     fmt.Errorf("database connection error"),
			expectedError: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mocks
			mockEntryRepo := &mockEntryRepository{}
			mockParamRepo := &mockParameterRepository{
				parameters: make(map[string]*entities.Parameter),
				err:        tc.mockError,
			}
			mockConfig := &mockConfigService{}

			// Create use case
			useCase := NewParameterUseCase(mockEntryRepo, mockParamRepo, mockConfig)

			// Execute
			err := useCase.SetParameter(tc.key, tc.value)

			// Assert
			if tc.expectedError {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}

				// Verify parameter was set correctly (if no repository error)
				if tc.mockError == nil {
					storedParam, exists := mockParamRepo.parameters[tc.key]
					if !exists {
						t.Errorf("Parameter was not stored in repository")
					} else {
						if storedParam.Key != tc.key {
							t.Errorf("Expected key %s, got %s", tc.key, storedParam.Key)
						}
						if storedParam.Value != tc.value {
							t.Errorf("Expected value %f, got %f", tc.value, storedParam.Value)
						}
					}
				}
			}
		})
	}
}

func TestParameterUseCase_GetParameter(t *testing.T) {
	testCases := []struct {
		name           string
		key            string
		mockParameters map[string]*entities.Parameter
		mockError      error
		expectedError  bool
		expectedValue  float64
	}{
		{
			name: "successful parameter get",
			key:  "USD2ARS",
			mockParameters: map[string]*entities.Parameter{
				"USD2ARS": entities.NewParameter("USD2ARS", 350.75),
			},
			mockError:     nil,
			expectedError: false,
			expectedValue: 350.75,
		},
		{
			name:           "parameter not found",
			key:            "NONEXISTENT",
			mockParameters: make(map[string]*entities.Parameter),
			mockError:      nil,
			expectedError:  true,
			expectedValue:  0.0,
		},
		{
			name: "repository error",
			key:  "EUR2USD",
			mockParameters: map[string]*entities.Parameter{
				"EUR2USD": entities.NewParameter("EUR2USD", 1.18),
			},
			mockError:     fmt.Errorf("database connection error"),
			expectedError: true,
			expectedValue: 0.0,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mocks
			mockEntryRepo := &mockEntryRepository{}
			mockParamRepo := &mockParameterRepository{
				parameters: tc.mockParameters,
				err:        tc.mockError,
			}
			mockConfig := &mockConfigService{}

			// Create use case
			useCase := NewParameterUseCase(mockEntryRepo, mockParamRepo, mockConfig)

			// Execute
			result, err := useCase.GetParameter(tc.key)

			// Assert
			if tc.expectedError {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}

				if result == nil {
					t.Errorf("Expected result, but got nil")
					return
				}

				if result.Key != tc.key {
					t.Errorf("Expected key %s, got %s", tc.key, result.Key)
				}

				if result.Value != tc.expectedValue {
					t.Errorf("Expected value %f, got %f", tc.expectedValue, result.Value)
				}
			}
		})
	}
}

func TestParameterUseCase_SetCurrencies(t *testing.T) {
	testCases := []struct {
		name           string
		monthYear      time.Time
		usdToArs       float64
		eurToUsd       float64
		mockEntries    []entities.Entry
		expectedError  bool
		expectedCount  int
	}{
		{
			name:      "successful currency update for ARS entries",
			monthYear: time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
			usdToArs:  350.0,
			eurToUsd:  1.18,
			mockEntries: []entities.Entry{
				{
					ID:     "1",
					Amount: -100.0,
					Currency: entities.Currency{
						Code:     "ARS",
						Rate:     300.0, // Old rate
						MainRate: 1.0,
						Fixed:    false,
					},
				},
				{
					ID:     "2",
					Amount: -50.0,
					Currency: entities.Currency{
						Code:     "EUR", // Should not be updated
						Rate:     1.0,
						MainRate: 1.0,
						Fixed:    false,
					},
				},
				{
					ID:     "3",
					Amount: -75.0,
					Currency: entities.Currency{
						Code:     "ARS",
						Rate:     310.0, // Old rate
						MainRate: 1.0,
						Fixed:    false,
					},
				},
			},
			expectedError: false,
			expectedCount: 2, // Only ARS entries should be updated
		},
		{
			name:           "no ARS entries",
			monthYear:      time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
			usdToArs:       350.0,
			eurToUsd:       1.18,
			mockEntries:    []entities.Entry{},
			expectedError:  false,
			expectedCount:  0,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mocks
			mockEntryRepo := &mockEntryRepository{entries: tc.mockEntries}
			mockParamRepo := &mockParameterRepository{parameters: make(map[string]*entities.Parameter)}
			mockConfig := &mockConfigService{}

			// Create use case
			useCase := NewParameterUseCase(mockEntryRepo, mockParamRepo, mockConfig)

			// Execute
			count, err := useCase.SetCurrencies(tc.monthYear, tc.usdToArs, tc.eurToUsd)

			// Assert
			if tc.expectedError {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}

				if count != tc.expectedCount {
					t.Errorf("Expected update count %d, got %d", tc.expectedCount, count)
				}
			}
		})
	}
}

func TestNewParameterUseCase(t *testing.T) {
	mockEntryRepo := &mockEntryRepository{}
	mockParamRepo := &mockParameterRepository{}
	mockConfig := &mockConfigService{}

	useCase := NewParameterUseCase(mockEntryRepo, mockParamRepo, mockConfig)

	if useCase == nil {
		t.Error("Expected use case instance, got nil")
	}

	if useCase.entryRepo != mockEntryRepo {
		t.Error("Entry repository not set correctly")
	}

	if useCase.parameterRepo != mockParamRepo {
		t.Error("Parameter repository not set correctly")
	}

	if useCase.configService != mockConfig {
		t.Error("Config service not set correctly")
	}
}