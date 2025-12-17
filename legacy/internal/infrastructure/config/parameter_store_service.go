package config

import (
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/service/ssm"
	"github.com/aws/aws-sdk-go/service/ssm/ssmiface"
)

// CreditCard represents a credit card configuration
type CreditCard struct {
	Currencies []string `json:"currencies"`
	Tags       []string `json:"tags"`
}

// ParameterStoreConfig represents the configuration stored in Parameter Store
type ParameterStoreConfig struct {
	Currency    string                    `json:"currency"`
	Conversions map[string]float64        `json:"conversions"`
	Symbols     map[string]string         `json:"symbols"`
	CreditCards map[string]*CreditCard    `json:"credit_cards"`
	Budgeting   struct {
		AmountPerDay float64 `json:"amountPerDay"`
	} `json:"budgeting"`
}

// ParameterStoreService handles operations with AWS Parameter Store
type ParameterStoreService struct {
	client        ssmiface.SSMAPI
	parameterName string
}

// NewParameterStoreService creates a new Parameter Store service
func NewParameterStoreService(client *ssm.SSM, parameterName string) *ParameterStoreService {
	return &ParameterStoreService{
		client:        client,
		parameterName: parameterName,
	}
}

// NewParameterStoreServiceWithInterface creates a new Parameter Store service with interface (for testing)
func NewParameterStoreServiceWithInterface(client ssmiface.SSMAPI, parameterName string) *ParameterStoreService {
	return &ParameterStoreService{
		client:        client,
		parameterName: parameterName,
	}
}

// GetConfig retrieves the configuration from Parameter Store
func (p *ParameterStoreService) GetConfig() (*ParameterStoreConfig, error) {
	result, err := p.client.GetParameter(&ssm.GetParameterInput{
		Name:           aws.String(p.parameterName),
		WithDecryption: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get parameter from Parameter Store: %w", err)
	}

	var config ParameterStoreConfig
	err = json.Unmarshal([]byte(*result.Parameter.Value), &config)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal parameter configuration: %w", err)
	}

	return &config, nil
}

// UpdateConfig updates the configuration in Parameter Store
func (p *ParameterStoreService) UpdateConfig(config *ParameterStoreConfig) error {
	configJSON, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to marshal configuration: %w", err)
	}

	_, err = p.client.PutParameter(&ssm.PutParameterInput{
		Name:      aws.String(p.parameterName),
		Value:     aws.String(string(configJSON)),
		Type:      aws.String("SecureString"),
		Overwrite: aws.Bool(true),
	})
	if err != nil {
		return fmt.Errorf("failed to update parameter in Parameter Store: %w", err)
	}

	return nil
}

// GetStringValue gets a string value from the configuration
func (p *ParameterStoreService) GetStringValue(key string) (string, error) {
	config, err := p.GetConfig()
	if err != nil {
		return "", err
	}

	switch key {
	case "CURRENCY":
		return config.Currency, nil
	default:
		return "", fmt.Errorf("unknown string parameter: %s", key)
	}
}

// GetFloatValue gets a float value from the configuration
func (p *ParameterStoreService) GetFloatValue(key string) (float64, error) {
	config, err := p.GetConfig()
	if err != nil {
		return 0, err
	}

	switch key {
	case "ApD":
		return config.Budgeting.AmountPerDay, nil
	default:
		if rate, exists := config.Conversions[key]; exists {
			return rate, nil
		}
		return 0, fmt.Errorf("unknown float parameter: %s", key)
	}
}

// SetStringValue sets a string value in the configuration
func (p *ParameterStoreService) SetStringValue(key, value string) error {
	config, err := p.GetConfig()
	if err != nil {
		// If parameter doesn't exist, create default config
		config = &ParameterStoreConfig{
			Currency:    "EUR",
			Conversions: make(map[string]float64),
			Symbols:     make(map[string]string),
			CreditCards: make(map[string]*CreditCard),
		}
		config.Budgeting.AmountPerDay = 100.0
	}

	switch key {
	case "CURRENCY":
		config.Currency = value
	default:
		return fmt.Errorf("unknown string parameter: %s", key)
	}

	return p.UpdateConfig(config)
}

