package services

import "time"

// ConfigService defines the interface for configuration operations
type ConfigService interface {
	// GetCreditTags returns the credit tags for a specific country
	GetCreditTags(countryCode string) []string

	// GetBalanceTags returns the balance tags
	GetBalanceTags() []string

	// GetTimeZone returns the configured timezone
	GetTimeZone() string

	// GetTelegramUser returns the authorized telegram user
	GetTelegramUser() string

	// GetRequestTimeout returns the maximum time a request is allowed to run
	GetRequestTimeout() time.Duration
}
