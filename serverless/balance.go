package serverless

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	repositories "piggy/repositories"
	entries "piggy/services"

	"github.com/aws/aws-sdk-go/service/dynamodb"
	log "github.com/sirupsen/logrus"
)

var regBalanceAllParam = regexp.MustCompile(`\/balance [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{4}-[0-9]{2}-[0-9]{2}`)
var regBalanceMinimum = regexp.MustCompile(`\/balance`)
var errorBalance = "❓ The /balance command should be like: \n /balance [<FromDate>] [<ToDate>]. \n i.e. /balance 2020-06-01 2020-08-30"

func handleBalanceStatus(client dynamodb.DynamoDB, message string) string {
	var fromDate string
	var toDate string
	var amountPerDay float64
	var usdToArs float64
	var eurToUsd float64
	var params []string

	if regBalanceAllParam.MatchString(message) {
		var errOne, errTwo, errThree error
		params = strings.Split(message, " ")
		fromDate = params[1]
		toDate = params[2]
		err := validateDates(fromDate, toDate)
		if err != nil {
			log.Errorf("dates are not valid for balance: %v", err)
			return errorBalance
		}
		amountPerDay, errOne = repositories.GetParam(client, "ApD")
		usdToArs, errTwo = repositories.GetParam(client, "USD2ARS")
		eurToUsd, errThree = repositories.GetParam(client, "EUR2USD")
		if errOne != nil || errTwo != nil || errThree != nil {
			return errorNoParameters
		}
	} else if regBalanceMinimum.MatchString(message) {
		var errOne, errTwo, errThree error
		fromDate = time.Now().Format("2006-01-02")[0:10]
		toDate = fmt.Sprintf("%s-12-31", time.Now().Format("2006-01-02")[0:4])
		amountPerDay, errOne = repositories.GetParam(client, "ApD")
		usdToArs, errTwo = repositories.GetParam(client, "USD2ARS")
		eurToUsd, errThree = repositories.GetParam(client, "EUR2USD")
		if errOne != nil || errTwo != nil || errThree != nil {
			return errorNoParameters
		}
	} else {
		return errorBalance
	}

	res, err := generateBalanceReport(fromDate, toDate, amountPerDay, usdToArs, eurToUsd)
	if err != nil {
		log.Errorf("Error generating balance report: %v", err)
		return errorBalance
	}
	return res
}

func generateBalanceReport(fromDate string, toDate string, amountPerDay float64, usdToArs float64, eurToUsd float64) (string, error) {
	var response string
	var balance map[string]float64
	balances := make(map[string]map[string]float64)

	fromDateTime, err := time.Parse("2006-01-02", fromDate)
	if err != nil {
		return "", err
	}

	toDateTime, err := time.Parse("2006-01-02", toDate)
	if err != nil {
		return "", err
	}

	currentDateTime := fromDateTime
	for currentDateTime.Before(toDateTime) || currentDateTime.Equal(toDateTime) {
		year, month, _ := currentDateTime.Date()
		monthKey := fmt.Sprintf("%d-%02d", year, month)

		if currentDateTime.Year() == fromDateTime.Year() && currentDateTime.Month() == fromDateTime.Month() {
			// Initial month: start from the original fromDate to the last day of the month
			firstDayOfMonth := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
			lastDayOfMonth := firstDayOfMonth.AddDate(0, 1, -1)
			balance, err = entries.GetBalance(toshlRepository, fromDateTime, lastDayOfMonth, amountPerDay, usdToArs, eurToUsd)
		} else if currentDateTime.Year() == toDateTime.Year() && currentDateTime.Month() == toDateTime.Month() {
			// Final month: start from the first day of the month to the original toDateTime
			firstDayOfMonth := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
			balance, err = entries.GetBalance(toshlRepository, firstDayOfMonth, toDateTime, amountPerDay, usdToArs, eurToUsd)
		} else {
			// Month in the middle: start from the first day to the last day of the month
			firstDayOfMonth := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
			lastDayOfMonth := firstDayOfMonth.AddDate(0, 1, -1)
			balance, err = entries.GetBalance(toshlRepository, firstDayOfMonth, lastDayOfMonth, amountPerDay, usdToArs, eurToUsd)
		}
		balances[monthKey] = balance
		currentDateTime = currentDateTime.AddDate(0, 1, 0)
	}

	keys := make([]string, 0, len(balances))
	for key := range balances {
		keys = append(keys, key)
	}

	sort.Strings(keys)
	  
	totalBalances := make(map[string]float64)
	for _, balance := range balances {
		for _, key := range []string{"diff", "dayRemainingDiff"} {
			totalBalances[key] += balance[key]
		}
	}
	
	response = fmt.Sprintf("\n🐷PERIOD: %v to %v", fromDate, toDate)
	response += fmt.Sprintf("\n💳Using €%0.2f per day, $%0.2f per €UR and AR$%0.2f per U$D", amountPerDay, eurToUsd, usdToArs)
	for month := range keys {
		response += fmt.Sprintf(" %v ................. €%0.2f\n", month, balances[month]["dayRemainingDiff"])
	}
	response += fmt.Sprintf("\n💵YOUR CURRENT SITUATION: €%0.2f", totalBalances["diff"])
	response += fmt.Sprintf("\n💷Comparing with what you expected to have: €%0.2f\n\n", totalBalances["dayRemainingDiff"])
	return response, nil
}

func validateDates(fromMonthYear, toMonthYear string) error {
	currentLocation, _ := time.LoadLocation(repositories.Configs.TimeZone)
	year, month, day := time.Now().In(currentLocation).Date()
	today := time.Date(year, month, day, 0, 0, 0, 0, currentLocation)
	from, err := time.ParseInLocation("2006-01-02", fromMonthYear, today.Location())
	if err != nil {
		return errors.New("error parsing from date")
	}
	to, err := time.ParseInLocation("2006-01-02", toMonthYear, today.Location())
	if err != nil {
		return errors.New("error parsing to date")
	}
	if from.After(to) {
		return errors.New("to date is before after date")
	}
	return nil
}
