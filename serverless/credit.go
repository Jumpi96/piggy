package serverless

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	entries "../services"
)

var regCreditAllParam = regexp.MustCompile(`\/(credit|pay) [0-9]{4}-[0-9]{2} ([0-9]*[.])?[0-9]+`)
var regCreditButDate = regexp.MustCompile(`\/(credit|pay) ([0-9]*[.])?[0-9]+`)

func handleCredit(message string, pay bool) string {
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
	} else if regCreditButDate.MatchString(message) {
		monthYear = time.Now().Format("2006-01-02")[0:7]
		params = strings.Split(message, " ")
		must(err)
		usdToArs, err = strconv.ParseFloat(params[1], 64)
		must(err)
	} else {
		return "The /credit or /pay command should be like: \n /credit [<MonthYear>] <USDtoARS>. \n i.e. /credit 2020-06 90.00"
	}
	if pay {
		entries.ConfirmCreditPayment(monthYear, usdToArs)
	}

	return generateCreditReport(monthYear, usdToArs)
}

func generateCreditReport(monthYear string, usdToArs float64) string {
	var response string
	result, items := entries.GetCreditCardStatus(monthYear, usdToArs)
	response += fmt.Sprintf("\n 💳PAYING YOUR CREDIT CARD")
	response += fmt.Sprintf("\n 🐷PERIOD: %v", monthYear)
	response += fmt.Sprintf("\n 💵Amount in USD: $%0.2f", result["amountUSD"])
	response += fmt.Sprintf("\n 🇦🇷Amount in ARS: $%0.2f", result["amountARS"])
	response += fmt.Sprintf("\n 💰TOTAL IN ARS: $%0.2f", result["total"])
	response += fmt.Sprintf("\n Your credit items are: ")

	for _, item := range items {
		response += fmt.Sprintf("\n ☑ %s", item)
	}
	return response
}
