package repositories

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"piggy/internal/domain/entities"
	"piggy/internal/domain/repositories"
	"piggy/internal/infrastructure/external"
)

// ToshlClientInterface defines the interface for Toshl client operations
type ToshlClientInterface interface {
	DoRequest(verb, url string, payload io.Reader) ([]byte, map[string][]string, error)
}

// ToshlEntryRepository implements EntryRepository using Toshl API
type ToshlEntryRepository struct {
	toshlClient ToshlClientInterface
	timeZone    string
}

// NewToshlEntryRepository creates a new Toshl entry repository
func NewToshlEntryRepository(toshlClient *external.ToshlClient, timeZone string) repositories.EntryRepository {
	return &ToshlEntryRepository{
		toshlClient: toshlClient,
		timeZone:    timeZone,
	}
}

// NewToshlEntryRepositoryWithInterface creates a new Toshl entry repository with interface (for testing)
func NewToshlEntryRepositoryWithInterface(toshlClient ToshlClientInterface, timeZone string) repositories.EntryRepository {
	return &ToshlEntryRepository{
		toshlClient: toshlClient,
		timeZone:    timeZone,
	}
}

// GetByMonth retrieves entries for a specific month and optional tags
func (r *ToshlEntryRepository) GetByMonth(monthYear time.Time, tags string) ([]entities.Entry, error) {
	currentLocation, _ := time.LoadLocation(r.timeZone)
	firstOfMonth := time.Date(monthYear.Year(), monthYear.Month(), 1, 0, 0, 0, 0, currentLocation)
	lastOfMonth := firstOfMonth.AddDate(0, 1, -1)
	return r.GetFromTo(firstOfMonth, lastOfMonth, tags)
}

// GetFromTo retrieves entries within a date range
func (r *ToshlEntryRepository) GetFromTo(from, to time.Time, tags string) ([]entities.Entry, error) {
	var entries []entities.Entry
	var page = 0

	for {
		var path string
		if tags != "" {
			path = fmt.Sprintf("entries?from=%s&to=%s&tags=%s&page=%d", 
				from.Format("2006-01-02"), to.Format("2006-01-02"), tags, page)
		} else {
			path = fmt.Sprintf("entries?from=%s&to=%s&page=%d", 
				from.Format("2006-01-02"), to.Format("2006-01-02"), page)
		}

		body, header, err := r.toshlClient.DoRequest("GET", path, nil)
		if err != nil {
			return nil, err
		}

		// Parse the entries from the response body
		var pageEntries []entities.Entry
		err = json.Unmarshal(body, &pageEntries)
		if err != nil {
			return nil, err
		}

		// Add the current page entries to the overall list
		entries = append(entries, pageEntries...)

		// Check if there are more pages to retrieve
		linkHeader := r.getLinkHeaderFromResponseHeader(header)
		_, hasNext := linkHeader["next"]
		if !hasNext {
			break
		}

		// Update the page number to retrieve the next page
		page++
	}
	
	return entries, nil
}

// Update updates an existing entry
func (r *ToshlEntryRepository) Update(entry entities.MinimalEntry) error {
	path := fmt.Sprintf("entries/%s?update=one&immediate_update=true", entry.ID)
	
	e, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("failed to marshal entry: %w", err)
	}
	
	payload := strings.NewReader(string(e))
	_, _, err = r.toshlClient.DoRequest("PUT", path, payload)
	if err != nil {
		return err
	}
	
	return nil
}

// Create creates a new entry
func (r *ToshlEntryRepository) Create(entry entities.MinimalEntry) error {
	e, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("failed to marshal entry: %w", err)
	}
	
	payload := strings.NewReader(string(e))
	_, _, err = r.toshlClient.DoRequest("POST", "entries", payload)
	if err != nil {
		return err
	}
	
	return nil
}

// getLinkHeaderFromResponseHeader parses Link header for pagination
func (r *ToshlEntryRepository) getLinkHeaderFromResponseHeader(header map[string][]string) map[string]string {
	linkHeader := make(map[string]string)
	
	linkValues, exists := header["Link"]
	if !exists || len(linkValues) == 0 {
		return linkHeader
	}
	
	linkStr := linkValues[0]
	if linkStr != "" {
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