// GetCurrencySymbol gets the display symbol for the currency
func (p *ParameterStoreService) GetCurrencySymbol() (string, error) {
	config, err := p.GetConfig()
	if err != nil {
		return "", err
	}
	
	// First check if there's a symbol defined for the currency
	if symbol, exists := config.Symbols[config.Currency]; exists && symbol != "" {
		return symbol, nil
	}
	
	// Fallback to currency code
	return config.Currency, nil
}

// SetCurrencySymbol sets the display symbol for a currency
func (p *ParameterStoreService) SetCurrencySymbol(currency, symbol string) error {
	config, err := p.GetConfig()
	if err != nil {
		// If parameter doesn't exist, create default config
		config = &ParameterStoreConfig{
			Currency:    "EUR",
			Conversions: make(map[string]float64),
			Symbols:     make(map[string]string),
		}
		config.Budgeting.AmountPerDay = 100.0
	}
	
	if config.Symbols == nil {
		config.Symbols = make(map[string]string)
	}
	
	config.Symbols[currency] = symbol
	return p.UpdateConfig(config)
}

// GetSymbol gets the display symbol for any currency code
func (p *ParameterStoreService) GetSymbol(currency string) (string, error) {
	config, err := p.GetConfig()
	if err != nil {
		return currency, nil // fallback to currency code
	}
	
	if symbol, exists := config.Symbols[currency]; exists && symbol != "" {
		return symbol, nil
	}
	
	return currency, nil // fallback to currency code
}

// SetFloatValue sets a float value in the configuration
func (p *ParameterStoreService) SetFloatValue(key string, value float64) error {
	config, err := p.GetConfig()
	if err != nil {
		// If parameter doesn't exist, create default config
		config = &ParameterStoreConfig{
			Currency:    "EUR",
			Conversions: make(map[string]float64),
			Symbols:     make(map[string]string),
			CreditCards: make(map[string]*CreditCard),
		}
		config.Budgeting.AmountPerDay = 100.0
	}

	switch key {
	case "ApD":
		config.Budgeting.AmountPerDay = value
	default:
		// Assume it's a conversion rate
		config.Conversions[key] = value
	}

	return p.UpdateConfig(config)
}

// GetCreditCardCurrencies gets the currencies for a credit card
func (p *ParameterStoreService) GetCreditCardCurrencies(cardCode string) ([]string, error) {
	config, err := p.GetConfig()
	if err != nil {
		return nil, err
	}
	
	if config.CreditCards == nil {
		return nil, fmt.Errorf("no credit cards configured")
	}
	
	creditCard, exists := config.CreditCards[cardCode]
	if !exists {
		return nil, fmt.Errorf("credit card %s not found", cardCode)
	}
	
	return creditCard.Currencies, nil
}

// GetCreditCardTags gets the tags for a credit card
func (p *ParameterStoreService) GetCreditCardTags(cardCode string) ([]string, error) {
	config, err := p.GetConfig()
	if err != nil {
		return nil, err
	}
	
	if config.CreditCards == nil {
		return nil, fmt.Errorf("no credit cards configured")
	}
	
	creditCard, exists := config.CreditCards[cardCode]
	if !exists {
		return nil, fmt.Errorf("credit card %s not found", cardCode)
	}
	
	return creditCard.Tags, nil
}

// GetCreditCards gets all configured credit cards
func (p *ParameterStoreService) GetCreditCards() (map[string]*CreditCard, error) {
	config, err := p.GetConfig()
	if err != nil {
		return nil, err
	}
	
	if config.CreditCards == nil {
		return make(map[string]*CreditCard), nil
	}
	
	return config.CreditCards, nil
}