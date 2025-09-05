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

func (m *mockParameterRepository) InitializeStorage() error {
	return m.err
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
			expectedTotal: 35050.0, // -(totalUSD*350.0 + totalARS) = -(-100*350.0 + -50) = -(-35000 - 50) = 35050
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
			expectedTotal: 24500000.0, // EUR * usdToArs becomes totalUSD, then total = -(totalUSD*usdToArs) = -(-200*350*350) = 24500000
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
			// Setup mocks
			mockEntryRepo := &mockEntryRepository{entries: tc.mockEntries}
			mockParamRepo := &mockParameterRepository{parameters: make(map[string]*entities.Parameter)}
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

				if result.Total != tc.expectedTotal {
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