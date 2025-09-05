package config

import (
	"os"
	"strings"

	"piggy/internal/domain/services"
)

// ConfigServiceImpl implements the ConfigService interface
type ConfigServiceImpl struct {
	creditNLTags   []string
	creditARTags   []string
	balanceTags    []string
	timeZone       string
	telegramUser   string
}

// NewConfigService creates a new configuration service
func NewConfigService() services.ConfigService {
	return &ConfigServiceImpl{
		creditNLTags:   parseCommaSeparated(getEnv("CREDIT_NL_TAG", "123456")),
		creditARTags:   parseCommaSeparated(getEnv("CREDIT_TAG", "123456")),
		balanceTags:    parseCommaSeparated(getEnv("BALANCE_TAG", "123456")),
		timeZone:       getEnv("TIME_ZONE", "Europe/Amsterdam"),
		telegramUser:   os.Getenv("TELEGRAM_USER"),
	}
}

// GetCreditTags returns the credit tags for a specific country
func (c *ConfigServiceImpl) GetCreditTags(countryCode string) []string {
	switch countryCode {
	case "NL":
		return c.creditNLTags
	case "AR":
		return c.creditARTags
	default:
		return c.creditARTags // Default to AR
	}
}

// GetBalanceTags returns the balance tags
func (c *ConfigServiceImpl) GetBalanceTags() []string {
	return c.balanceTags
}

// GetTimeZone returns the configured timezone
func (c *ConfigServiceImpl) GetTimeZone() string {
	return c.timeZone
}

// GetTelegramUser returns the authorized telegram user
func (c *ConfigServiceImpl) GetTelegramUser() string {
	return c.telegramUser
}

// Helper functions
func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if len(value) == 0 {
		return defaultValue
	}
	return value
}

func parseCommaSeparated(value string) []string {
	if value == "" {
		return []string{}
	}
	
	tags := strings.Split(value, ",")
	// Trim whitespace from each tag
	for i, tag := range tags {
		tags[i] = strings.TrimSpace(tag)
	}
	
	return tags
}