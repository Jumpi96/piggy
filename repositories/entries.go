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

func PayCreditEntry(entry MinimalEntry) error {
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

func GetCreditEntriesByMonth(monthYear string) []Entry {
	currentLocation := time.Now().Location()
	currentYear, _ := strconv.Atoi(monthYear[:4])
	currentMonth, _ := strconv.Atoi(monthYear[5:])
	firstOfMonth := time.Date(currentYear, time.Month(currentMonth), 1, 0, 0, 0, 0, currentLocation)
	lastOfMonth := firstOfMonth.AddDate(0, 1, -1)
	path := fmt.Sprintf("entries?from=%s&to=%s&tags=%s", firstOfMonth.Format("2006-01-02"), lastOfMonth.Format("2006-01-02"), config.CreditTag)
	var entries []Entry
	body, err := doToshlRequest("GET", path, nil)
	if err != nil {
		panic(err)
	}
	json.Unmarshal([]byte(body), &entries)
	return entries
}

func GetEntriesByMonth(monthYear string) []Entry {
	currentLocation := time.Now().Location()
	currentYear, _ := strconv.Atoi(monthYear[:4])
	currentMonth, _ := strconv.Atoi(monthYear[5:])
	firstOfMonth := time.Date(currentYear, time.Month(currentMonth), 1, 0, 0, 0, 0, currentLocation)
	lastOfMonth := firstOfMonth.AddDate(0, 1, -1)
	path := fmt.Sprintf("entries?from=%s&to=%s", firstOfMonth.Format("2006-01-02"), lastOfMonth.Format("2006-01-02"))
	var entries []Entry
	body, err := doToshlRequest("GET", path, nil)
	if err != nil {
		panic(err)
	}
	json.Unmarshal([]byte(body), &entries)
	return entries
}
