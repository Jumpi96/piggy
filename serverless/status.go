package serverless

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	repositories "../repositories"
	entries "../services"
	"github.com/aws/aws-sdk-go/service/dynamodb"
)

var regAllParam = regexp.MustCompile(`\/status [0-9]{4}-[0-9]{2} ([0-9]*[.])?[0-9]+ ([0-9]*[.])?[0-9]+`)
var regDateButMinimum = regexp.MustCompile(`\/status [0-9]{4}-[0-9]{2}`)
var regButDate = regexp.MustCompile(`\/status ([0-9]*[.])?[0-9]+ ([0-9]*[.])?[0-9]+`)
var regMinimum = regexp.MustCompile(`\/status`)

var errorNoParameters = "❓ I don't know the needed parameters. Please enter them the first time!"

func handleStatus(client dynamodb.DynamoDB, message string) string {
	var monthYear string
	var amountPerDay float64
	var usdToArs float64
	var err error
	var params []string

	if regAllParam.MatchString(message) {
		params = strings.Split(message, " ")
		monthYear = params[1]
		amountPerDay, err = strconv.ParseFloat(params[2], 64)
		must(err)
		usdToArs, err = strconv.ParseFloat(params[3], 64)
		must(err)
		err = repositories.SetParam(client, "ApD", amountPerDay)
		must(err)
		err = repositories.SetParam(client, "USD2ARS", usdToArs)
		must(err)
	} else if regButDate.MatchString(message) {
		monthYear = time.Now().Format("2006-01-02")[0:7]
		params = strings.Split(message, " ")
		amountPerDay, err = strconv.ParseFloat(params[1], 64)
		must(err)
		usdToArs, err = strconv.ParseFloat(params[2], 64)
		must(err)
		err = repositories.SetParam(client, "ApD", amountPerDay)
		must(err)
		err = repositories.SetParam(client, "USD2ARS", usdToArs)
		must(err)
	} else if regDateButMinimum.MatchString(message) {
		var errOne, errTwo error
		params = strings.Split(message, " ")
		monthYear = params[1]
		amountPerDay, errOne = repositories.GetParam(client, "ApD")
		usdToArs, errTwo = repositories.GetParam(client, "USD2ARS")
		if errOne != nil || errTwo != nil {
			return errorNoParameters
		}
	} else if regMinimum.MatchString(message) {
		var errOne, errTwo error
		monthYear = time.Now().Format("2006-01-02")[0:7]
		amountPerDay, errOne = repositories.GetParam(client, "ApD")
		usdToArs, errTwo = repositories.GetParam(client, "USD2ARS")
		if errOne != nil || errTwo != nil {
			return errorNoParameters
		}
	} else {
		return "❓ The /status command should be like: \n /status [<MonthYear>] <AmountPerDay> <USDtoARS>. \n i.e. /status 2020-06 1000.00 90.00"
	}

	return generateReport(monthYear, amountPerDay, usdToArs)
}

func generateReport(monthYear string, amountPerDay float64, usdToArs float64) string {
	var response string
	result, stairs := entries.GetMonthStatus(toshlRepository, monthYear, amountPerDay, usdToArs)
	response = fmt.Sprintf("\n🐷PERIOD: %v", monthYear)
	response += fmt.Sprintf("\n💳Using $%0.2f per day and $%0.2f per U$D.\n\n", amountPerDay, usdToArs)
	response += fmt.Sprintf("\n💵YOUR CURRENT SITUATION: $%0.2f", result["diff"])
	response += fmt.Sprintf("\n💶That means for each remaining day: $%0.2f", result["dayRemaining"])
	response += fmt.Sprintf("\n💷Comparing with what you expected to have: $%0.2f", result["dayRemainingDiff"])

	var keys []int
	for k := range stairs {
		keys = append(keys, k)
	}
	sort.Ints(keys)

	for _, k := range keys {
		response += fmt.Sprintf(" %v ................. $%0.2f\n", k, stairs[k])
	}

	response += fmt.Sprintf("\n💰Your available cash should be: $%0.2f\n", result["cash"])
	return response
}
