package usecases

import (
	"fmt"
	"testing"
	"time"

	"piggy/internal/application/dto"
	"piggy/internal/domain/entities"
)

func TestNewStatusUseCase(t *testing.T) {
	mockEntryRepo := &mockEntryRepository{}
	mockParamRepo := &mockParameterRepository{}
	mockConfig := &mockConfigService{}

	useCase := NewStatusUseCase(mockEntryRepo, mockParamRepo, mockConfig)

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

func TestStatusUseCase_ResolveAmountPerDay(t *testing.T) {
	testCases := []struct {
		name          string
		request       dto.StatusRequest
		mockParams    map[string]*entities.Parameter
		mockError     error
		expectedValue float64
		expectedError bool
	}{
		{
			name: "amount per day provided in request",
			request: dto.StatusRequest{
				AmountPerDay: 100.0,
			},
			expectedValue: 100.0,
			expectedError: false,
		},
		{
			name: "amount per day from parameter repository",
			request: dto.StatusRequest{
				AmountPerDay: 0.0,
			},
			mockParams: map[string]*entities.Parameter{
				"ApD": entities.NewParameter("ApD", 75.5),
			},
			expectedValue: 75.5,
			expectedError: false,
		},
		{
			name: "amount per day not configured",
			request: dto.StatusRequest{
				AmountPerDay: 0.0,
			},
			mockParams:    map[string]*entities.Parameter{},
			mockError:     fmt.Errorf("parameter not found"),
			expectedError: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockEntryRepo := &mockEntryRepository{}
			mockParamRepo := &mockParameterRepository{
				parameters: tc.mockParams,
				err:        tc.mockError,
			}
			mockConfig := &mockConfigService{}

			useCase := NewStatusUseCase(mockEntryRepo, mockParamRepo, mockConfig)

			value, err := useCase.resolveAmountPerDay(tc.request)

			if tc.expectedError {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
				if value != tc.expectedValue {
					t.Errorf("Expected value %f, got %f", tc.expectedValue, value)
				}
			}
		})
	}
}

func TestStatusUseCase_ConvertToBase(t *testing.T) {
	testCases := []struct {
		name           string
		amount         float64
		fromCode       string
		baseCode       string
		mockParams     map[string]*entities.Parameter
		expectedAmount float64
		expectedError  bool
	}{
		{
			name:           "same currency",
			amount:         100.0,
			fromCode:       "EUR",
			baseCode:       "EUR",
			expectedAmount: 100.0,
			expectedError:  false,
		},
		{
			name:     "direct rate conversion",
			amount:   100.0,
			fromCode: "USD",
			baseCode: "EUR",
			mockParams: map[string]*entities.Parameter{
				"USD2EUR": entities.NewParameter("USD2EUR", 0.85),
			},
			expectedAmount: 85.0,
			expectedError:  false,
		},
		{
			name:     "inverse rate conversion",
			amount:   100.0,
			fromCode: "USD",
			baseCode: "EUR",
			mockParams: map[string]*entities.Parameter{
				"EUR2USD": entities.NewParameter("EUR2USD", 1.18),
			},
			expectedAmount: 84.74576271186441,
			expectedError:  false,
		},
		{
			name:          "no rate available",
			amount:        100.0,
			fromCode:      "USD",
			baseCode:      "EUR",
			mockParams:    map[string]*entities.Parameter{},
			expectedError: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockEntryRepo := &mockEntryRepository{}
			mockParamRepo := &mockParameterRepository{
				parameters: tc.mockParams,
			}
			mockConfig := &mockConfigService{}

			useCase := NewStatusUseCase(mockEntryRepo, mockParamRepo, mockConfig)
			usedRates := make(map[string]float64)

			amount, err := useCase.convertToBase(tc.amount, tc.fromCode, tc.baseCode, usedRates)

			if tc.expectedError {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
				if abs(amount-tc.expectedAmount) > 0.0001 {
					t.Errorf("Expected amount %f, got %f", tc.expectedAmount, amount)
				}
			}
		})
	}
}

func TestStatusUseCase_EntryHasBalanceTags(t *testing.T) {
	testCases := []struct {
		name        string
		entryTags   []string
		balanceTags []string
		expected    bool
	}{
		{
			name:        "has balance tag",
			entryTags:   []string{"expense", "balance", "monthly"},
			balanceTags: []string{"balance", "savings"},
			expected:    true,
		},
		{
			name:        "no balance tag",
			entryTags:   []string{"expense", "food"},
			balanceTags: []string{"balance", "savings"},
			expected:    false,
		},
		{
			name:        "empty tags",
			entryTags:   []string{},
			balanceTags: []string{"balance"},
			expected:    false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			useCase := NewStatusUseCase(&mockEntryRepository{}, &mockParameterRepository{}, &mockConfigService{})

			result := useCase.entryHasBalanceTags(tc.entryTags, tc.balanceTags)

			if result != tc.expected {
				t.Errorf("Expected %t, got %t", tc.expected, result)
			}
		})
	}
}

