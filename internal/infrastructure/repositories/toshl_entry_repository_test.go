package repositories

import (
	"io"
	"testing"
	"time"

	"piggy/internal/domain/entities"
)

// Mock ToshlClient for testing
type mockToshlClient struct {
	response    []byte
	headers     map[string][]string
	err         error
	requestLog  []string
}

// Mock ToshlClient for pagination testing
type mockToshlClientWithPagination struct {
	firstResponse  []byte
	firstHeaders   map[string][]string
	secondResponse []byte
	secondHeaders  map[string][]string
	requestCount   *int
	requestLog     []string
}

func (m *mockToshlClient) DoRequest(verb, url string, payload io.Reader) ([]byte, map[string][]string, error) {
	m.requestLog = append(m.requestLog, verb+" "+url)
	if m.err != nil {
		return nil, nil, m.err
	}
	return m.response, m.headers, nil
}

func (m *mockToshlClientWithPagination) DoRequest(verb, url string, payload io.Reader) ([]byte, map[string][]string, error) {
	m.requestLog = append(m.requestLog, verb+" "+url)
	*m.requestCount++
	
	if *m.requestCount == 1 {
		return m.firstResponse, m.firstHeaders, nil
	} else {
		return m.secondResponse, m.secondHeaders, nil
	}
}

func TestToshlEntryRepository_GetByMonth(t *testing.T) {
	testCases := []struct {
		name         string
		monthYear    time.Time
		tags         string
		mockResponse string
		expectedURLs []string
		expectedLen  int
	}{
		{
			name:      "successful month query with tags",
			monthYear: time.Date(2023, 1, 15, 0, 0, 0, 0, time.UTC),
			tags:      "credit,card",
			mockResponse: `[
				{
					"id": "entry1",
					"date": "2023-01-15",
					"amount": -100.50,
					"currency": {"code": "EUR", "rate": 1.0}
				}
			]`,
			expectedURLs: []string{"GET entries?from=2023-01-01&to=2023-01-31&tags=credit,card&page=0"},
			expectedLen:  1,
		},
		{
			name:      "successful month query without tags",
			monthYear: time.Date(2023, 6, 10, 0, 0, 0, 0, time.UTC),
			tags:      "",
			mockResponse: `[
				{
					"id": "entry1",
					"date": "2023-06-10",
					"amount": -50.25,
					"currency": {"code": "USD", "rate": 0.85}
				},
				{
					"id": "entry2", 
					"date": "2023-06-15",
					"amount": -25.00,
					"currency": {"code": "EUR", "rate": 1.0}
				}
			]`,
			expectedURLs: []string{"GET entries?from=2023-06-01&to=2023-06-30&page=0"},
			expectedLen:  2,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mock client
			mockClient := &mockToshlClient{
				response: []byte(tc.mockResponse),
				headers:  make(map[string][]string),
			}

			// Create repository
			repo := NewToshlEntryRepositoryWithInterface(mockClient, "UTC")

			// Execute
			entries, err := repo.GetByMonth(tc.monthYear, tc.tags)

			// Assert
			if err != nil {
				t.Errorf("Unexpected error: %v", err)
			}

			if len(entries) != tc.expectedLen {
				t.Errorf("Expected %d entries, got %d", tc.expectedLen, len(entries))
			}

			// Check that the correct URL was called
			if len(mockClient.requestLog) != len(tc.expectedURLs) {
				t.Errorf("Expected %d requests, got %d", len(tc.expectedURLs), len(mockClient.requestLog))
			}

			for i, expectedURL := range tc.expectedURLs {
				if i < len(mockClient.requestLog) && mockClient.requestLog[i] != expectedURL {
					t.Errorf("Expected URL %s, got %s", expectedURL, mockClient.requestLog[i])
				}
			}
		})
	}
}

func TestToshlEntryRepository_GetFromTo(t *testing.T) {
	testCases := []struct {
		name         string
		from         time.Time
		to           time.Time
		tags         string
		mockResponse string
		mockHeaders  map[string][]string
		expectedLen  int
		expectPages  int
	}{
		{
			name: "single page response",
			from: time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
			to:   time.Date(2023, 1, 31, 0, 0, 0, 0, time.UTC),
			tags: "credit",
			mockResponse: `[
				{
					"id": "entry1",
					"date": "2023-01-15",
					"amount": -100.50,
					"currency": {"code": "EUR", "rate": 1.0}
				}
			]`,
			mockHeaders: make(map[string][]string),
			expectedLen: 1,
			expectPages: 1,
		},
		{
			name: "multi-page response",
			from: time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
			to:   time.Date(2023, 1, 31, 0, 0, 0, 0, time.UTC),
			tags: "",
			mockResponse: `[
				{
					"id": "entry1", 
					"date": "2023-01-15",
					"amount": -100.50,
					"currency": {"code": "EUR", "rate": 1.0}
				}
			]`,
			mockHeaders: map[string][]string{
				"Link": {`<https://api.toshl.com/entries?page=1>; rel="next"`},
			},
			expectedLen: 2, // Two pages, one entry each
			expectPages: 2,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mock client that simulates pagination
			requestCount := 0
			
			// Create a custom mock for this test
			mockClient := &mockToshlClientWithPagination{
				firstResponse:  []byte(tc.mockResponse),
				firstHeaders:   tc.mockHeaders,
				secondResponse: []byte(tc.mockResponse),
				secondHeaders:  make(map[string][]string),
				requestCount:   &requestCount,
			}

			// Create repository
			repo := &ToshlEntryRepository{
				toshlClient: mockClient,
				timeZone:    "UTC",
			}

			// Execute
			entries, err := repo.GetFromTo(tc.from, tc.to, tc.tags)

			// Assert
			if err != nil {
				t.Errorf("Unexpected error: %v", err)
			}

			if len(entries) != tc.expectedLen {
				t.Errorf("Expected %d entries, got %d", tc.expectedLen, len(entries))
			}

			if *mockClient.requestCount != tc.expectPages {
				t.Errorf("Expected %d API calls, got %d", tc.expectPages, *mockClient.requestCount)
			}
		})
	}
}

