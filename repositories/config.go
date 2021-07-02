package repositories

import (
	"os"
)

// Config type to represent configuration values.
type Config struct {
	CreditNLTag   string
	ToshlToken    string
	CreditTag     string
	TelegramToken string
	TelegramUser  string
	TimeZone      string
}

// Configs represent a singleton with configuration values.
var Configs Config = Config{
	CreditNLTag:   getEnv("CREDIT_NL_TAG", "123456"),
	ToshlToken:    os.Getenv("TOSHL_TOKEN"),
	TelegramToken: os.Getenv("TELEGRAM_TOKEN"),
	CreditTag:     getEnv("CREDIT_TAG", "123456"),
	TelegramUser:  os.Getenv("TELEGRAM_USER"),
	TimeZone:      getEnv("TIME_ZONE", "Europe/Amsterdam"),
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if len(value) == 0 {
		return defaultValue
	}
	return value
}
