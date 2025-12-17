package repositories

import (
	"time"

	"piggy/internal/domain/entities"
)

// EntryRepository defines the interface for entry data operations
type EntryRepository interface {
	// GetByMonth retrieves entries for a specific month and optional tags
	GetByMonth(monthYear time.Time, tags string) ([]entities.Entry, error)
	
	// GetFromTo retrieves entries within a date range
	GetFromTo(from, to time.Time, tags string) ([]entities.Entry, error)
	
	// Update updates an existing entry
	Update(entry entities.MinimalEntry) error
	
	// Create creates a new entry
	Create(entry entities.MinimalEntry) error
}