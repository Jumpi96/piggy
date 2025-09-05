package services

import (
	"reflect"
	"testing"
	"time"

	entries "piggy/repositories"
	repository "piggy/repositories"
)

var sampleEntry = repository.Entry{
	ID:     "1929518-5",
	Amount: -249.17,
	Currency: repository.Currency{
		Code:     "ARS",
		Rate:     1.0,
		MainRate: 1.0,
		Fixed:    true,
	},
	Date:      "2020-05-01",
	Desc:      "",
	Account:   "2974789",
	Category:  "59834974",
	Tags:      []string{"35495917", "123456"},
	Created:   time.Now(),
	Modified:  "2020-04-01 21:19:08.222",
	Completed: false,
	Deleted:   false,
}

var sampleSalaryEntry = repository.Entry{
	ID:     "1929518-5",
	Amount: 200,
	Currency: repository.Currency{
		Code:     "EUR",
		Rate:     1.0,
		MainRate: 1.0,
		Fixed:    true,
	},
	Date:      "2020-05-01",
	Desc:      "",
	Account:   "2974789",
	Category:  "59834974",
	Tags:      []string{},
	Created:   time.Now(),
	Modified:  "2020-04-01 21:19:08.222",
	Completed: false,
	Deleted:   false,
}

var sampleNonCreditEntry = repository.Entry{
	ID:     "1929518-5",
	Amount: -100,
	Currency: repository.Currency{
		Code:     "EUR",
		Rate:     1.0,
		MainRate: 1.0,
		Fixed:    true,
	},
	Date:      "2020-05-01",
	Desc:      "",
	Account:   "2974789",
	Category:  "59834974",
	Tags:      []string{},
	Created:   time.Now(),
	Modified:  "2020-04-01 21:19:08.222",
	Completed: false,
	Deleted:   false,
}

func TestPayUSDEntry(t *testing.T) {
	entry := sampleEntry
	entry.Currency = repository.Currency{
		Code:     "USD",
		Rate:     0.01540025,
		MainRate: 0.01540025,
		Fixed:    false,
	}
	usdToArs := 83.0
	paidEntry := payEntry(entry, entries.Configs.CreditTag, usdToArs)
	if paidEntry.Currency.Code != "ARS" {
		t.Errorf("Currency code was incorrect, got: %s, want: %s.", paidEntry.Currency.Code, "ARS")
	} else if contains(paidEntry.Tags, "123456") {
		t.Errorf("Tags were incorrect, got: %v, want without: %s.", paidEntry.Tags, "123456")
	} else if !paidEntry.Completed {
		t.Error("Entry not completed")
	} else if paidEntry.Amount != usdToArs*entry.Amount {
		t.Errorf("Amount was incorrect, got: %0.2f, want: %0.2f.", paidEntry.Amount, usdToArs*entry.Amount)
	}
}

func TestPayARSEntry(t *testing.T) {
	entry := sampleEntry
	usdToArs := 83.0
	paidEntry := payEntry(entry, entries.Configs.CreditTag, usdToArs)
	if paidEntry.Currency.Code != "ARS" {
		t.Errorf("Currency code was incorrect, got: %s, want: %s.", paidEntry.Currency.Code, "ARS")
	} else if contains(paidEntry.Tags, "123456") {
		t.Errorf("Tags were incorrect, got: %v, want without: %s.", paidEntry.Tags, "123456")
	} else if !paidEntry.Completed {
		t.Error("Entry not completed")
	} else if paidEntry.Amount != entry.Amount {
		t.Errorf("Amount was incorrect, got: %0.2f, want: %0.2f.", paidEntry.Amount, entry.Amount)
	}
}

func TestPayCreditEntry(t *testing.T) {
	entry := sampleEntry
	usdToArs := 83.0
	paidEntry := payEntry(entry, entries.Configs.CreditTag, usdToArs)
	if paidEntry.Currency.Code != "ARS" {
		t.Errorf("Currency code was incorrect, got: %s, want: %s.", paidEntry.Currency.Code, "ARS")
	} else if reflect.DeepEqual(paidEntry.Tags, []string{"123456"}) {
		t.Errorf("Tags were incorrect, got: %v, want: %s.", paidEntry.Tags, "123456")
	} else if !paidEntry.Completed {
		t.Error("Entry not completed")
	} else if paidEntry.Amount != entry.Amount {
		t.Errorf("Amount was incorrect, got: %0.2f, want: %0.2f.", paidEntry.Amount, entry.Amount)
	}
}

