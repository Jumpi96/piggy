package repositories

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type Currency struct {
	Code     string  `json:"code"`
	Rate     float64 `json:"rate"`
	MainRate float64 `json:"main_rate"`
	Fixed    bool    `json:"fixed"`
}

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

type EntriesRepo interface {
	PutEntry(MinimalEntry) error
	GetEntriesByMonth(string, string) []Entry
}

type ToshlEntriesRepo struct{}

func (t *ToshlEntriesRepo) PutEntry(entry MinimalEntry) error {
	path := fmt.Sprintf("entries/%s?update=one&immediate_update=true", entry.ID)
	e, err := json.Marshal(entry)
	if err != nil {
		fmt.Printf("Failed to unmarshal entry.")
	}
	payload := strings.NewReader(string(e))
	_, err = doToshlRequest("PUT", path, payload)
	if err != nil {
		return err
	}
	return nil
}

func (t *ToshlEntriesRepo) GetEntriesByMonth(monthYear string, tags string) []Entry {
	currentLocation, _ := time.LoadLocation(Configs.TimeZone)
	currentYear, _ := strconv.Atoi(monthYear[:4])
	currentMonth, _ := strconv.Atoi(monthYear[5:])
	firstOfMonth := time.Date(currentYear, time.Month(currentMonth), 1, 0, 0, 0, 0, currentLocation)
	lastOfMonth := firstOfMonth.AddDate(0, 1, -1)

	var path string
	if tags != "" {
		path = fmt.Sprintf("entries?from=%s&to=%s&tags=%s", firstOfMonth.Format("2006-01-02"), lastOfMonth.Format("2006-01-02"), tags)
	} else {
		path = fmt.Sprintf("entries?from=%s&to=%s", firstOfMonth.Format("2006-01-02"), lastOfMonth.Format("2006-01-02"))
	}

	var entries []Entry
	body, err := doToshlRequest("GET", path, nil)
	if err != nil {
		panic(err)
	}
	json.Unmarshal([]byte(body), &entries)
	return entries
}
