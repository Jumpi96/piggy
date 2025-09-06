package usecases

import (
	"fmt"
	"testing"
	"time"

	"piggy/internal/application/dto"
	"piggy/internal/domain/entities"
)

// Mock implementations for testing
type mockEntryRepository struct {
	entries []entities.Entry
	err     error
}

func (m *mockEntryRepository) GetByMonth(monthYear time.Time, tags string) ([]entities.Entry, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.entries, nil
}

func (m *mockEntryRepository) GetFromTo(from, to time.Time, tags string) ([]entities.Entry, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.entries, nil
}

func (m *mockEntryRepository) Update(entry entities.MinimalEntry) error {
	return m.err
}

func (m *mockEntryRepository) Create(entry entities.MinimalEntry) error {
	return m.err
}

type mockParameterRepository struct {
	parameters map[string]*entities.Parameter
	err        error
}

func (m *mockParameterRepository) Get(key string) (*entities.Parameter, error) {
	if m.err != nil {
		return nil, m.err
	}
	if param, exists := m.parameters[key]; exists {
		return param, nil
	}
	return nil, fmt.Errorf("parameter not found: %s", key)
}

func (m *mockParameterRepository) Set(parameter *entities.Parameter) error {
	if m.err != nil {
		return m.err
	}
	if m.parameters == nil {
		m.parameters = make(map[string]*entities.Parameter)
	}
	m.parameters[parameter.Key] = parameter
	return nil
}

func (m *mockParameterRepository) GetCurrencySymbol() (string, error) {
	if m.err != nil {
		return "", m.err
	}
	return "EUR", nil // default fallback for tests
}

func (m *mockParameterRepository) SetCurrencySymbol(currency, symbol string) error {
	if m.err != nil {
		return m.err
	}
	return nil // success for tests
}

func (m *mockParameterRepository) GetSymbol(currency string) (string, error) {
	if m.err != nil {
		return currency, m.err
	}
	// Simple mock: return currency code as symbol
	return currency, nil
}

func (m *mockParameterRepository) GetCreditCardCurrencies(cardCode string) ([]string, error) {
	if m.err != nil {
		return nil, m.err
	}
	// Simple mock: return EUR for all cards
	return []string{"EUR"}, nil
}

func (m *mockParameterRepository) GetCreditCardTags(cardCode string) ([]string, error) {
	if m.err != nil {
		return nil, m.err
	}
	// Simple mock: return test tags
	return []string{"credit-" + cardCode}, nil
}

type mockConfigService struct {
	creditTags  map[string][]string
	balanceTags []string
	telegramUser string
	timeZone    string
}

func (m *mockConfigService) GetCreditTags(countryCode string) []string {
	if tags, exists := m.creditTags[countryCode]; exists {
		return tags
	}
	return []string{}
}

func (m *mockConfigService) GetBalanceTags() []string {
	return m.balanceTags
}

func (m *mockConfigService) GetTelegramUser() string {
	return m.telegramUser
}

func (m *mockConfigService) GetTimeZone() string {
	if m.timeZone != "" {
		return m.timeZone
	}
	return "UTC"
}

func TestCreditUseCase_GetCreditStatus(t *testing.T) {
	testCases := []struct {
		name           string
		request        dto.CreditRequest
		mockEntries    []entities.Entry
		mockConfigTags map[string][]string
		expectedError  bool
		expectedTotal  float64
	}{
		{
			name: "successful credit status for AR",
			request: dto.CreditRequest{
				MonthYear:   time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
				UsdToArs:    350.0,
				CountryCode: "AR",
			},
			mockEntries: []entities.Entry{
				{
					ID:     "1",
					Date:   "2023-01-15",
					Amount: -100.0,
					Tags:   []string{"credit", "argentina"},
					Currency: entities.Currency{
						Code: "USD",
						Rate: 1.0,
					},
				},
				{
					ID:     "2", 
					Date:   "2023-01-20",
					Amount: -50.0,
					Tags:   []string{"credit", "argentina"},
					Currency: entities.Currency{
						Code: "ARS",
						Rate: 0.00285,
					},
				},
			},
			mockConfigTags: map[string][]string{
				"AR": {"credit", "argentina"},
			},
        expectedError: false,
        expectedTotal: 85.1, // EUR total: 100*0.85 + 50*0.002 = 85.1
		},
		{
			name: "successful credit status for NL",
			request: dto.CreditRequest{
				MonthYear:   time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
				UsdToArs:    350.0,
				CountryCode: "NL",
			},
			mockEntries: []entities.Entry{
				{
					ID:     "1",
					Date:   "2023-01-15", 
					Amount: -200.0,
					Tags:   []string{"credit", "netherlands"},
					Currency: entities.Currency{
						Code: "EUR",
						Rate: 1.0,
					},
				},
			},
			mockConfigTags: map[string][]string{
				"NL": {"credit", "netherlands"},
			},
        expectedError: false,
        expectedTotal: 200.0, // EUR total with sign flip
		},
		{
			name: "empty entries",
			request: dto.CreditRequest{
				MonthYear:   time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
				UsdToArs:    350.0,
				CountryCode: "AR",
			},
			mockEntries: []entities.Entry{},
			mockConfigTags: map[string][]string{
				"AR": {"credit", "argentina"},
			},
			expectedError: false,
			expectedTotal: 0.0,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mocks with conversion rates
			mockEntryRepo := &mockEntryRepository{entries: tc.mockEntries}
			mockParamRepo := &mockParameterRepository{
				parameters: map[string]*entities.Parameter{
					"USD2EUR": {Key: "USD2EUR", Value: 0.85},  // 1 USD = 0.85 EUR
					"ARS2EUR": {Key: "ARS2EUR", Value: 0.002}, // 1 ARS = 0.002 EUR
				},
			}
			mockConfig := &mockConfigService{creditTags: tc.mockConfigTags}

			// Create use case
			useCase := NewCreditUseCase(mockEntryRepo, mockParamRepo, mockConfig)

			// Execute
			result, err := useCase.GetCreditStatus(tc.request)

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

				if result.Period != tc.request.MonthYear.Format("2006-01") {
					t.Errorf("Expected period %s, got %s", tc.request.MonthYear.Format("2006-01"), result.Period)
				}

                // Allow small floating point tolerance
                if diff := result.Total - tc.expectedTotal; diff > 1e-6 || diff < -1e-6 {
                    t.Errorf("Expected total %f, got %f", tc.expectedTotal, result.Total)
                }
			}
		})
	}
}