type mockEntriesRepo struct{}

func (m *mockEntriesRepo) PutEntry(entry entries.MinimalEntry) error {
	return nil
}

func (m *mockEntriesRepo) GetEntriesByMonth(monthYear time.Time, tags string) ([]entries.Entry, error) {
	return m.GetEntriesFromTo(time.Now(), time.Now(), tags)
}

func (m *mockEntriesRepo) GetEntriesFromTo(from time.Time, to time.Time, tags string) ([]entries.Entry, error) {
	if tags != "" {
		return []entries.Entry{sampleEntry}, nil
	} else {
		return []entries.Entry{sampleNonCreditEntry, sampleSalaryEntry}, nil
	}
}

func TestConfirmCreditPayment(t *testing.T) {
	repo := &mockEntriesRepo{}
	err := ConfirmCreditPayment(repo, time.Now(), entries.Configs.CreditTag, 93.0)
	if err != nil {
		t.Errorf("Error: %v.", err)
	}
}

func TestGetCreditCardStatus(t *testing.T) {
	repo := &mockEntriesRepo{}
	response, items, _ := GetCreditCardStatus(repo, time.Now(), 93.0, entries.Configs.CreditTag)

	if len(items) != 1 {
		t.Errorf("Should have found %v item. Found: %v.", 1, len(items))
	}

	if response["amountUSD"] != 0 {
		t.Errorf("Should have found %v item. Found: %v.", 0, response["amountUSD"])
	}

	if response["amountARS"] != 249.17 {
		t.Errorf("Should have found %v item. Found: %v.", 249.17, response["amountARS"])
	}

	if response["total"] != 249.17 {
		t.Errorf("Should have found %v item. Found: %v.", 249.17, response["total"])
	}
}

func TestGetMonthStatus(t *testing.T) {
	repo := &mockEntriesRepo{}
	year, month, day := time.Now().Date()
	currentLocation, _ := time.LoadLocation(entries.Configs.TimeZone)
	today := time.Date(year, month, day, 0, 0, 0, 0, currentLocation)
	monthYear := time.Date(year, month, 1, 0, 0, 0, 0, currentLocation)

	response, days, _ := GetMonthStatus(repo, today, 1180, 1.21, 100)

	if len(days) != daysUntilEndOfMonth(monthYear, today) {
		t.Errorf("Found days until end of month: %v %v.", len(days), daysUntilEndOfMonth(monthYear, today))
	}

	if response["diff"] != 100 {
		t.Errorf("Should have found %v. Found: %v.", 100, response["diff"])
	}

	if response["cash"] != 100 {
		t.Errorf("Should have found %v. Found: %v.", 100, response["cash"])
	}
}

type mockEntriesRepoForSetCurrencies struct{}

func (m *mockEntriesRepoForSetCurrencies) PutEntry(entry entries.MinimalEntry) error {
	return nil
}

func (m *mockEntriesRepoForSetCurrencies) GetEntriesByMonth(monthYear time.Time, tags string) ([]entries.Entry, error) {
	arsEntry := repository.Entry{
		ID:     "ars-entry",
		Amount: -100.0,
		Currency: repository.Currency{
			Code:     "ARS",
			Rate:     1.0,
			MainRate: 1.0,
			Fixed:    false,
		},
		Date:      "2020-05-01",
		Account:   "test-account",
		Category:  "test-category",
		Tags:      []string{},
		Created:   time.Now(),
		Modified:  "2020-04-01 21:19:08.222",
		Completed: false,
		Deleted:   false,
	}

	eurEntry := repository.Entry{
		ID:     "eur-entry",
		Amount: -50.0,
		Currency: repository.Currency{
			Code:     "EUR",
			Rate:     1.0,
			MainRate: 1.0,
			Fixed:    false,
		},
		Date:      "2020-05-01",
		Account:   "test-account",
		Category:  "test-category",
		Tags:      []string{},
		Created:   time.Now(),
		Modified:  "2020-04-01 21:19:08.222",
		Completed: false,
		Deleted:   false,
	}

	return []entries.Entry{arsEntry, eurEntry}, nil
}

func (m *mockEntriesRepoForSetCurrencies) GetEntriesFromTo(from time.Time, to time.Time, tags string) ([]entries.Entry, error) {
	return m.GetEntriesByMonth(from, tags)
}

