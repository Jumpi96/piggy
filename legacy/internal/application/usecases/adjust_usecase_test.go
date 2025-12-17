package usecases

import (
	"fmt"
	"testing"
	"time"

	"piggy/internal/application/dto"
	"piggy/internal/domain/entities"
)

func TestAdjustUseCase_AdjustCurrencyRates(t *testing.T) {
	testCases := []struct {
		name           string
		request        dto.AdjustRequest
		mockEntries    []entities.Entry
		mockParameters map[string]*entities.Parameter
		expectedCount  int
		expectedError  bool
	}{
		{
			name: "successful currency rate adjustment",
			request: dto.AdjustRequest{
				MonthYear: time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
			},
			mockEntries: []entities.Entry{
				{
					ID:     "1",
					Amount: 100.0,
					Currency: entities.Currency{
						Code: "USD",
						Rate: 0.8, // Old rate
					},
					Date:     "2023-01-15",
					Account:  "test-account",
					Category: "test-category",
					Tags:     []string{"test"},
				},
				{
					ID:     "2",
					Amount: 50.0,
					Currency: entities.Currency{
						Code: "ARS", 
						Rate: 0.003, // Old rate
					},
					Date:     "2023-01-20",
					Account:  "test-account",
					Category: "test-category", 
					Tags:     []string{"test"},
				},
				{
					ID:     "3",
					Amount: 75.0,
					Currency: entities.Currency{
						Code: "EUR", // Base currency - should not be updated
						Rate: 1.0,
					},
					Date:     "2023-01-25",
					Account:  "test-account",
					Category: "test-category",
					Tags:     []string{"test"},
				},
			},
			mockParameters: map[string]*entities.Parameter{
				"CURRENCY": {Key: "CURRENCY", StringValue: "EUR"},
				"USD2EUR":  {Key: "USD2EUR", Value: 0.85}, // New rate
				"ARS2EUR":  {Key: "ARS2EUR", Value: 0.002}, // New rate
			},
			expectedCount: 2, // Only USD and ARS entries should be updated
			expectedError: false,
		},
		{
			name: "no entries to update",
			request: dto.AdjustRequest{
				MonthYear: time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
			},
			mockEntries: []entities.Entry{
				{
					ID:     "1",
					Amount: 75.0,
					Currency: entities.Currency{
						Code: "EUR", // All entries are base currency
						Rate: 1.0,
					},
					Date:     "2023-01-25",
					Account:  "test-account",
					Category: "test-category",
					Tags:     []string{"test"},
				},
			},
			mockParameters: map[string]*entities.Parameter{
				"CURRENCY": {Key: "CURRENCY", StringValue: "EUR"},
			},
			expectedCount: 0,
			expectedError: false,
		},
		{
			name: "missing base currency parameter",
			request: dto.AdjustRequest{
				MonthYear: time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
			},
			mockEntries: []entities.Entry{},
			mockParameters: map[string]*entities.Parameter{
				// No CURRENCY parameter
			},
			expectedCount: 0,
			expectedError: true,
		},
		{
			name: "entry retrieval error",
			request: dto.AdjustRequest{
				MonthYear: time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
			},
			mockEntries:    []entities.Entry{}, // Will cause error in mock
			mockParameters: map[string]*entities.Parameter{
				"CURRENCY": {Key: "CURRENCY", StringValue: "EUR"},
			},
			expectedCount: 0,
			expectedError: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mocks
			var mockEntryRepo *mockEntryRepository
			if tc.name == "entry retrieval error" {
				mockEntryRepo = &mockEntryRepository{
					entries: tc.mockEntries,
					err:     fmt.Errorf("database error"),
				}
			} else {
				mockEntryRepo = &mockEntryRepository{
					entries: tc.mockEntries,
				}
			}
			
			mockParamRepo := &mockParameterRepository{
				parameters: tc.mockParameters,
			}
			mockConfig := &mockConfigService{}

			// Create use case
			useCase := NewAdjustUseCase(mockEntryRepo, mockParamRepo, mockConfig)

			// Execute
			result, err := useCase.AdjustCurrencyRates(tc.request)

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

				if result.UpdatedCount != tc.expectedCount {
					t.Errorf("Expected updated count %d, got %d", tc.expectedCount, result.UpdatedCount)
				}

				if result.Period != tc.request.MonthYear.Format("2006-01") {
					t.Errorf("Expected period %s, got %s", tc.request.MonthYear.Format("2006-01"), result.Period)
				}
			}
		})
	}
}

func TestNewAdjustUseCase(t *testing.T) {
	mockEntryRepo := &mockEntryRepository{}
	mockParamRepo := &mockParameterRepository{}
	mockConfig := &mockConfigService{}

	useCase := NewAdjustUseCase(mockEntryRepo, mockParamRepo, mockConfig)

	if useCase == nil {
		t.Error("Expected use case instance, got nil")
	}

	// Verify internal fields are set (using interface check)
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