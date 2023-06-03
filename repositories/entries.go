package repositories

import (
	"encoding/json"
	"fmt"
	"net/http"
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
	GetEntriesByMonth(time.Time, string) ([]Entry, error)
	GetEntriesFromTo(time.Time, time.Time, string) ([]Entry, error)
}

type ToshlEntriesRepo struct{}

func (t *ToshlEntriesRepo) PutEntry(entry MinimalEntry) error {
	path := fmt.Sprintf("entries/%s?update=one&immediate_update=true", entry.ID)
	e, err := json.Marshal(entry)
	if err != nil {
		fmt.Printf("Failed to unmarshal entry.")
	}
	payload := strings.NewReader(string(e))
	_, _, err = doToshlRequest("PUT", path, payload)
	if err != nil {
		return err
	}
	return nil
}

func (t *ToshlEntriesRepo) GetEntriesByMonth(monthYear time.Time, tags string) ([]Entry, error) {
	currentLocation, _ := time.LoadLocation(Configs.TimeZone)
	firstOfMonth := time.Date(monthYear.Year(), monthYear.Month(), 1, 0, 0, 0, 0, currentLocation)
	lastOfMonth := firstOfMonth.AddDate(0, 1, -1)
	return t.GetEntriesFromTo(firstOfMonth, lastOfMonth, tags)
}

func (t *ToshlEntriesRepo) GetEntriesFromTo(from time.Time, to time.Time, tags string) ([]Entry, error) {
	var entries []Entry
	var page = 0

	for {
		var path string
		if tags != "" {
			path = fmt.Sprintf("entries?from=%s&to=%s&tags=%s&page=%d", from.Format("2006-01-02"), to.Format("2006-01-02"), tags, page)
		} else {
			path = fmt.Sprintf("entries?from=%s&to=%s&page=%d", from.Format("2006-01-02"), to.Format("2006-01-02"), page)
		}

		body, header, err := doToshlRequest("GET", path, nil)
		if err != nil {
			return nil, err
		}

		// Parse the entries from the response body
		var pageEntries []Entry
		err = json.Unmarshal([]byte(body), &pageEntries)
		if err != nil {
			return nil, err
		}

		// Add the current page entries to the overall list
		entries = append(entries, pageEntries...)

		// Check if there are more pages to retrieve
		linkHeader := getLinkHeaderFromResponseHeader(header)
		nextURL, hasNext := linkHeader["next"]
		if !hasNext {
			break
		}

		// Update the page number to retrieve the next page
		page++
	}
	return entries, nil
}

func getLinkHeaderFromResponseHeader(header http.Header) map[string]string {
	linkHeader := make(map[string]string)
	if linkStr := header.Get("Link"); linkStr != "" {
		for _, link := range strings.Split(linkStr, ",") {
			parts := strings.Split(strings.TrimSpace(link), ";")
			if len(parts) >= 2 {
				url := strings.Trim(parts[0], "<>")
				rel := strings.TrimPrefix(strings.TrimSpace(parts[1]), "rel=")
				rel = strings.Trim(rel, "\"")
				linkHeader[rel] = url
			}
		}
	}
	return linkHeader
}
