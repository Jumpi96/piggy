package services

import (
	"reflect"
	"testing"
	"time"

	repository "../repositories"
)

func TestPayUSDEntry(t *testing.T) {
	entry := repository.Entry{
		ID:     "1929518-5",
		Amount: -249.17,
		Currency: repository.Currency{
			Code:     "USD",
			Rate:     0.01540025,
			MainRate: 0.01540025,
			Fixed:    false,
		},
		Date:      "2020-05-01",
		Desc:      "",
		Account:   "2974789",
		Category:  "59834974",
		Tags:      []string{"35495917", "35538263"},
		Created:   time.Now(),
		Modified:  "2020-04-01 21:19:08.222",
		Completed: false,
		Deleted:   false,
	}
	usdToArs := 83.0
	paidEntry := payEntry(entry, usdToArs)
	if paidEntry.Currency.Code != "ARS" {
		t.Errorf("Currency code was incorrect, got: %s, want: %s.", paidEntry.Currency.Code, "ARS")
	} else if !contains(paidEntry.Tags, "35538263") {
		t.Errorf("Tags were incorrect, got: %v, want without: %s.", paidEntry.Tags, "35538263")
	} else if !paidEntry.Completed {
		t.Error("Entry not completed")
	} else if paidEntry.Amount != usdToArs*entry.Amount {
		t.Errorf("Amount was incorrect, got: %0.2f, want: %0.2f.", paidEntry.Amount, usdToArs*entry.Amount)
	}
}

func TestPayARSEntry(t *testing.T) {
	entry := repository.Entry{
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
		Tags:      []string{"35495917", "35538263"},
		Created:   time.Now(),
		Modified:  "2020-04-01 21:19:08.222",
		Completed: false,
		Deleted:   false,
	}
	usdToArs := 83.0
	paidEntry := payEntry(entry, usdToArs)
	if paidEntry.Currency.Code != "ARS" {
		t.Errorf("Currency code was incorrect, got: %s, want: %s.", paidEntry.Currency.Code, "ARS")
	} else if !contains(paidEntry.Tags, "35538263") {
		t.Errorf("Tags were incorrect, got: %v, want without: %s.", paidEntry.Tags, "35538263")
	} else if !paidEntry.Completed {
		t.Error("Entry not completed")
	} else if paidEntry.Amount != entry.Amount {
		t.Errorf("Amount was incorrect, got: %0.2f, want: %0.2f.", paidEntry.Amount, entry.Amount)
	}
}

func TestPayCreditEntry(t *testing.T) {
	entry := repository.Entry{
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
		Tags:      []string{"35495917", "35538263"},
		Created:   time.Now(),
		Modified:  "2020-04-01 21:19:08.222",
		Completed: false,
		Deleted:   false,
	}
	usdToArs := 83.0
	paidEntry := payEntry(entry, usdToArs)
	if paidEntry.Currency.Code != "ARS" {
		t.Errorf("Currency code was incorrect, got: %s, want: %s.", paidEntry.Currency.Code, "ARS")
	} else if reflect.DeepEqual(paidEntry.Tags, []string{"35538263"}) {
		t.Errorf("Tags were incorrect, got: %v, want: %s.", paidEntry.Tags, "35538263")
	} else if !paidEntry.Completed {
		t.Error("Entry not completed")
	} else if paidEntry.Amount != entry.Amount {
		t.Errorf("Amount was incorrect, got: %0.2f, want: %0.2f.", paidEntry.Amount, entry.Amount)
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
