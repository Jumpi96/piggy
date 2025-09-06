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
    SetStringParameter(key string, value string) error
    GetParameter(key string) (*entities.Parameter, error)
    SetCurrencies(monthYear time.Time, usdToArs, eurToUsd float64) (int, error)
    GetCurrencySymbol() (string, error)
    SetCurrencySymbol(currency, symbol string) error
    GetSymbol(currency string) (string, error)
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
    monthYear, err := c.parseStatusCommand(message)
    if err != nil {
        return fmt.Sprintf("❓ %v", err)
    }

    request := appdto.StatusRequest{
        MonthYear:    monthYear,
        // Leave numeric fields zero to let use case pull defaults
        AmountPerDay: 0,
        EurToUsd:     0,
        UsdToArs:     0,
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
    fromDate, toDate, err := c.parseBalanceCommand(message)
    if err != nil {
        return fmt.Sprintf("❓ %v", err)
    }

	request := appdto.BalanceRequest{
		FromDate:     fromDate,
		ToDate:       toDate,
        // Leave numeric fields zero to let use case pull defaults
        AmountPerDay: 0,
        UsdToArs:     0,
        EurToUsd:     0,
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

    // Parse optional month parameter (YYYY-MM)
    monthYear := time.Now()
    parts := strings.Fields(message)
    if len(parts) > 1 {
        loc, _ := time.LoadLocation(c.configService.GetTimeZone())
        if t, err := time.ParseInLocation("2006-01-02", parts[1]+"-01", loc); err == nil {
            monthYear = t
        }
    }
    request := appdto.CreditRequest{
        MonthYear:   monthYear,
        CountryCode: countryCode,
    }

	response, err := c.creditUseCase.GetCreditStatus(request)
	if err != nil {
		return fmt.Sprintf("❌ Error getting credit status: %v", err)
	}

    return c.formatCreditResponse(response, isPay, request)
}

// handleSetCommand handles the /set command
func (c *TelegramController) handleSetCommand(message string) string {
	// Parse parameter and value from message
	parts := strings.Fields(message)
	if len(parts) < 3 {
		return "❓ Usage: /set <parameter> <value> or /set SYMBOL <currency> <symbol>"
	}

    parameter := parts[1]
    
    // Handle symbol setting: /set SYMBOL ARS AR$
    if parameter == "SYMBOL" {
        if len(parts) < 4 {
            return "❓ Usage: /set SYMBOL <currency> <symbol>"
        }
        currency := parts[2]
        symbol := parts[3]
        err := c.parameterUseCase.SetCurrencySymbol(currency, symbol)
        if err != nil {
            return fmt.Sprintf("❌ Error setting symbol: %v", err)
        }
        return fmt.Sprintf("✅ Symbol for %s set to %s", currency, symbol)
    }

    valueStr := parts[2]
    var err error
    if parameter == "CURRENCY" {
        // Accept string values for CURRENCY
        err = c.parameterUseCase.SetStringParameter(parameter, valueStr)
    } else {
        value, convErr := strconv.ParseFloat(valueStr, 64)
        if convErr != nil {
            return "❓ Invalid value. Please provide a numeric value."
        }
        err = c.parameterUseCase.SetParameter(parameter, value)
    }
	if err != nil {
		return fmt.Sprintf("❌ Error setting parameter: %v", err)
	}

    return fmt.Sprintf("✅ Parameter %s set to %v", parameter, valueStr)
}

// Helper methods for parsing commands and formatting responses

// getCurrencySymbol gets the currency symbol for display, fallback to "EUR" if error
func (c *TelegramController) getCurrencySymbol() string {
	symbol, err := c.parameterUseCase.GetCurrencySymbol()
	if err != nil {
		return "EUR" // fallback
	}
	return symbol
}

// getCurrencySymbolFromCode gets the display symbol for any currency code
func (c *TelegramController) getCurrencySymbolFromCode(currencyCode string) string {
	// Look up symbol from parameter store
	symbol, err := c.parameterUseCase.GetSymbol(currencyCode)
	if err != nil {
		return currencyCode // fallback to currency code
	}
	return symbol
}

func (c *TelegramController) parseStatusCommand(message string) (time.Time, error) {
    parts := strings.Fields(message)
    monthYear := time.Now()

	// Parse optional month parameter
	if len(parts) > 1 {
        loc, _ := time.LoadLocation(c.configService.GetTimeZone())
        var err error
        monthYear, err = time.ParseInLocation("2006-01-02", parts[1]+"-01", loc)
        if err != nil {
            return monthYear, fmt.Errorf("invalid month format. Use YYYY-MM")
        }
    }

    return monthYear, nil
}

func (c *TelegramController) parseBalanceCommand(message string) (time.Time, time.Time, error) {
    // Use configured timezone consistently
    loc, _ := time.LoadLocation(c.configService.GetTimeZone())
    now := time.Now().In(loc)
    fromDate := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
    toDate := now

    parts := strings.Fields(message)
    if len(parts) >= 3 {
        // Parse explicit from/to dates in YYYY-MM-DD
        var err error
        fromDate, err = time.ParseInLocation("2006-01-02", parts[1], loc)
        if err != nil {
            return fromDate, toDate, fmt.Errorf("invalid 'from' date. Use YYYY-MM-DD")
        }
        toDate, err = time.ParseInLocation("2006-01-02", parts[2], loc)
        if err != nil {
            return fromDate, toDate, fmt.Errorf("invalid 'to' date. Use YYYY-MM-DD")
        }
        if toDate.Before(fromDate) {
            // Swap to keep a valid range
            fromDate, toDate = toDate, fromDate
        }
    } else if len(parts) == 2 {
        // If a single date is provided, require both for clarity
        return fromDate, toDate, fmt.Errorf("usage: /balance <from YYYY-MM-DD> <to YYYY-MM-DD>")
    }
    return fromDate, toDate, nil
}

func (c *TelegramController) formatStatusResponse(response *appdto.StatusResponse) string {
    currencySymbol := c.getCurrencySymbol()
    result := fmt.Sprintf("\n🐷PERIOD: %v", response.Period)
    // Base and rates
    result += fmt.Sprintf("\n💳Base: %s; ApD: %s%0.2f.", currencySymbol, currencySymbol, response.UsedAmountPerDay)
    if len(response.UsedRates) > 0 {
        // Build sorted list of rates
        keys := make([]string, 0, len(response.UsedRates))
        for k := range response.UsedRates { keys = append(keys, k) }
        for i := 1; i < len(keys); i++ { j:=i; for j>0 && keys[j-1] > keys[j] { keys[j-1], keys[j] = keys[j], keys[j-1]; j-- } }
        result += "\n🔁Rates:"
        for _, k := range keys {
            // k format: BASE2CODE
            parts := strings.Split(k, "2")
            if len(parts) == 2 {
                result += fmt.Sprintf(" 1 %s per %0.5f %s,", parts[1], response.UsedRates[k], parts[0])
            } else {
                result += fmt.Sprintf(" %s=%0.2f,", k, response.UsedRates[k])
            }
        }
        result = result[:len(result)-1]
    }
    result += fmt.Sprintf("\n💵YOUR CURRENT SITUATION: %s%0.2f", currencySymbol, response.Difference)
    result += fmt.Sprintf("\n💷Comparing with what you expected to have considering today: %s%0.2f", currencySymbol, response.DayRemainingDiff)
    result += fmt.Sprintf("\n💶That means for each remaining day: %s%0.2f", currencySymbol, response.DayRemaining)
    result += fmt.Sprintf("\n⚖️Money to balance: %s%0.2f", currencySymbol, response.Balance)

    // Daily breakdown (sorted by day)
    if len(response.DailyBreakdown) > 0 {
        // Sort the days to ensure stable output
        days := make([]int, 0, len(response.DailyBreakdown))
        for d := range response.DailyBreakdown {
            days = append(days, d)
        }
        // simple insertion sort as list is small (month days)
        for i := 1; i < len(days); i++ {
            j := i
            for j > 0 && days[j-1] > days[j] {
                days[j-1], days[j] = days[j], days[j-1]
                j--
            }
        }

        result += "\n"
        for _, d := range days {
            amount := response.DailyBreakdown[d]
            result += fmt.Sprintf("\n %d ................. %s%0.2f", d, currencySymbol, amount)
        }
        result += "\n"
    }

    // Cash at the end, after the breakdown
    result += fmt.Sprintf("\n💰Your available cash should be: %s%0.2f", currencySymbol, response.Cash)
    return result
}

func (c *TelegramController) formatBalanceResponse(response *appdto.BalanceResponse) string {
    currencySymbol := c.getCurrencySymbol()
    // Header period and parameters used
    result := fmt.Sprintf("\n🐷PERIOD: %s to %s", response.FromDate, response.ToDate)
    result += fmt.Sprintf("\n💳Base: %s; ApD: %s%0.2f.", currencySymbol, currencySymbol, response.UsedAmountPerDay)
    if len(response.UsedRates) > 0 {
        keys := make([]string, 0, len(response.UsedRates))
        for k := range response.UsedRates { keys = append(keys, k) }
        for i := 1; i < len(keys); i++ { j:=i; for j>0 && keys[j-1] > keys[j] { keys[j-1], keys[j] = keys[j], keys[j-1]; j-- } }
        result += "\n🔁Rates:"
        for _, k := range keys {
            parts := strings.Split(k, "2")
            if len(parts) == 2 {
                result += fmt.Sprintf(" 1 %s per %0.5f %s,", parts[1], response.UsedRates[k], parts[0])
            } else {
                result += fmt.Sprintf(" %s=%0.2f,", k, response.UsedRates[k])
            }
        }
        result = result[:len(result)-1]
    }

    // Monthly breakdown if available
    if len(response.MonthlyBreakdown) > 0 {
        // Sort months (YYYY-MM lexicographic is chronological)
        months := make([]string, 0, len(response.MonthlyBreakdown))
        for m := range response.MonthlyBreakdown {
            months = append(months, m)
        }
        // insertion sort
        for i := 1; i < len(months); i++ {
            j := i
            for j > 0 && months[j-1] > months[j] {
                months[j-1], months[j] = months[j], months[j-1]
                j--
            }
        }

        result += "\n"
        for _, m := range months {
            amount := response.MonthlyBreakdown[m]
            result += fmt.Sprintf("\n %s ................. %s%0.2f", m, currencySymbol, amount)
        }
        result += "\n"
    }

    // Summary lines
    result += fmt.Sprintf("\n💵YOUR CURRENT SITUATION: %s%0.2f", currencySymbol, response.Difference)
    result += fmt.Sprintf("\n💷Comparing with what you expected to have: %s%0.2f", currencySymbol, response.DayRemainingDiff)
    return result
}

func (c *TelegramController) formatCreditResponse(response *appdto.CreditResponse, isPay bool, request appdto.CreditRequest) string {
    flag := "🇦🇷"
    if request.CountryCode == "NL" {
        flag = "🇳🇱"
    }

    var header string
    if isPay {
        header = fmt.Sprintf("\n💳PAYING YOUR %sCREDIT CARD%s", flag, flag)
    } else {
        header = "\n💳CREDIT REPORT"
    }

    result := header
    result += fmt.Sprintf("\n🐷PERIOD: %s", response.Period)
    
    // Show currency totals if available, otherwise show single total
    if response.CurrencyTotals != nil && len(response.CurrencyTotals) > 1 {
        result += "\n💰TOTALS:"
        for currency, total := range response.CurrencyTotals {
            currencySymbol := c.getCurrencySymbolFromCode(currency)
            result += fmt.Sprintf("\n  %s: %s %0.2f", currency, currencySymbol, total)
        }
    } else {
        // Single total display (backwards compatibility)
        dispCurr := c.getCurrencySymbol()
        if len(response.Items) > 0 && response.Items[0].Currency != "" {
            dispCurr = c.getCurrencySymbolFromCode(response.Items[0].Currency)
        }
        result += fmt.Sprintf("\n💰TOTAL: %s %0.2f", dispCurr, response.Total)
    }

    if len(response.Items) > 0 {
        result += "\nYour credit items are: "
        for _, item := range response.Items {
            itemSymbol := c.getCurrencySymbolFromCode(item.Currency)
            result += fmt.Sprintf("\n ☑ %s %0.2f", itemSymbol, item.Amount)
        }
    }

    return result
}
