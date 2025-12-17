package usecases

import (
	"fmt"
	"testing"
	"time"

	"piggy/internal/application/dto"
	"piggy/internal/domain/entities"
)

func TestNewBalanceUseCase(t *testing.T) {
	mockEntryRepo := &mockEntryRepository{}
	mockParamRepo := &mockParameterRepository{}
	mockConfig := &mockConfigService{}

	useCase := NewBalanceUseCase(mockEntryRepo, mockParamRepo, mockConfig)

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

func TestBalanceUseCase_ResolveAmountPerDay(t *testing.T) {
	testCases := []struct {
		name          string
		request       dto.BalanceRequest
		mockParams    map[string]*entities.Parameter
		mockError     error
		expectedValue float64
		expectedError bool
	}{
		{
			name: "amount per day provided in request",
			request: dto.BalanceRequest{
				AmountPerDay: 100.0,
			},
			expectedValue: 100.0,
			expectedError: false,
		},
		{
			name: "amount per day from parameter repository",
			request: dto.BalanceRequest{
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
			request: dto.BalanceRequest{
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

			useCase := NewBalanceUseCase(mockEntryRepo, mockParamRepo, mockConfig)

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

func TestBalanceUseCase_ConvertToBase(t *testing.T) {
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

			useCase := NewBalanceUseCase(mockEntryRepo, mockParamRepo, mockConfig)
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

func TestBalanceUseCase_DaysInclusive(t *testing.T) {
	testCases := []struct {
		name     string
		from     time.Time
		to       time.Time
		expected int
	}{
		{
			name:     "same day",
			from:     time.Date(2023, 6, 15, 0, 0, 0, 0, time.UTC),
			to:       time.Date(2023, 6, 15, 0, 0, 0, 0, time.UTC),
			expected: 1,
		},
		{
			name:     "consecutive days",
			from:     time.Date(2023, 6, 15, 0, 0, 0, 0, time.UTC),
			to:       time.Date(2023, 6, 16, 0, 0, 0, 0, time.UTC),
			expected: 2,
		},
		{
			name:     "week span",
			from:     time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
			to:       time.Date(2023, 6, 7, 0, 0, 0, 0, time.UTC),
			expected: 7,
		},
		{
			name:     "month span",
			from:     time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
			to:       time.Date(2023, 6, 30, 0, 0, 0, 0, time.UTC),
			expected: 30,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			useCase := NewBalanceUseCase(&mockEntryRepository{}, &mockParameterRepository{}, &mockConfigService{})

			result := useCase.daysInclusive(tc.from, tc.to)

			if result != tc.expected {
				t.Errorf("Expected %d days, got %d", tc.expected, result)
			}
		})
	}
}

func TestBalanceUseCase_ComputeMonthlyTotalsBase(t *testing.T) {
	testCases := []struct {
		name             string
		entries          []entities.Entry
		baseCode         string
		mockParams       map[string]*entities.Parameter
		expectedTotal    float64
		expectedMonthly  map[string]float64
		expectedError    bool
	}{
		{
			name: "successful computation",
			entries: []entities.Entry{
				{
					ID:     "1",
					Date:   "2023-06-01",
					Amount: 100.0,
					Currency: entities.Currency{Code: "EUR"},
				},
				{
					ID:     "2",
					Date:   "2023-06-15",
					Amount: 50.0,
					Currency: entities.Currency{Code: "EUR"},
				},
				{
					ID:     "3",
					Date:   "2023-07-01",
					Amount: 75.0,
					Currency: entities.Currency{Code: "EUR"},
				},
			},
			baseCode:      "EUR",
			mockParams:    map[string]*entities.Parameter{},
			expectedTotal: 225.0,
			expectedMonthly: map[string]float64{
				"2023-06": 150.0,
				"2023-07": 75.0,
			},
			expectedError: false,
		},
		{
			name: "conversion error",
			entries: []entities.Entry{
				{
					ID:     "1",
					Date:   "2023-06-01",
					Amount: 100.0,
					Currency: entities.Currency{Code: "USD"},
				},
			},
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

			useCase := NewBalanceUseCase(mockEntryRepo, mockParamRepo, mockConfig)
			usedRates := make(map[string]float64)

			total, monthly, err := useCase.computeMonthlyTotalsBase(tc.entries, tc.baseCode, usedRates)

			if tc.expectedError {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
				if abs(total-tc.expectedTotal) > 0.0001 {
					t.Errorf("Expected total %f, got %f", tc.expectedTotal, total)
				}
				for month, expectedValue := range tc.expectedMonthly {
					if actualValue, exists := monthly[month]; !exists {
						t.Errorf("Expected month %s to exist in monthly breakdown", month)
					} else if abs(actualValue-expectedValue) > 0.0001 {
						t.Errorf("Expected %s total %f, got %f", month, expectedValue, actualValue)
					}
				}
			}
		})
	}
}

func TestBalanceUseCase_AdjustMonthlyBreakdown(t *testing.T) {
	testCases := []struct {
		name             string
		monthly          map[string]float64
		from             time.Time
		to               time.Time
		amountPerDay     float64
		expectedAdjusted map[string]float64
	}{
		{
			name: "single month adjustment",
			monthly: map[string]float64{
				"2023-06": 300.0,
			},
			from:         time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
			to:           time.Date(2023, 6, 30, 0, 0, 0, 0, time.UTC),
			amountPerDay: 10.0,
			expectedAdjusted: map[string]float64{
				"2023-06": 0.0, // 300.0 - 10.0 * 30 = 0.0
			},
		},
		{
			name: "partial month adjustment",
			monthly: map[string]float64{
				"2023-06": 200.0,
			},
			from:         time.Date(2023, 6, 15, 0, 0, 0, 0, time.UTC),
			to:           time.Date(2023, 6, 20, 0, 0, 0, 0, time.UTC),
			amountPerDay: 10.0,
			expectedAdjusted: map[string]float64{
				"2023-06": 140.0, // 200.0 - 10.0 * 6 = 140.0
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			useCase := NewBalanceUseCase(&mockEntryRepository{}, &mockParameterRepository{}, &mockConfigService{})

			result := useCase.adjustMonthlyBreakdown(tc.monthly, tc.from, tc.to, tc.amountPerDay)

			for month, expectedValue := range tc.expectedAdjusted {
				if actualValue, exists := result[month]; !exists {
					t.Errorf("Expected month %s to exist in adjusted breakdown", month)
				} else if abs(actualValue-expectedValue) > 0.0001 {
					t.Errorf("Expected %s adjusted value %f, got %f", month, expectedValue, actualValue)
				}
			}
		})
	}
}

func TestBalanceUseCase_ConvertToEUR(t *testing.T) {
	testCases := []struct {
		name      string
		amount    float64
		currency  string
		usdToArs  float64
		eurToUsd  float64
		expected  float64
	}{
		{
			name:     "EUR to EUR",
			amount:   100.0,
			currency: "EUR",
			usdToArs: 300.0,
			eurToUsd: 1.2,
			expected: 100.0,
		},
		{
			name:     "USD to EUR",
			amount:   120.0,
			currency: "USD",
			usdToArs: 300.0,
			eurToUsd: 1.2,
			expected: 100.0, // 120 / 1.2 = 100
		},
		{
			name:     "ARS to EUR",
			amount:   360.0,
			currency: "ARS",
			usdToArs: 300.0,
			eurToUsd: 1.2,
			expected: 1.0, // 360 / (300 * 1.2) = 360 / 360 = 1
		},
		{
			name:     "other currency defaults to USD rate",
			amount:   120.0,
			currency: "GBP",
			usdToArs: 300.0,
			eurToUsd: 1.2,
			expected: 100.0, // 120 / 1.2 = 100
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			useCase := NewBalanceUseCase(&mockEntryRepository{}, &mockParameterRepository{}, &mockConfigService{})

			result := useCase.convertToEUR(tc.amount, tc.currency, tc.usdToArs, tc.eurToUsd)

			if abs(result-tc.expected) > 0.0001 {
				t.Errorf("Expected %f, got %f", tc.expected, result)
			}
		})
	}
}

func TestBalanceUseCase_GetBalanceReport(t *testing.T) {
	testCases := []struct {
		name          string
		request       dto.BalanceRequest
		mockEntries   []entities.Entry
		mockParams    map[string]*entities.Parameter
		expectedError bool
		expectedFrom  string
		expectedTo    string
	}{
		{
			name: "successful balance report",
			request: dto.BalanceRequest{
				FromDate:     time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
				ToDate:       time.Date(2023, 6, 30, 0, 0, 0, 0, time.UTC),
				AmountPerDay: 10.0,
			},
			mockEntries: []entities.Entry{
				{
					ID:     "1",
					Date:   "2023-06-01",
					Amount: 100.0,
					Currency: entities.Currency{Code: "EUR"},
				},
				{
					ID:     "2",
					Date:   "2023-06-15",
					Amount: 50.0,
					Currency: entities.Currency{Code: "EUR"},
				},
			},
			mockParams: map[string]*entities.Parameter{
				"CURRENCY": entities.NewStringParameter("CURRENCY", "EUR"),
			},
			expectedError: false,
			expectedFrom:  "2023-06-01",
			expectedTo:    "2023-06-30",
		},
		{
			name: "missing base currency",
			request: dto.BalanceRequest{
				FromDate:     time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
				ToDate:       time.Date(2023, 6, 30, 0, 0, 0, 0, time.UTC),
				AmountPerDay: 10.0,
			},
			mockEntries:   []entities.Entry{},
			mockParams:    map[string]*entities.Parameter{},
			expectedError: true,
		},
		{
			name: "entry repository error",
			request: dto.BalanceRequest{
				FromDate:     time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC),
				ToDate:       time.Date(2023, 6, 30, 0, 0, 0, 0, time.UTC),
				AmountPerDay: 10.0,
			},
			mockEntries:   nil,
			mockParams:    map[string]*entities.Parameter{},
			expectedError: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var mockEntryRepo *mockEntryRepository
			if tc.name == "entry repository error" {
				mockEntryRepo = &mockEntryRepository{
					err: fmt.Errorf("database error"),
				}
			} else {
				mockEntryRepo = &mockEntryRepository{entries: tc.mockEntries}
			}

			mockParamRepo := &mockParameterRepository{parameters: tc.mockParams}
			mockConfig := &mockConfigService{}

			useCase := NewBalanceUseCase(mockEntryRepo, mockParamRepo, mockConfig)

			response, err := useCase.GetBalanceReport(tc.request)

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
				if response.FromDate != tc.expectedFrom {
					t.Errorf("Expected from date %s, got %s", tc.expectedFrom, response.FromDate)
				}
				if response.ToDate != tc.expectedTo {
					t.Errorf("Expected to date %s, got %s", tc.expectedTo, response.ToDate)
				}
			}
		})
	}
}