func TestNewCreditUseCase(t *testing.T) {
	mockEntryRepo := &mockEntryRepository{}
	mockParamRepo := &mockParameterRepository{}
	mockConfig := &mockConfigService{}

	useCase := NewCreditUseCase(mockEntryRepo, mockParamRepo, mockConfig)

	if useCase == nil {
		t.Error("Expected use case instance, got nil")
	}

	if useCase.entryRepo != mockEntryRepo {
		t.Error("Entry repository not set correctly")
	}

	if useCase.parameterRepo != mockParamRepo {
		t.Error("Parameter repository not set correctly")
	}

	// Can't compare interface directly, just check it's not nil
	if useCase.configService == nil {
		t.Error("Config service not set correctly")
	}
}

func TestCreditUseCase_GetCreditStatus_ConfigServiceIntegration(t *testing.T) {
	// Test that the use case correctly calls ConfigService.GetCreditTags
	mockEntryRepo := &mockEntryRepository{entries: []entities.Entry{}}
	mockParamRepo := &mockParameterRepository{parameters: make(map[string]*entities.Parameter)}
	
	// Mock config that returns specific tags for AR
	mockConfig := &mockConfigService{
		creditTags: map[string][]string{
			"AR": {"credit-card", "argentina"},
			"NL": {"credit", "netherlands"},
		},
	}

	useCase := NewCreditUseCase(mockEntryRepo, mockParamRepo, mockConfig)

	request := dto.CreditRequest{
		MonthYear:   time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
		UsdToArs:    350.0,
		CountryCode: "AR",
	}

	result, err := useCase.GetCreditStatus(request)

	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}

	if result == nil {
		t.Error("Expected result, but got nil")
	}

	// The use case should have called GetCreditTags with "AR"
	expectedTags := mockConfig.GetCreditTags("AR")
	if len(expectedTags) != 2 || expectedTags[0] != "credit-card" || expectedTags[1] != "argentina" {
		t.Errorf("Config service not returning expected tags: %v", expectedTags)
	}
}

func TestCreditUseCase_PayCredit(t *testing.T) {
	testCases := []struct {
		name            string
		request         dto.CreditRequest
		mockEntries     []entities.Entry
		mockCreditTags  []string
		mockRepoError   error
		mockTagsError   error
		mockUpdateError error
		expectedError   bool
	}{
		{
			name: "successful credit payment",
			request: dto.CreditRequest{
				MonthYear:   time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
				CountryCode: "AR",
			},
			mockEntries: []entities.Entry{
				{
					ID:       "1",
					Date:     "2023-06-01",
					Amount:   -100.0,
					Tags:     []string{"expense", "credit-card", "food"},
					Currency: entities.Currency{Code: "USD"},
				},
				{
					ID:       "2",
					Date:     "2023-06-15",
					Amount:   -50.0,
					Tags:     []string{"credit-card", "shopping"},
					Currency: entities.Currency{Code: "USD"},
				},
			},
			mockCreditTags: []string{"credit-card"},
			expectedError:  false,
		},
		{
			name: "failed to get credit card tags",
			request: dto.CreditRequest{
				MonthYear:   time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
				CountryCode: "AR",
			},
			mockTagsError: fmt.Errorf("credit card tags not configured"),
			expectedError: true,
		},
		{
			name: "failed to retrieve entries",
			request: dto.CreditRequest{
				MonthYear:   time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
				CountryCode: "AR",
			},
			mockCreditTags: []string{"credit-card"},
			mockRepoError:  fmt.Errorf("database error"),
			expectedError:  true,
		},
		{
			name: "failed to update entry",
			request: dto.CreditRequest{
				MonthYear:   time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
				CountryCode: "AR",
			},
			mockEntries: []entities.Entry{
				{
					ID:       "1",
					Date:     "2023-06-01",
					Amount:   -100.0,
					Tags:     []string{"credit-card"},
					Currency: entities.Currency{Code: "USD"},
				},
			},
			mockCreditTags:  []string{"credit-card"},
			mockUpdateError: fmt.Errorf("update failed"),
			expectedError:   true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockEntryRepo := &mockEntryRepository{
				entries: tc.mockEntries,
				err:     tc.mockRepoError,
			}

			if tc.mockUpdateError != nil {
				mockEntryRepo.err = tc.mockUpdateError
			}

			mockParamRepo := &mockParameterRepository{
				parameters: make(map[string]*entities.Parameter),
				err:        tc.mockTagsError,
			}
			
			// Mock credit card tags response
			if tc.mockTagsError == nil {
				mockParamRepo.parameters["CREDIT_TAGS_"+tc.request.CountryCode] = entities.NewStringParameter("CREDIT_TAGS_"+tc.request.CountryCode, "credit-card")
			}

			mockConfig := &mockConfigService{}

			useCase := NewCreditUseCase(mockEntryRepo, mockParamRepo, mockConfig)

			err := useCase.PayCredit(tc.request)

			if tc.expectedError {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
			}
		})
	}
}

