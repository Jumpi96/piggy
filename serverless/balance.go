package serverless

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	repositories "../repositories"
	entries "../services"
	"github.com/aws/aws-sdk-go/service/dynamodb"
)

var regBalanceAllParam = regexp.MustCompile(`\/balance [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{4}-[0-9]{2}-[0-9]{2}`)
var regBalanceMinimum = regexp.MustCompile(`\/balance`)

func handleBalanceStatus(client dynamodb.DynamoDB, message string) string {
	var fromDate string
	var toDate string
	var amountPerDay float64
	var usdToArs float64
	var eurToUsd float64
	var params []string

	if regBalanceAllParam.MatchString(message) {
		var errOne, errTwo error
		params = strings.Split(message, " ")
		fromDate = params[1]
		toDate = params[2]
		amountPerDay, errOne = repositories.GetParam(client, "ApD")
		usdToArs, errTwo = repositories.GetParam(client, "USD2ARS")
		eurToUsd, errTwo = repositories.GetParam(client, "EUR2USD")
		if errOne != nil || errTwo != nil {
			return errorNoParameters
		}
	} else if regBalanceMinimum.MatchString(message) {
		var errOne, errTwo error
		fromDate = time.Now().Format("2006-01-02")[0:10]
		toDate = fmt.Sprintf("%s-12-31", time.Now().Format("2006-01-02")[0:4])
		amountPerDay, errOne = repositories.GetParam(client, "ApD")
		usdToArs, errTwo = repositories.GetParam(client, "USD2ARS")
		eurToUsd, errTwo = repositories.GetParam(client, "EUR2USD")
		if errOne != nil || errTwo != nil {
			return errorNoParameters
		}
	} else {
		return "❓ The /balance command should be like: \n /balance [<FromDate>] [<ToDate>]. \n i.e. /balance 2020-06-01 2020-08-30"
	}

	return generateBalanceReport(fromDate, toDate, amountPerDay, usdToArs, eurToUsd)
}

func generateBalanceReport(fromDate string, toDate string, amountPerDay float64, usdToArs float64, eurToUsd float64) string {
	var response string
	result := entries.GetBalance(toshlRepository, fromDate, toDate, amountPerDay, usdToArs, eurToUsd)
	response = fmt.Sprintf("\n🐷PERIOD: %v to %v", fromDate, toDate)
	response += fmt.Sprintf("\n💳Using €%0.2f per day, $%0.2f per €UR and AR$%0.2f per U$D", amountPerDay, eurToUsd, usdToArs)
	response += fmt.Sprintf("\n💵YOUR CURRENT SITUATION: €%0.2f", result["diff"])
	response += fmt.Sprintf("\n💷Comparing with what you expected to have: €%0.2f", result["dayRemainingDiff"])
	return response
}
