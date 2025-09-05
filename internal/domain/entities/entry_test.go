package entities

import (
	"testing"
	"time"
)

func TestEntry_IsExpense(t *testing.T) {
	testCases := []struct {
		name     string
		amount   float64
		expected bool
	}{
		{"positive amount", 100.0, false},
		{"negative amount", -50.0, true},
		{"zero amount", 0.0, false},
		{"small positive", 0.01, false},
		{"small negative", -0.01, true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			entry := &Entry{Amount: tc.amount}
			result := entry.IsExpense()
			if result != tc.expected {
				t.Errorf("IsExpense() for amount %f: expected %v, got %v", tc.amount, tc.expected, result)
			}
		})
	}
}

func TestEntry_HasTag(t *testing.T) {
	testCases := []struct {
		name     string
		tags     []string
		searchTag string
		expected bool
	}{
		{"tag exists", []string{"credit", "card", "monthly"}, "credit", true},
		{"tag doesn't exist", []string{"credit", "card", "monthly"}, "debit", false},
		{"empty tags", []string{}, "credit", false},
		{"nil tags", nil, "credit", false},
		{"exact match", []string{"test"}, "test", true},
		{"case sensitive", []string{"Credit"}, "credit", false},
		{"multiple occurrences", []string{"tag", "credit", "tag"}, "credit", true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			entry := &Entry{Tags: tc.tags}
			result := entry.HasTag(tc.searchTag)
			if result != tc.expected {
				t.Errorf("HasTag(%s) for tags %v: expected %v, got %v", tc.searchTag, tc.tags, tc.expected, result)
			}
		})
	}
}

func TestEntry_GetDateAsTime(t *testing.T) {
	testCases := []struct {
		name     string
		dateStr  string
		hasError bool
	}{
		{"valid date", "2023-01-15", false},
		{"valid date different month", "2023-12-01", false},
		{"invalid date format", "invalid-date", true},
		{"empty date", "", true},
		{"invalid format", "2023/01/15", true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			entry := &Entry{Date: tc.dateStr}
			result, err := entry.GetDateAsTime()
			
			if tc.hasError {
				if err == nil {
					t.Errorf("Expected error for date %s, but got none", tc.dateStr)
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error for date %s: %v", tc.dateStr, err)
				}
				
				if !tc.hasError && tc.dateStr != "" {
					expectedDate, _ := time.Parse("2006-01-02", tc.dateStr)
					
					if result.Year() != expectedDate.Year() || result.Month() != expectedDate.Month() || result.Day() != expectedDate.Day() {
						t.Errorf("GetDateAsTime() returned wrong date: expected %v, got %v", expectedDate, result)
					}
				}
			}
		})
	}
}

func TestMinimalEntry_Creation(t *testing.T) {
	// Test creating MinimalEntry directly
	minimal := MinimalEntry{
		ID:        "test-id",
		Date:      "2023-01-15",
		Account:   "test-account",
		Category:  "test-category", 
		Modified:  "2023-01-15T10:00:00Z",
		Amount:    -100.50,
		Tags:      []string{"credit", "card"},
		Completed: true,
		Currency: Currency{
			Code:     "EUR",
			Rate:     1.0,
			MainRate: 1.0,
			Fixed:    false,
		},
	}

	// Check that all fields are set correctly
	if minimal.ID != "test-id" {
		t.Errorf("ID not set correctly: expected %s, got %s", "test-id", minimal.ID)
	}
	if minimal.Date != "2023-01-15" {
		t.Errorf("Date not set correctly: expected %s, got %s", "2023-01-15", minimal.Date)
	}
	if minimal.Amount != -100.50 {
		t.Errorf("Amount not set correctly: expected %f, got %f", -100.50, minimal.Amount)
	}
	if len(minimal.Tags) != 2 {
		t.Errorf("Tags not set correctly: expected 2 tags, got %d", len(minimal.Tags))
	}
	if minimal.Currency.Code != "EUR" {
		t.Errorf("Currency code not set correctly: expected %s, got %s", "EUR", minimal.Currency.Code)
	}
}

func TestEntry_HasMultipleTags(t *testing.T) {
	testCases := []struct {
		name        string
		entryTags   []string
		searchTags  []string
		expected    bool
	}{
		{"has all tags", []string{"credit", "card", "monthly", "expense"}, []string{"credit", "monthly"}, true},
		{"has some tags", []string{"credit", "card", "monthly"}, []string{"credit", "debit"}, false},
		{"has no tags", []string{"other", "different"}, []string{"credit", "monthly"}, false},
		{"empty search", []string{"credit", "card"}, []string{}, true},
		{"empty entry tags", []string{}, []string{"credit"}, false},
		{"exact match", []string{"test"}, []string{"test"}, true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			entry := &Entry{Tags: tc.entryTags}
			
			// Test if entry has all specified tags
			hasAll := true
			for _, tag := range tc.searchTags {
				if !entry.HasTag(tag) {
					hasAll = false
					break
				}
			}
			
			if hasAll != tc.expected {
				t.Errorf("Expected entry with tags %v to have all tags %v: %v, got %v", 
					tc.entryTags, tc.searchTags, tc.expected, hasAll)
			}
		})
	}
}