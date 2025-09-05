package entities

import (
	"time"
)

// Entry represents a financial entry with complete information
type Entry struct {
	ID       string    `json:"id"`
	Amount   float64   `json:"amount"`
	Currency Currency  `json:"currency"`
	Date     string    `json:"date"`
	Desc     string    `json:"desc"`
	Account  string    `json:"account"`
	Category string    `json:"category"`
	Tags     []string  `json:"tags"`
	Created  time.Time `json:"created"`
	Modified string    `json:"modified"`
	Repeat   struct {
		ID        string `json:"id"`
		Start     string `json:"start"`
		Frequency string `json:"frequency"`
		Interval  int    `json:"interval"`
		Iteration int    `json:"iteration"`
		Template  bool   `json:"template"`
		Type      string `json:"type"`
	} `json:"repeat"`
	Reminders []struct {
		Period string `json:"period"`
		Number int    `json:"number"`
		At     string `json:"at"`
	} `json:"reminders"`
	Completed bool `json:"completed"`
	Deleted   bool `json:"deleted"`
}

// MinimalEntry represents a simplified financial entry for updates
type MinimalEntry struct {
	ID        string   `json:"id"`
	Amount    float64  `json:"amount"`
	Currency  Currency `json:"currency"`
	Date      string   `json:"date"`
	Account   string   `json:"account"`
	Category  string   `json:"category"`
	Tags      []string `json:"tags"`
	Modified  string   `json:"modified"`
	Completed bool     `json:"completed"`
}

// IsCompleted returns whether the entry is completed
func (e Entry) IsCompleted() bool {
	return e.Completed
}

// IsDeleted returns whether the entry is deleted
func (e Entry) IsDeleted() bool {
	return e.Deleted
}

// HasTag checks if entry has a specific tag
func (e Entry) HasTag(tag string) bool {
	for _, t := range e.Tags {
		if t == tag {
			return true
		}
	}
	return false
}

// GetDateAsTime parses the date string and returns time.Time
func (e Entry) GetDateAsTime() (time.Time, error) {
	return time.Parse("2006-01-02", e.Date)
}

// IsExpense returns true if the entry represents an expense (negative amount)
func (e Entry) IsExpense() bool {
	return e.Amount < 0
}

// IsIncome returns true if the entry represents income (positive amount)
func (e Entry) IsIncome() bool {
	return e.Amount > 0
}