func TestStatusUseCase_GetDaysInMonth(t *testing.T) {
	testCases := []struct {
		name      string
		monthYear time.Time
		expected  int
	}{
		{
			name:      "January has 31 days",
			monthYear: time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
			expected:  31,
		},
		{
			name:      "February has 28 days (non-leap year)",
			monthYear: time.Date(2023, 2, 1, 0, 0, 0, 0, time.UTC),
			expected:  28,
		},
		{
			name:      "February has 29 days (leap year)",
			monthYear: time.Date(2024, 2, 1, 0, 0, 0, 0, time.UTC),
			expected:  29,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			useCase := NewStatusUseCase(&mockEntryRepository{}, &mockParameterRepository{}, &mockConfigService{})

			result := useCase.getDaysInMonth(tc.monthYear)

			if result != tc.expected {
				t.Errorf("Expected %d days, got %d", tc.expected, result)
			}
		})
	}
}

func TestStatusUseCase_IsFutureMonth(t *testing.T) {
	now := time.Date(2023, 6, 15, 0, 0, 0, 0, time.UTC)

	testCases := []struct {
		name      string
		monthYear time.Time
		expected  bool
	}{
		{
			name:      "future month",
			monthYear: time.Date(2023, 7, 1, 0, 0, 0, 0, time.UTC),
			expected:  true,
		},
		{
			name:      "current month",
			monthYear: time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
			expected:  false,
		},
		{
			name:      "past month",
			monthYear: time.Date(2023, 5, 1, 0, 0, 0, 0, time.UTC),
			expected:  false,
		},
		{
			name:      "future year",
			monthYear: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
			expected:  true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			useCase := NewStatusUseCase(&mockEntryRepository{}, &mockParameterRepository{}, &mockConfigService{})

			result := useCase.isFutureMonth(tc.monthYear, now)

			if result != tc.expected {
				t.Errorf("Expected %t, got %t", tc.expected, result)
			}
		})
	}
}

func TestStatusUseCase_IsCurrentMonth(t *testing.T) {
	now := time.Date(2023, 6, 15, 0, 0, 0, 0, time.UTC)

	testCases := []struct {
		name      string
		monthYear time.Time
		expected  bool
	}{
		{
			name:      "current month",
			monthYear: time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
			expected:  true,
		},
		{
			name:      "different month",
			monthYear: time.Date(2023, 7, 1, 0, 0, 0, 0, time.UTC),
			expected:  false,
		},
		{
			name:      "different year",
			monthYear: time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC),
			expected:  false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			useCase := NewStatusUseCase(&mockEntryRepository{}, &mockParameterRepository{}, &mockConfigService{})

			result := useCase.isCurrentMonth(tc.monthYear, now)

			if result != tc.expected {
				t.Errorf("Expected %t, got %t", tc.expected, result)
			}
		})
	}
}

func TestStatusUseCase_GetDaysModifier(t *testing.T) {
	now := time.Date(2023, 6, 15, 0, 0, 0, 0, time.UTC)

	testCases := []struct {
		name      string
		monthYear time.Time
		expected  float64
	}{
		{
			name:      "current month",
			monthYear: time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
			expected:  1.0,
		},
		{
			name:      "different month",
			monthYear: time.Date(2023, 7, 1, 0, 0, 0, 0, time.UTC),
			expected:  0.0,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			useCase := NewStatusUseCase(&mockEntryRepository{}, &mockParameterRepository{}, &mockConfigService{})

			result := useCase.getDaysModifier(tc.monthYear, now)

			if result != tc.expected {
				t.Errorf("Expected %f, got %f", tc.expected, result)
			}
		})
	}
}

func TestStatusUseCase_CalculateRemainingDays(t *testing.T) {
	now := time.Date(2023, 6, 15, 0, 0, 0, 0, time.UTC)

	testCases := []struct {
		name      string
		monthYear time.Time
		expected  float64
	}{
		{
			name:      "current month",
			monthYear: time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
			expected:  16.0, // 30 - 15 + 1 = 16
		},
		{
			name:      "future month",
			monthYear: time.Date(2023, 7, 1, 0, 0, 0, 0, time.UTC),
			expected:  31.0, // full month
		},
		{
			name:      "past month",
			monthYear: time.Date(2023, 5, 1, 0, 0, 0, 0, time.UTC),
			expected:  1.0, // minimum
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			useCase := NewStatusUseCase(&mockEntryRepository{}, &mockParameterRepository{}, &mockConfigService{})

			result := useCase.calculateRemainingDays(tc.monthYear, now)

			if result != tc.expected {
				t.Errorf("Expected %f, got %f", tc.expected, result)
			}
		})
	}
}

