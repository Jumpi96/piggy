package serverless

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	repositories "../repositories"
	entries "../services"
	"github.com/aws/aws-sdk-go/service/dynamodb"
)

var regCreditAllParam = regexp.MustCompile(`\/(credit|pay)(AR|NL) [0-9]{4}-[0-9]{2} ([0-9]*[.])?[0-9]+`)
var regCreditDateButMinimum = regexp.MustCompile(`\/(credit|pay)(AR|NL) [0-9]{4}-[0-9]{2}`)
var regCreditButDate = regexp.MustCompile(`\/(credit|pay)(AR|NL) ([0-9]*[.])?[0-9]+`)
var regCreditMinimum = regexp.MustCompile(`\/(credit|pay)(AR|NL)`)

func handleCredit(client dynamodb.DynamoDB, message string, pay bool) string {
	var monthYear string
	var usdToArs float64
	var err error
	var params []string

	if regCreditAllParam.MatchString(message) {
		params = strings.Split(message, " ")
		monthYear = params[1]
		must(err)
		usdToArs, err = strconv.ParseFloat(params[2], 64)
		must(err)
		err = repositories.SetParam(client, "USD2ARS", usdToArs)
		must(err)
	} else if regCreditDateButMinimum.MatchString(message) {
		params = strings.Split(message, " ")
		monthYear = params[1]
		usdToArs, err = repositories.GetParam(client, "USD2ARS")
		if err != nil {
			return errorNoParameters
		}
	} else if regCreditButDate.MatchString(message) {
		monthYear = time.Now().Format("2006-01-02")[0:7]
		params = strings.Split(message, " ")
		must(err)
		usdToArs, err = strconv.ParseFloat(params[1], 64)
		must(err)
		err = repositories.SetParam(client, "USD2ARS", usdToArs)
		must(err)
	} else if regCreditMinimum.MatchString(message) {
		monthYear = time.Now().Format("2006-01-02")[0:7]
		usdToArs, err = repositories.GetParam(client, "USD2ARS")
		if err != nil {
			return errorNoParameters
		}
	} else {
		return "The /credit or /pay command should be like: \n /credit [<MonthYear>] <USDtoARS>. \n i.e. /credit 2020-06 90.00"
	}

	if strings.Contains(message, "AR") {
		if pay {
			entries.ConfirmCreditPayment(toshlRepository, monthYear, repositories.Configs.CreditTag, false, usdToArs)
		}
		return generateCreditARReport(monthYear, usdToArs)
	} else {
		if pay {
			entries.ConfirmCreditPayment(toshlRepository, monthYear, repositories.Configs.CreditNLTag, true, usdToArs)
		}
		return generateCreditNLReport(monthYear, usdToArs)
	}
}

func generateCreditNLReport(monthYear string, usdToArs float64) string {
	var response string
	result, items := entries.GetCreditCardStatus(toshlRepository, monthYear, usdToArs, repositories.Configs.CreditNLTag)
	response += fmt.Sprintf("\n💳PAYING YOUR 🇳🇱CREDIT CARD🇳🇱")
	response += fmt.Sprintf("\n🐷PERIOD: %v", monthYear)
	response += fmt.Sprintf("\n💰TOTAL: €%0.2f", result["amountUSD"])
	response += fmt.Sprintf("\nYour credit items are: ")

	for _, item := range items {
		response += fmt.Sprintf("\n ☑ %s", item)
	}
	return response
}

func generateCreditARReport(monthYear string, usdToArs float64) string {
	var response string
	result, items := entries.GetCreditCardStatus(toshlRepository, monthYear, usdToArs, repositories.Configs.CreditTag)
	response += fmt.Sprintf("\n💳PAYING YOUR 🇦🇷CREDIT CARD🇦🇷")
	response += fmt.Sprintf("\n🐷PERIOD: %v", monthYear)
	response += fmt.Sprintf("\n💵Amount in USD: $%0.2f ($%0.2f per U$D)", result["amountUSD"], usdToArs)
	response += fmt.Sprintf("\n🇦🇷Amount in ARS: $%0.2f", result["amountARS"])
	response += fmt.Sprintf("\n💰TOTAL IN ARS: $%0.2f", result["total"])
	response += fmt.Sprintf("\nYour credit items are: ")

	for _, item := range items {
		response += fmt.Sprintf("\n ☑ %s", item)
	}
	return response
}
