package repositories

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

type Entry struct {
	ID       string  `json:"id"`
	Amount   float64 `json:"amount"`
	Currency struct {
		Code     string  `json:"code"`
		Rate     float64 `json:"rate"`
		MainRate float64 `json:"main_rate"`
		Fixed    bool    `json:"fixed"`
	} `json:"currency"`
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

func GetEntriesByMonth(monthYear string) []Entry {
	currentLocation := time.Now().Location()
	currentYear, _ := strconv.Atoi(monthYear[:4])
	currentMonth, _ := strconv.Atoi(monthYear[5:])
	firstOfMonth := time.Date(currentYear, time.Month(currentMonth), 1, 0, 0, 0, 0, currentLocation)
	lastOfMonth := firstOfMonth.AddDate(0, 1, -1)
	path := fmt.Sprintf("entries?from=%s&to=%s", firstOfMonth.Format("2006-01-02"), lastOfMonth.Format("2006-01-02"))
	var entries []Entry
	json.Unmarshal([]byte(doToshlRequest("GET", path)), &entries)
	return entries
}
