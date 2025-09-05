package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	appdto "piggy/internal/application/dto"
	"piggy/internal/application/usecases"
	"piggy/internal/domain/entities"
	"piggy/internal/domain/services"
	"piggy/internal/interfaces/dto"

	"github.com/aws/aws-lambda-go/events"
)

// Use case interfaces for dependency inversion
type CreditUseCaseInterface interface {
	GetCreditStatus(request appdto.CreditRequest) (*appdto.CreditResponse, error)
}

type StatusUseCaseInterface interface {
	GetMonthlyStatus(request appdto.StatusRequest) (*appdto.StatusResponse, error)
}

type BalanceUseCaseInterface interface {
	GetBalanceReport(request appdto.BalanceRequest) (*appdto.BalanceResponse, error)
}

type ParameterUseCaseInterface interface {
	SetParameter(key string, value float64) error
	GetParameter(key string) (*entities.Parameter, error)
	SetCurrencies(monthYear time.Time, usdToArs, eurToUsd float64) (int, error)
}

// TelegramController handles Telegram webhook requests
type TelegramController struct {
	creditUseCase    CreditUseCaseInterface
	statusUseCase    StatusUseCaseInterface
	balanceUseCase   BalanceUseCaseInterface
	parameterUseCase ParameterUseCaseInterface
	configService    services.ConfigService
	telegramToken    string
}

// NewTelegramController creates a new Telegram controller
func NewTelegramController(
	creditUseCase *usecases.CreditUseCase,
	statusUseCase *usecases.StatusUseCase,
	balanceUseCase *usecases.BalanceUseCase,
	parameterUseCase *usecases.ParameterUseCase,
	configService services.ConfigService,
	telegramToken string,
) *TelegramController {
	return &TelegramController{
		creditUseCase:    creditUseCase,
		statusUseCase:    statusUseCase,
		balanceUseCase:   balanceUseCase,
		parameterUseCase: parameterUseCase,
		configService:    configService,
		telegramToken:    telegramToken,
	}
}

// NewTelegramControllerWithInterfaces creates a new Telegram controller with interfaces (for testing)
func NewTelegramControllerWithInterfaces(
	creditUseCase CreditUseCaseInterface,
	statusUseCase StatusUseCaseInterface,
	balanceUseCase BalanceUseCaseInterface,
	parameterUseCase ParameterUseCaseInterface,
	configService services.ConfigService,
	telegramToken string,
) *TelegramController {
	return &TelegramController{
		creditUseCase:    creditUseCase,
		statusUseCase:    statusUseCase,
		balanceUseCase:   balanceUseCase,
		parameterUseCase: parameterUseCase,
		configService:    configService,
		telegramToken:    telegramToken,
	}
}

// HandleWebhook processes incoming Telegram webhooks
func (c *TelegramController) HandleWebhook(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var update dto.TelegramUpdate

	err := json.Unmarshal([]byte(request.Body), &update)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 400}, fmt.Errorf("failed to unmarshal request: %w", err)
	}

	// Route command and get response text
	responseText := c.routeCommand(update.Message.Text, update.Message.Chat.UserName)

	// Send response back to Telegram
	err = c.sendTelegramMessage(update.Message.Chat.ID, responseText)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500}, fmt.Errorf("failed to send telegram message: %w", err)
	}

	return events.APIGatewayProxyResponse{StatusCode: 200}, nil
}

// routeCommand routes incoming commands to appropriate handlers
func (c *TelegramController) routeCommand(message string, username string) string {
	// Check if user is authorized
	if username != c.configService.GetTelegramUser() {
		return "Sir, who are you?🤔"
	}

	// Define command patterns
	var (
		rStatus    = regexp.MustCompile(`\/status.*`)
		rBalance   = regexp.MustCompile(`\/balance.*`)
		rCredit    = regexp.MustCompile(`\/credit(AR|NL).*`)
		rPayCredit = regexp.MustCompile(`\/pay(AR|NL).*`)
		rSet       = regexp.MustCompile(`\/set.*`)
	)

	switch {
	case rStatus.MatchString(message):
		return c.handleStatusCommand(message)
	case rBalance.MatchString(message):
		return c.handleBalanceCommand(message)
	case rCredit.MatchString(message):
		return c.handleCreditCommand(message, false)
	case rPayCredit.MatchString(message):
		return c.handleCreditCommand(message, true)
	case rSet.MatchString(message):
		return c.handleSetCommand(message)
	}

	return "❓ Use one of the Piggy commands:\n /status\n /credit[CODE]\n /pay[CODE]\n /set\n /balance"
}

