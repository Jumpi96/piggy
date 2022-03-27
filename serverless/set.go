package serverless

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	entries "piggy/services"

	"github.com/aws/aws-sdk-go/service/dynamodb"
	log "github.com/sirupsen/logrus"
)

var regSetAllParam = regexp.MustCompile(`\/set [0-9]{4}-[0-9]{2} ([0-9]*[.])?[0-9]+ ([0-9]*[.])?[0-9]+`)
var errorSet = "❓ The /set command should be like: \n /set <MonthYear> <EURtoUSD> <USDtoARS>. \n i.e. /set 2020-06 1.20 90.00"

func handleSet(client dynamodb.DynamoDB, message string) string {
	var monthYear time.Time
	var amountPerDay float64
	var usdToArs float64
	var eurToUsd float64
	var err error
	var params []string

	if regSetAllParam.MatchString(message) {
		params = strings.Split(message, " ")
		monthYear, err = ParseMonthYear(params[1])
		if err != nil {
			log.Errorf("error parsing date: %v", err)
			return errorSet
		}
		eurToUsd, err = strconv.ParseFloat(params[2], 64)
		if err != nil {
			log.Errorf("error parsing eurToUsd: %v", err)
			return errorSet
		}
		usdToArs, err = strconv.ParseFloat(params[3], 64)
		if err != nil {
			log.Errorf("error parsing usdToArs: %v", err)
			return errorSet
		}
	} else {
		return errorSet
	}

	res, err := setEntries(monthYear, amountPerDay, usdToArs, eurToUsd)
	if err != nil {
		log.Errorf("error setting entries: %v", err)
		return "❌ There was a problem setting currencies."
	}
	return res
}

func setEntries(monthYear time.Time, amountPerDay float64, usdToArs float64, eurToUsd float64) (string, error) {
	entries, err := entries.SetCurrencies(toshlRepository, monthYear, usdToArs, eurToUsd)

	if err != nil {
		return "", nil
	}

	response := fmt.Sprintf("\n🐷PERIOD: %v", monthYear.Format("2006-01-02")[0:7])
	response += fmt.Sprintf("\n💶💷💵%v entries processed.", entries)

	return response, nil
}