func TestToshlEntryRepository_Update(t *testing.T) {
	testCases := []struct {
		name        string
		entry       entities.MinimalEntry
		mockError   error
		expectedURL string
	}{
		{
			name: "successful update",
			entry: entities.MinimalEntry{
				ID:     "entry123",
				Amount: -150.75,
				Currency: entities.Currency{
					Code: "EUR",
					Rate: 1.0,
				},
			},
			mockError:   nil,
			expectedURL: "PUT entries/entry123?update=one&immediate_update=true",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mock client
			mockClient := &mockToshlClient{
				err: tc.mockError,
			}

			// Create repository
			repo := NewToshlEntryRepositoryWithInterface(mockClient, "UTC")

			// Execute
			err := repo.Update(tc.entry)

			// Assert
			if tc.mockError != nil {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}

				// Check that correct URL was called
				if len(mockClient.requestLog) != 1 {
					t.Errorf("Expected 1 request, got %d", len(mockClient.requestLog))
				} else if mockClient.requestLog[0] != tc.expectedURL {
					t.Errorf("Expected URL %s, got %s", tc.expectedURL, mockClient.requestLog[0])
				}
			}
		})
	}
}

func TestToshlEntryRepository_Create(t *testing.T) {
	testCases := []struct {
		name        string
		entry       entities.MinimalEntry
		mockError   error
		expectedURL string
	}{
		{
			name: "successful create",
			entry: entities.MinimalEntry{
				Date:   "2023-01-15",
				Amount: -200.00,
				Currency: entities.Currency{
					Code: "USD",
					Rate: 0.85,
				},
			},
			mockError:   nil,
			expectedURL: "POST entries",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mock client
			mockClient := &mockToshlClient{
				err: tc.mockError,
			}

			// Create repository
			repo := NewToshlEntryRepositoryWithInterface(mockClient, "UTC")

			// Execute
			err := repo.Create(tc.entry)

			// Assert
			if tc.mockError != nil {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}

				// Check that correct URL was called
				if len(mockClient.requestLog) != 1 {
					t.Errorf("Expected 1 request, got %d", len(mockClient.requestLog))
				} else if mockClient.requestLog[0] != tc.expectedURL {
					t.Errorf("Expected URL %s, got %s", tc.expectedURL, mockClient.requestLog[0])
				}
			}
		})
	}
}

func TestToshlEntryRepository_getLinkHeaderFromResponseHeader(t *testing.T) {
	testCases := []struct {
		name     string
		headers  map[string][]string
		expected map[string]string
	}{
		{
			name: "valid link header with next and last",
			headers: map[string][]string{
				"Link": {`<https://api.toshl.com/entries?page=2>; rel="next", <https://api.toshl.com/entries?page=5>; rel="last"`},
			},
			expected: map[string]string{
				"next": "https://api.toshl.com/entries?page=2",
				"last": "https://api.toshl.com/entries?page=5",
			},
		},
		{
			name: "single link header",
			headers: map[string][]string{
				"Link": {`<https://api.toshl.com/entries?page=2>; rel="next"`},
			},
			expected: map[string]string{
				"next": "https://api.toshl.com/entries?page=2",
			},
		},
		{
			name:     "no link header",
			headers:  map[string][]string{},
			expected: map[string]string{},
		},
		{
			name: "empty link header",
			headers: map[string][]string{
				"Link": {""},
			},
			expected: map[string]string{},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Create repository
			repo := &ToshlEntryRepository{}

			// Execute
			result := repo.getLinkHeaderFromResponseHeader(tc.headers)

			// Assert
			if len(result) != len(tc.expected) {
				t.Errorf("Expected %d links, got %d", len(tc.expected), len(result))
			}

			for key, expectedValue := range tc.expected {
				if actualValue, exists := result[key]; !exists {
					t.Errorf("Expected key %s not found in result", key)
				} else if actualValue != expectedValue {
					t.Errorf("For key %s, expected %s, got %s", key, expectedValue, actualValue)
				}
			}
		})
	}
}

func TestNewToshlEntryRepository(t *testing.T) {
	mockClient := &mockToshlClient{}
	timeZone := "Europe/Amsterdam"

	repo := NewToshlEntryRepositoryWithInterface(mockClient, timeZone)

	toshlRepo, ok := repo.(*ToshlEntryRepository)
	if !ok {
		t.Error("Expected *ToshlEntryRepository, got different type")
	}

	if toshlRepo.toshlClient == nil {
		t.Error("ToshlClient not set correctly")
	}

	if toshlRepo.timeZone != timeZone {
		t.Errorf("Expected timeZone %s, got %s", timeZone, toshlRepo.timeZone)
	}
}