// sendTelegramMessage sends a message to Telegram
func (c *TelegramController) sendTelegramMessage(chatID int, text string) error {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", c.telegramToken)

	response := dto.TelegramResponse{
		ChatID: chatID,
		Text:   text,
	}

	message, err := json.Marshal(response)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(message))
	if err != nil {
		return err
	}

	req.Header.Add("Content-Type", "application/json")

	client := &http.Client{}
	_, err = client.Do(req)
	return err
}

// handleStatusCommand handles the /status command
func (c *TelegramController) handleStatusCommand(message string) string {
	// Parse message to get parameters
	monthYear, amountPerDay, eurToUsd, usdToArs, err := c.parseStatusCommand(message)
	if err != nil {
		return fmt.Sprintf("❓ %v", err)
	}

	request := appdto.StatusRequest{
		MonthYear:    monthYear,
		AmountPerDay: amountPerDay,
		EurToUsd:     eurToUsd,
		UsdToArs:     usdToArs,
	}

	response, err := c.statusUseCase.GetMonthlyStatus(request)
	if err != nil {
		return fmt.Sprintf("❌ Error getting status: %v", err)
	}

	return c.formatStatusResponse(response)
}

// handleBalanceCommand handles the /balance command  
func (c *TelegramController) handleBalanceCommand(message string) string {
	// Parse message to get parameters
	fromDate, toDate, amountPerDay, eurToUsd, usdToArs, err := c.parseBalanceCommand(message)
	if err != nil {
		return fmt.Sprintf("❓ %v", err)
	}

	request := appdto.BalanceRequest{
		FromDate:     fromDate,
		ToDate:       toDate,
		AmountPerDay: amountPerDay,
		UsdToArs:     usdToArs,
		EurToUsd:     eurToUsd,
	}

	response, err := c.balanceUseCase.GetBalanceReport(request)
	if err != nil {
		return fmt.Sprintf("❌ Error getting balance: %v", err)
	}

	return c.formatBalanceResponse(response)
}

// handleCreditCommand handles /credit and /pay commands
func (c *TelegramController) handleCreditCommand(message string, isPay bool) string {
	// Extract country code from message
	var countryCode string
	if strings.Contains(message, "AR") {
		countryCode = "AR"
	} else if strings.Contains(message, "NL") {
		countryCode = "NL"
	} else {
		return "❓ Please specify country code (AR or NL)"
	}

	// Get parameters from storage
	usdToArs, err := c.parameterUseCase.GetParameter("USD2ARS")
	if err != nil {
		return "❓ USD to ARS rate not configured. Use /set USD2ARS <rate>"
	}

	monthYear := time.Now()
	request := appdto.CreditRequest{
		MonthYear:   monthYear,
		UsdToArs:    usdToArs.Value,
		CountryCode: countryCode,
	}

	response, err := c.creditUseCase.GetCreditStatus(request)
	if err != nil {
		return fmt.Sprintf("❌ Error getting credit status: %v", err)
	}

	return c.formatCreditResponse(response, isPay)
}

// handleSetCommand handles the /set command
func (c *TelegramController) handleSetCommand(message string) string {
	// Parse parameter and value from message
	parts := strings.Fields(message)
	if len(parts) < 3 {
		return "❓ Usage: /set <parameter> <value>"
	}

	parameter := parts[1]
	valueStr := parts[2]

	value, err := strconv.ParseFloat(valueStr, 64)
	if err != nil {
		return "❓ Invalid value. Please provide a numeric value."
	}

	err = c.parameterUseCase.SetParameter(parameter, value)
	if err != nil {
		return fmt.Sprintf("❌ Error setting parameter: %v", err)
	}

	return fmt.Sprintf("✅ Parameter %s set to %v", parameter, value)
}

// Helper methods for parsing commands and formatting responses

