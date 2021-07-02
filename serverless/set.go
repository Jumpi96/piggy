package serverless

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	entries "../services"
	"github.com/aws/aws-sdk-go/service/dynamodb"
)

var regSetAllParam = regexp.MustCompile(`\/set [0-9]{4}-[0-9]{2} ([0-9]*[.])?[0-9]+ ([0-9]*[.])?[0-9]+`)

func handleSet(client dynamodb.DynamoDB, message string) string {
	var monthYear string
	var amountPerDay float64
	var usdToArs float64
	var eurToUsd float64
	var err error
	var params []string

	if regSetAllParam.MatchString(message) {
		params = strings.Split(message, " ")
		monthYear = params[1]
		eurToUsd, err = strconv.ParseFloat(params[2], 64)
		must(err)
		usdToArs, err = strconv.ParseFloat(params[3], 64)
		must(err)
	} else {
		return "❓ The /status command should be like: \n /status <MonthYear> <EURtoUSD> <USDtoARS>. \n i.e. /set 2020-06 1.20 90.00"
	}

	return setEntries(monthYear, amountPerDay, usdToArs, eurToUsd)
}

func setEntries(monthYear string, amountPerDay float64, usdToArs float64, eurToUsd float64) string {
	entries, err := entries.SetCurrencies(toshlRepository, monthYear, usdToArs, eurToUsd)

	if err != nil {
		return "❌ There was a problem setting currencies."
	}

	response := fmt.Sprintf("\n🐷PERIOD: %v", monthYear)
	response += fmt.Sprintf("\n💶💷💵%v entries processed.", entries)

	return response
}
