package services

import (
	"reflect"
	"testing"
	"time"

	entries "../repositories"
	repository "../repositories"
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

var sampleNonCreditEntry = repository.Entry{
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
	paidEntry := payEntry(entry, usdToArs)
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
	paidEntry := payEntry(entry, usdToArs)
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
	paidEntry := payEntry(entry, usdToArs)
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

func (m *mockEntriesRepo) PayCreditEntry(entry entries.MinimalEntry) error {
	return nil
}

func (m *mockEntriesRepo) GetEntriesByMonth(monthYear string, credit bool) []entries.Entry {
	if credit {
		return []entries.Entry{sampleEntry}
	} else {
		return []entries.Entry{sampleNonCreditEntry, sampleEntry}
	}
}
func TestConfirmCreditPayment(t *testing.T) {
	repo := &mockEntriesRepo{}
	err := ConfirmCreditPayment(repo, "2020-06", 93.0)
	if err != nil {
		t.Errorf("Error: %v.", err)
	}
}

func TestGetCreditCardStatus(t *testing.T) {
	repo := &mockEntriesRepo{}
	response, items := GetCreditCardStatus(repo, "2020-06", 93.0)

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
	response, days := GetMonthStatus(repo, "2020-06", 1180, 93.0)

	if len(days) != daysUntilEndOfMonth("2020-06") {
		t.Errorf("Found days until end of month: %v.", daysUntilEndOfMonth("2020-06"))
	}

	if response["diff"] != -498.34 {
		t.Errorf("Should have found %v. Found: %v.", -498.34, response["diff"])
	}

	if response["cash"] != -498.34 {
		t.Errorf("Should have found %v. Found: %v.", -498.34, response["cash"])
	}
}

func contains(s []string, e string) bool {
	for _, a := range s {
		if a == e {
			return true
		}
	}
	return false
}
