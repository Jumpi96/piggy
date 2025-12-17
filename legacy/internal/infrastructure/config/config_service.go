package config

import (
	"os"
	"strconv"
	"strings"
	"time"

	"piggy/internal/domain/services"
)

// ConfigServiceImpl implements the ConfigService interface
type ConfigServiceImpl struct {
	parameterStore *ParameterStoreService
	balanceTags    []string
	timeZone       string
	telegramUser   string
	requestTimeout time.Duration
}

// NewConfigService creates a new configuration service
func NewConfigService(parameterStore *ParameterStoreService) services.ConfigService {
	return &ConfigServiceImpl{
		parameterStore: parameterStore,
		balanceTags:    parseCommaSeparated(getEnv("BALANCE_TAG", "123456")),
		timeZone:       getEnv("TIME_ZONE", "Europe/Amsterdam"),
		telegramUser:   os.Getenv("TELEGRAM_USER"),
		requestTimeout: time.Duration(getEnvInt("REQUEST_TIMEOUT_SECONDS", 55)) * time.Second,
	}
}

// GetCreditTags returns the credit tags for a specific country
func (c *ConfigServiceImpl) GetCreditTags(countryCode string) []string {
	tags, err := c.parameterStore.GetCreditCardTags(countryCode)
	if err != nil {
		// Return empty slice if credit card not found or error occurred
		return []string{}
	}
	return tags
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

// GetRequestTimeout returns the configured request timeout duration
func (c *ConfigServiceImpl) GetRequestTimeout() time.Duration {
	return c.requestTimeout
}

// Helper functions
func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if len(value) == 0 {
		return defaultValue
	}
	return value
}

func getEnvInt(key string, defaultValue int) int {
	value := os.Getenv(key)
	if len(value) == 0 {
		return defaultValue
	}

	if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
		return parsed
	}

	return defaultValue
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