func TestStatusUseCase_CalculateDailyBreakdown(t *testing.T) {
	now := time.Date(2023, 6, 15, 0, 0, 0, 0, time.UTC)

	testCases := []struct {
		name      string
		monthYear time.Time
		total     float64
		expected  map[int]float64
	}{
		{
			name:      "current month breakdown",
			monthYear: time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
			total:     160.0,
			expected: map[int]float64{
				15: 10.0, // 160 / 16 = 10
				16: 10.67, // 160 / 15 ≈ 10.67
				17: 11.43, // 160 / 14 ≈ 11.43
				// ... continuing the pattern for remaining days
			},
		},
		{
			name:      "future month breakdown",
			monthYear: time.Date(2023, 7, 1, 0, 0, 0, 0, time.UTC),
			total:     310.0,
			expected: map[int]float64{
				1: 10.0, // 310 / 31 = 10
				2: 10.33, // 310 / 30 ≈ 10.33
				// ... continuing for all 31 days
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			useCase := NewStatusUseCase(&mockEntryRepository{}, &mockParameterRepository{}, &mockConfigService{})

			result := useCase.calculateDailyBreakdown(tc.monthYear, tc.total, now)

			// Check a few key values instead of all values for simplicity
			if tc.name == "current month breakdown" {
				if abs(result[15]-10.0) > 0.01 {
					t.Errorf("Expected day 15 to be ~10.0, got %f", result[15])
				}
			}

			// Check that breakdown has the expected number of entries
			expectedDays := useCase.getDaysInMonth(tc.monthYear)
			if tc.name == "current month breakdown" {
				expectedDays = expectedDays - now.Day() + 1
			}

			if len(result) != expectedDays {
				t.Errorf("Expected %d days in breakdown, got %d", expectedDays, len(result))
			}
		})
	}
}

func TestStatusUseCase_GetMonthlyStatus(t *testing.T) {
	testCases := []struct {
		name           string
		request        dto.StatusRequest
		mockEntries    []entities.Entry
		mockParams     map[string]*entities.Parameter
		mockConfig     *mockConfigService
		expectedError  bool
		expectedPeriod string
	}{
		{
			name: "successful status generation",
			request: dto.StatusRequest{
				MonthYear:    time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
				AmountPerDay: 10.0,
			},
			mockEntries: []entities.Entry{
				{
					ID:     "1",
					Date:   "2023-06-01",
					Amount: 100.0,
					Currency: entities.Currency{
						Code: "EUR",
						Rate: 1.0,
					},
					Tags: []string{"expense"},
				},
				{
					ID:     "2",
					Date:   "2023-06-15",
					Amount: -50.0,
					Currency: entities.Currency{
						Code: "EUR",
						Rate: 1.0,
					},
					Tags: []string{"balance"},
				},
			},
			mockParams: map[string]*entities.Parameter{
				"CURRENCY": entities.NewStringParameter("CURRENCY", "EUR"),
			},
			mockConfig: &mockConfigService{
				balanceTags: []string{"balance"},
				timeZone:    "UTC",
			},
			expectedError:  false,
			expectedPeriod: "2023-06",
		},
		{
			name: "missing base currency",
			request: dto.StatusRequest{
				MonthYear:    time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
				AmountPerDay: 10.0,
			},
			mockEntries: []entities.Entry{},
			mockParams:  map[string]*entities.Parameter{},
			mockConfig: &mockConfigService{
				timeZone: "UTC",
			},
			expectedError: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockEntryRepo := &mockEntryRepository{entries: tc.mockEntries}
			mockParamRepo := &mockParameterRepository{parameters: tc.mockParams}

			useCase := NewStatusUseCase(mockEntryRepo, mockParamRepo, tc.mockConfig)

			response, err := useCase.GetMonthlyStatus(tc.request)

			if tc.expectedError {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
				if response == nil {
					t.Error("Expected response, got nil")
					return
				}
				if response.Period != tc.expectedPeriod {
					t.Errorf("Expected period %s, got %s", tc.expectedPeriod, response.Period)
				}
			}
		})
	}
}

// Helper function for floating point comparison
func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}