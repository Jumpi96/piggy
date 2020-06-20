package serverless

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	entries "../services"
)

var regAllParam = regexp.MustCompile(`\/status [0-9]{4}-[0-9]{2} ([0-9]*[.])?[0-9]+ ([0-9]*[.])?[0-9]+`)
var regButDate = regexp.MustCompile(`\/status ([0-9]*[.])?[0-9]+ ([0-9]*[.])?[0-9]+`)

func handleStatus(message string) string {
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
	} else if regButDate.MatchString(message) {
		monthYear = time.Now().Format("2006-01-02")[0:7]
		params = strings.Split(message, " ")
		amountPerDay, err = strconv.ParseFloat(params[1], 64)
		must(err)
		usdToArs, err = strconv.ParseFloat(params[2], 64)
		must(err)
	} else {
		return "The /status command should be like: \n /status [<MonthYear>] <AmountPerDay> <USDtoARS>. \n i.e. /status 2020-06 1000.00 90.00"
	}

	return generateReport(monthYear, amountPerDay, usdToArs)
}

func generateReport(monthYear string, amountPerDay float64, usdToArs float64) string {
	var response string
	result, stairs := entries.GetMonthStatus(toshlRepository, monthYear, amountPerDay, usdToArs)
	response = fmt.Sprintf("\n🐷PERIOD: %v", monthYear)
	response += fmt.Sprintf("\n💵YOUR CURRENT SITUATION: $%0.2f", result["diff"])
	response += fmt.Sprintf("\n💶That means for each remaining day: $%0.2f", result["dayRemaining"])
	response += fmt.Sprintf("\n💷Comparing with what you expected to have: $%0.2f\n\n", result["dayRemainingDiff"])

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