func TestCreditUseCase_ConvertToPaymentEntry(t *testing.T) {
	testCases := []struct {
		name               string
		entry              entities.Entry
		creditTags         []string
		expectedTags       []string
		expectedCompleted  bool
	}{
		{
			name: "remove credit tags from entry",
			entry: entities.Entry{
				ID:       "1",
				Date:     "2023-06-01",
				Account:  "Test Account",
				Category: "Test Category",
				Modified: "2023-06-01T10:00:00Z",
				Amount:   -100.0,
				Tags:     []string{"expense", "credit-card", "food", "argentina"},
				Currency: entities.Currency{Code: "USD", Rate: 1.0},
			},
			creditTags:        []string{"credit-card", "argentina"},
			expectedTags:      []string{"expense", "food"},
			expectedCompleted: true,
		},
		{
			name: "no credit tags to remove",
			entry: entities.Entry{
				ID:       "2",
				Date:     "2023-06-15",
				Account:  "Test Account",
				Category: "Test Category",
				Modified: "2023-06-15T10:00:00Z",
				Amount:   -50.0,
				Tags:     []string{"expense", "food"},
				Currency: entities.Currency{Code: "EUR", Rate: 1.2},
			},
			creditTags:        []string{"credit-card"},
			expectedTags:      []string{"expense", "food"},
			expectedCompleted: true,
		},
		{
			name: "all tags are credit tags",
			entry: entities.Entry{
				ID:       "3",
				Date:     "2023-06-20",
				Account:  "Test Account",
				Category: "Test Category",
				Modified: "2023-06-20T10:00:00Z",
				Amount:   -75.0,
				Tags:     []string{"credit-card", "argentina"},
				Currency: entities.Currency{Code: "ARS", Rate: 350.0},
			},
			creditTags:        []string{"credit-card", "argentina"},
			expectedTags:      []string{},
			expectedCompleted: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			useCase := NewCreditUseCase(&mockEntryRepository{}, &mockParameterRepository{}, &mockConfigService{})

			result := useCase.convertToPaymentEntry(tc.entry, tc.creditTags)

			// Check basic fields are preserved
			if result.ID != tc.entry.ID {
				t.Errorf("Expected ID %s, got %s", tc.entry.ID, result.ID)
			}
			if result.Date != tc.entry.Date {
				t.Errorf("Expected Date %s, got %s", tc.entry.Date, result.Date)
			}
			if result.Account != tc.entry.Account {
				t.Errorf("Expected Account %s, got %s", tc.entry.Account, result.Account)
			}
			if result.Category != tc.entry.Category {
				t.Errorf("Expected Category %s, got %s", tc.entry.Category, result.Category)
			}
			if result.Modified != tc.entry.Modified {
				t.Errorf("Expected Modified %s, got %s", tc.entry.Modified, result.Modified)
			}
			if result.Amount != tc.entry.Amount {
				t.Errorf("Expected Amount %f, got %f", tc.entry.Amount, result.Amount)
			}
			if result.Currency.Code != tc.entry.Currency.Code {
				t.Errorf("Expected Currency Code %s, got %s", tc.entry.Currency.Code, result.Currency.Code)
			}

			// Check completed flag
			if result.Completed != tc.expectedCompleted {
				t.Errorf("Expected Completed %t, got %t", tc.expectedCompleted, result.Completed)
			}

			// Check tags are properly filtered
			if len(result.Tags) != len(tc.expectedTags) {
				t.Errorf("Expected %d tags, got %d", len(tc.expectedTags), len(result.Tags))
			}

			for i, expectedTag := range tc.expectedTags {
				if i >= len(result.Tags) || result.Tags[i] != expectedTag {
					t.Errorf("Expected tag %s at position %d, got %v", expectedTag, i, result.Tags)
				}
			}
		})
	}
}
