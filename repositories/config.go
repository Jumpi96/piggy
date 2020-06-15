package repositories

import (
	"os"
)

// Config type to represent configuration values.
type Config struct {
	ToshlToken    string
	CreditTag     string
	TelegramToken string
	TelegramUser  string
}

// Configs represent a singleton with configuration values.
var Configs Config = Config{
	ToshlToken:    os.Getenv("TOSHL_TOKEN"),
	TelegramToken: os.Getenv("TELEGRAM_TOKEN"),
	CreditTag:     os.Getenv("CREDIT_TAG"),
	TelegramUser:  os.Getenv("TELEGRAM_USER"),
}