func TestSetCurrencies(t *testing.T) {
	repo := &mockEntriesRepoForSetCurrencies{}
	count, err := SetCurrencies(repo, time.Now(), 100.0, 1.2)
	
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	
	if count != 1 {
		t.Errorf("Expected 1 ARS entry to be updated, got: %d", count)
	}
}

type mockEntriesRepoForGetBalance struct{}

func (m *mockEntriesRepoForGetBalance) PutEntry(entry entries.MinimalEntry) error {
	return nil
}

func (m *mockEntriesRepoForGetBalance) GetEntriesByMonth(monthYear time.Time, tags string) ([]entries.Entry, error) {
	return nil, nil
}

func (m *mockEntriesRepoForGetBalance) GetEntriesFromTo(from time.Time, to time.Time, tags string) ([]entries.Entry, error) {
	eurEntry := repository.Entry{
		ID:     "eur-entry",
		Amount: -100.0,
		Currency: repository.Currency{Code: "EUR"},
		Date:      "2020-05-01",
	}

	arsEntry := repository.Entry{
		ID:     "ars-entry", 
		Amount: -120.0,
		Currency: repository.Currency{Code: "ARS"},
		Date:      "2020-05-01",
	}

	usdEntry := repository.Entry{
		ID:     "usd-entry",
		Amount: -50.0, 
		Currency: repository.Currency{Code: "USD"},
		Date:      "2020-05-01",
	}

	return []entries.Entry{eurEntry, arsEntry, usdEntry}, nil
}

func TestGetBalance(t *testing.T) {
	repo := &mockEntriesRepoForGetBalance{}
	fromDate := time.Date(2020, 5, 1, 0, 0, 0, 0, time.UTC)
	toDate := time.Date(2020, 5, 31, 0, 0, 0, 0, time.UTC)
	amountPerDay := 10.0
	usdToArs := 100.0
	eurToUsd := 1.2

	result, err := GetBalance(repo, fromDate, toDate, amountPerDay, usdToArs, eurToUsd)
	
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}

	// EUR: -100, ARS: -120/(100*1.2) = -1, USD: -50/1.2 = -41.67
	// Total: -100 + (-1) + (-41.67) = -142.67
	expectedDiff := -100.0 + (-120.0/(usdToArs*eurToUsd)) + (-50.0/eurToUsd)
	if result["diff"] < expectedDiff-0.1 || result["diff"] > expectedDiff+0.1 {
		t.Errorf("Expected diff around %v, got: %v", expectedDiff, result["diff"])
	}

	// 31 days * 10 per day = 310, so dayRemainingDiff = expectedDiff - 310
	expectedDayRemaining := expectedDiff - (31 * amountPerDay)
	if result["dayRemainingDiff"] < expectedDayRemaining-0.1 || result["dayRemainingDiff"] > expectedDayRemaining+0.1 {
		t.Errorf("Expected dayRemainingDiff around %v, got: %v", expectedDayRemaining, result["dayRemainingDiff"])
	}
}

func TestSetEntry(t *testing.T) {
	entry := sampleEntry
	usdToArs := 100.0
	eurToUsd := 1.2

	result := setEntry(entry, usdToArs, eurToUsd)

	expectedRate := usdToArs * eurToUsd // 100 * 1.2 = 120
	if result.Currency.Rate != expectedRate {
		t.Errorf("Expected currency rate %v, got: %v", expectedRate, result.Currency.Rate)
	}

	if !result.Currency.Fixed {
		t.Error("Expected currency to be fixed")
	}

	if result.Currency.Code != entry.Currency.Code {
		t.Errorf("Expected currency code %v, got: %v", entry.Currency.Code, result.Currency.Code)
	}

	if result.Amount != entry.Amount {
		t.Errorf("Expected amount %v, got: %v", entry.Amount, result.Amount)
	}
}

func TestFormatDate(t *testing.T) {
	dateStr := "2020-05-15"
	result := formatDate(dateStr)

	expected := time.Date(2020, 5, 15, 0, 0, 0, 0, time.UTC)
	// Need to account for timezone difference
	if result.Year() != expected.Year() || result.Month() != expected.Month() || result.Day() != expected.Day() {
		t.Errorf("Expected date %v, got: %v", expected, result)
	}
}
