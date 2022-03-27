package serverless

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	repositories "piggy/repositories"
	entries "piggy/services"

	"github.com/aws/aws-sdk-go/service/dynamodb"
	log "github.com/sirupsen/logrus"
)

var regAllParam = regexp.MustCompile(`\/status [0-9]{4}-[0-9]{2} ([0-9]*[.])?[0-9]+ ([0-9]*[.])?[0-9]+ ([0-9]*[.])?[0-9]+`)
var regDateButMinimum = regexp.MustCompile(`\/status [0-9]{4}-[0-9]{2}`)
var regButDate = regexp.MustCompile(`\/status ([0-9]*[.])?[0-9]+ ([0-9]*[.])?[0-9]+ ([0-9]*[.])?[0-9]+`)
var regMinimum = regexp.MustCompile(`\/status`)

var errorNoParameters = "❓ I don't know the needed parameters. Please enter them the first time!"
var errorStatus = "❓ The /status command should be like: \n /status [<MonthYear>] <AmountPerDay> <EURtoUSD> <USDtoARS>. \n i.e. /status 2020-06 1000.00 1.20 90.00"

func handleStatus(client dynamodb.DynamoDB, message string) string {
	var monthYear time.Time
	var amountPerDay float64
	var usdToArs float64
	var eurToUsd float64
	var err error
	var params []string

	if regAllParam.MatchString(message) {
		params = strings.Split(message, " ")
		monthYear, err = ParseMonthYear(params[1])
		if err != nil {
			log.Errorf("Error parsing month and year: %v", err)
			return errorStatus
		}
		amountPerDay, err = strconv.ParseFloat(params[2], 64)
		if err != nil {
			log.Errorf("Error parsing amountPerDay: %v", err)
			return errorStatus
		}
		eurToUsd, err = strconv.ParseFloat(params[3], 64)
		if err != nil {
			log.Errorf("Error parsing eurToUsd: %v", err)
			return errorStatus
		}
		usdToArs, err = strconv.ParseFloat(params[4], 64)
		if err != nil {
			log.Errorf("Error parsing usdToArs: %v", err)
			return errorStatus
		}
		err = repositories.SetParam(client, "ApD", amountPerDay)
		if err != nil {
			log.Errorf("Error setting ApD: %v", err)
			return errorStatus
		}
		err = repositories.SetParam(client, "EUR2USD", eurToUsd)
		if err != nil {
			log.Errorf("Error setting EUR2USD: %v", err)
			return errorStatus
		}
		err = repositories.SetParam(client, "USD2ARS", usdToArs)
		if err != nil {
			log.Errorf("Error setting USD2ARS: %v", err)
			return errorStatus
		}
	} else if regButDate.MatchString(message) {
		monthYear = time.Now()
		params = strings.Split(message, " ")
		amountPerDay, err = strconv.ParseFloat(params[1], 64)
		if err != nil {
			log.Errorf("Error parsing amountPerDay: %v", err)
			return errorStatus
		}
		eurToUsd, err = strconv.ParseFloat(params[2], 64)
		if err != nil {
			log.Errorf("Error parsing eurToUsd: %v", err)
			return errorStatus
		}
		usdToArs, err = strconv.ParseFloat(params[3], 64)
		if err != nil {
			log.Errorf("Error parsing usdToArs: %v", err)
			return errorStatus
		}
		err = repositories.SetParam(client, "ApD", amountPerDay)
		if err != nil {
			log.Errorf("Error setting ApD: %v", err)
			return errorStatus
		}
		err = repositories.SetParam(client, "EUR2USD", eurToUsd)
		if err != nil {
			log.Errorf("Error setting EUR2USD: %v", err)
			return errorStatus
		}
		err = repositories.SetParam(client, "USD2ARS", usdToArs)
		if err != nil {
			log.Errorf("Error setting USD2ARS: %v", err)
			return errorStatus
		}
	} else if regDateButMinimum.MatchString(message) {
		var err error
		params = strings.Split(message, " ")
		monthYear, err = ParseMonthYear(params[1])
		if err != nil {
			log.Errorf("Error parsing month and year: %v", err)
			return errorStatus
		}
		amountPerDay, err = repositories.GetParam(client, "ApD")
		if err != nil {
			log.Errorf("Error getting amountPerDay: %v", err)
			return errorNoParameters
		}
		usdToArs, err = repositories.GetParam(client, "USD2ARS")
		if err != nil {
			log.Errorf("Error getting usdToArs: %v", err)
			return errorNoParameters
		}
		eurToUsd, err = repositories.GetParam(client, "EUR2USD")
		if err != nil {
			log.Errorf("Error getting eurToUsd: %v", err)
			return errorNoParameters
		}
	} else if regMinimum.MatchString(message) {
		var err error
		monthYear = time.Now()
		amountPerDay, err = repositories.GetParam(client, "ApD")
		if err != nil {
			log.Errorf("Error getting amountPerDay: %v", err)
			return errorNoParameters
		}
		usdToArs, err = repositories.GetParam(client, "USD2ARS")
		if err != nil {
			log.Errorf("Error getting usdToArs: %v", err)
			return errorNoParameters
		}
		eurToUsd, err = repositories.GetParam(client, "EUR2USD")
		if err != nil {
			log.Errorf("Error getting eurToUsd: %v", err)
			return errorNoParameters
		}
	} else {
		return errorStatus
	}
	res, err := generateReport(monthYear, amountPerDay, usdToArs, eurToUsd)
	if err != nil {
		log.Errorf("Error generating report: %v", err)
		return errorStatus
	}
	return res
}

func generateReport(monthYear time.Time, amountPerDay float64, usdToArs float64, eurToUsd float64) (string, error) {
	var response string
	result, stairs, err := entries.GetMonthStatus(toshlRepository, monthYear, amountPerDay, usdToArs, eurToUsd)
	if err != nil {
		return "", err
	}
	response = fmt.Sprintf("\n🐷PERIOD: %v", monthYear)
	response += fmt.Sprintf("\n💳Using €%0.2f per day, $%0.2f per €UR and AR$%0.2f per U$D", amountPerDay, eurToUsd, usdToArs)
	response += fmt.Sprintf("\n💵YOUR CURRENT SITUATION: €%0.2f", result["diff"])
	response += fmt.Sprintf("\n💶That means for each remaining day: €%0.2f", result["dayRemaining"])
	response += fmt.Sprintf("\n💷Comparing with what you expected to have: €%0.2f", result["dayRemainingDiff"])
	response += fmt.Sprintf("\n⚖️Money to balance: €%0.2f\n\n", result["balance"])

	var keys []int
	for k := range stairs {
		keys = append(keys, k)
	}
	sort.Ints(keys)

	for _, k := range keys {
		response += fmt.Sprintf(" %v ................. €%0.2f\n", k, stairs[k])
	}

	response += fmt.Sprintf("\n💰Your available cash should be: €%0.2f\n", result["cash"])
	return response, nil
}

func ParseMonthYear(monthYear string) (time.Time, error) {
	currentLocation, _ := time.LoadLocation(repositories.Configs.TimeZone)
	year, month, day := time.Now().In(currentLocation).Date()
	today := time.Date(year, month, day, 0, 0, 0, 0, currentLocation)
	return time.ParseInLocation("2006-01-02", monthYear+"-01", today.Location())
}