func (c *TelegramController) parseStatusCommand(message string) (time.Time, float64, float64, float64, error) {
	parts := strings.Fields(message)
	monthYear := time.Now()
	
	// Default parameters from storage
	amountPerDay, err := c.parameterUseCase.GetParameter("ApD")
	if err != nil {
		return monthYear, 0, 0, 0, fmt.Errorf("amount per day not configured. Use /set ApD <amount>")
	}
	
	eurToUsd, err := c.parameterUseCase.GetParameter("EUR2USD")
	if err != nil {
		return monthYear, 0, 0, 0, fmt.Errorf("EUR to USD rate not configured. Use /set EUR2USD <rate>")
	}
	
	usdToArs, err := c.parameterUseCase.GetParameter("USD2ARS")
	if err != nil {
		return monthYear, 0, 0, 0, fmt.Errorf("USD to ARS rate not configured. Use /set USD2ARS <rate>")
	}

	// Parse optional month parameter
	if len(parts) > 1 {
		monthYear, err = time.ParseInLocation("2006-01-02", parts[1]+"-01", time.Local)
		if err != nil {
			return monthYear, 0, 0, 0, fmt.Errorf("invalid month format. Use YYYY-MM")
		}
	}

	return monthYear, amountPerDay.Value, eurToUsd.Value, usdToArs.Value, nil
}

func (c *TelegramController) parseBalanceCommand(message string) (time.Time, time.Time, float64, float64, float64, error) {
	now := time.Now()
	fromDate := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
	toDate := now
	
	// Get parameters from storage
	amountPerDay, err := c.parameterUseCase.GetParameter("ApD")
	if err != nil {
		return fromDate, toDate, 0, 0, 0, fmt.Errorf("amount per day not configured. Use /set ApD <amount>")
	}
	
	eurToUsd, err := c.parameterUseCase.GetParameter("EUR2USD")
	if err != nil {
		return fromDate, toDate, 0, 0, 0, fmt.Errorf("EUR to USD rate not configured. Use /set EUR2USD <rate>")
	}
	
	usdToArs, err := c.parameterUseCase.GetParameter("USD2ARS")
	if err != nil {
		return fromDate, toDate, 0, 0, 0, fmt.Errorf("USD to ARS rate not configured. Use /set USD2ARS <rate>")
	}

	return fromDate, toDate, amountPerDay.Value, eurToUsd.Value, usdToArs.Value, nil
}

func (c *TelegramController) formatStatusResponse(response *appdto.StatusResponse) string {
	result := fmt.Sprintf("\n🐷PERIOD: %v", response.Period)
	result += fmt.Sprintf("\n💵YOUR CURRENT SITUATION: €%0.2f", response.Difference)
	result += fmt.Sprintf("\n💷Comparing with what you expected to have considering today: €%0.2f", response.DayRemainingDiff)
	result += fmt.Sprintf("\n💶That means for each remaining day: €%0.2f", response.DayRemaining)
	result += fmt.Sprintf("\n⚖️Money to balance: €%0.2f", response.Balance)
	result += fmt.Sprintf("\n💰Your available cash should be: €%0.2f", response.Cash)
	return result
}

func (c *TelegramController) formatBalanceResponse(response *appdto.BalanceResponse) string {
	result := fmt.Sprintf("\n📊BALANCE REPORT")
	result += fmt.Sprintf("\n🗓️From: %s to %s", response.FromDate, response.ToDate)
	result += fmt.Sprintf("\n💰Difference: €%0.2f", response.Difference)
	result += fmt.Sprintf("\n📈Daily remaining diff: €%0.2f", response.DayRemainingDiff)
	return result
}

func (c *TelegramController) formatCreditResponse(response *appdto.CreditResponse, isPay bool) string {
	action := "Credit"
	if isPay {
		action = "Payment"
	}
	
	result := fmt.Sprintf("\n💳%s REPORT", strings.ToUpper(action))
	result += fmt.Sprintf("\n🗓️Period: %s", response.Period)
	result += fmt.Sprintf("\n💵Total USD: $%0.2f", response.TotalUSD)
	result += fmt.Sprintf("\n💴Total ARS: $%0.2f", response.TotalARS)
	result += fmt.Sprintf("\n💰Total: €%0.2f", response.Total)
	
	if len(response.Items) > 0 {
		result += "\n📋Items:"
		for _, item := range response.Items {
			result += fmt.Sprintf("\n  - %s: %s %0.2f", item.Description, item.Currency, item.Amount)
		}
	}
	
	return result
}