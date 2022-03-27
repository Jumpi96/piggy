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
			log.Errorf("Dates are not valid for balance")
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
	result, err := entries.GetBalance(toshlRepository, fromDate, toDate, amountPerDay, usdToArs, eurToUsd)
	if err != nil {
		return "", err
	}
	response = fmt.Sprintf("\n🐷PERIOD: %v to %v", fromDate, toDate)
	response += fmt.Sprintf("\n💳Using €%0.2f per day, $%0.2f per €UR and AR$%0.2f per U$D", amountPerDay, eurToUsd, usdToArs)
	response += fmt.Sprintf("\n💵YOUR CURRENT SITUATION: €%0.2f", result["diff"])
	response += fmt.Sprintf("\n💷Comparing with what you expected to have: €%0.2f", result["dayRemainingDiff"])
	return response, nil
}

func validateDates(fromMonthYear, toMonthYear string) error {
	currentLocation, _ := time.LoadLocation(repositories.Configs.TimeZone)
	year, month, day := time.Now().In(currentLocation).Date()
	today := time.Date(year, month, day, 0, 0, 0, 0, currentLocation)
	from, err := time.ParseInLocation("2006-01-02", fromMonthYear+"-01", today.Location())
	if err != nil {
		return errors.New("error parsing from date")
	}
	to, err := time.ParseInLocation("2006-01-02", toMonthYear+"-01", today.Location())
	if err != nil {
		return errors.New("error parsing to date")
	}
	if from.After(to) {
		return errors.New("to date is before after date")
	}
	return nil
}
