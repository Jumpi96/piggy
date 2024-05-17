package serverless

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	repositories "piggy/repositories"
	entries "piggy/services"

	"github.com/aws/aws-sdk-go/service/dynamodb"
	log "github.com/sirupsen/logrus"
)

var regCreditDate = regexp.MustCompile(`\/(credit|pay)(AR|NL) [0-9]{4}-[0-9]{2}`)
var regCreditMinimum = regexp.MustCompile(`\/(credit|pay)(AR|NL)`)
var errCreditPay = "The /credit or /pay command should be like: \n /credit [<MonthYear>] <USDtoARS>. \n i.e. /credit 2020-06 90.00"

func handleCredit(client dynamodb.DynamoDB, message string, pay bool) string {
	var monthYear time.Time
	var usdToArs float64
	var err error
	var params []string

	if regCreditDate.MatchString(message) {
		params = strings.Split(message, " ")
		monthYear, err = ParseMonthYear(params[1])
		if err != nil {
			log.Errorf("could not parse monthYear: %v", monthYear)
			return errCreditPay
		}
	} else if regCreditMinimum.MatchString(message) {
		monthYear = time.Now()
		usdToArs, err = repositories.GetParam(client, "USD2ARS")
		if err != nil {
			log.Errorf("error getting USD2ARS: %v", monthYear)
			return errorNoParameters
		}
	} else {
		return errCreditPay
	}

	var res string
	if pay {
		err = entries.ConfirmCreditPayment(toshlRepository, monthYear, repositories.Configs.CreditNLTag, usdToArs)
		if err != nil {
			log.Errorf("error paying creditNL in Toshl: %v", err)
			return errCreditPay
		}
	}
	res, err = generateCreditNLReport(monthYear, usdToArs)
	
	if err != nil {
		log.Errorf("error generating credit report: %v", err)
		return errCreditPay
	}
	return res
}

func generateCreditNLReport(monthYear time.Time, usdToArs float64) (string, error) {
	var response string
	result, items, err := entries.GetCreditCardStatus(toshlRepository, monthYear, usdToArs, repositories.Configs.CreditNLTag)
	if err != nil {
		return "", err
	}
	response += "\n💳PAYING YOUR 🇳🇱CREDIT CARD🇳🇱"
	response += fmt.Sprintf("\n🐷PERIOD: %v", monthYear.Format("2006-01-02")[0:7])
	response += fmt.Sprintf("\n💰TOTAL: €%0.2f", result["amountUSD"])
	response += "\nYour credit items are: "

	for _, item := range items {
		response += fmt.Sprintf("\n ☑ %s", item)
	}
	return response, nil
}
