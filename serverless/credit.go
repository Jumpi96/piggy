package serverless

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	repositories "piggy/repositories"
	entries "piggy/services"

	"github.com/aws/aws-sdk-go/service/dynamodb"
	log "github.com/sirupsen/logrus"
)

var regCreditAllParam = regexp.MustCompile(`\/(credit|pay)(AR|NL) [0-9]{4}-[0-9]{2} ([0-9]*[.])?[0-9]+`)
var regCreditDateButMinimum = regexp.MustCompile(`\/(credit|pay)(AR|NL) [0-9]{4}-[0-9]{2}`)
var regCreditButDate = regexp.MustCompile(`\/(credit|pay)(AR|NL) ([0-9]*[.])?[0-9]+`)
var regCreditMinimum = regexp.MustCompile(`\/(credit|pay)(AR|NL)`)
var errCreditPay = "The /credit or /pay command should be like: \n /credit [<MonthYear>] <USDtoARS>. \n i.e. /credit 2020-06 90.00"

func handleCredit(client dynamodb.DynamoDB, message string, pay bool) string {
	var monthYear time.Time
	var usdToArs float64
	var err error
	var params []string

	if regCreditAllParam.MatchString(message) {
		params = strings.Split(message, " ")
		monthYear, err = ParseMonthYear(params[1])
		if err != nil {
			log.Errorf("could not parse monthYear: %v", monthYear)
			return errCreditPay
		}
		usdToArs, err = strconv.ParseFloat(params[2], 64)
		if err != nil {
			log.Errorf("could not parse usdToArs: %v", monthYear)
			return errCreditPay
		}
		err = repositories.SetParam(client, "USD2ARS", usdToArs)
		if err != nil {
			log.Errorf("error setting USD2ARS: %v", monthYear)
			return errCreditPay
		}
	} else if regCreditDateButMinimum.MatchString(message) {
		params = strings.Split(message, " ")
		monthYear, err = ParseMonthYear(params[1])
		if err != nil {
			log.Errorf("could not parse monthYear: %v", monthYear)
			return errCreditPay
		}
		usdToArs, err = repositories.GetParam(client, "USD2ARS")
		if err != nil {
			log.Errorf("error getting USD2ARS: %v", monthYear)
			return errorNoParameters
		}
	} else if regCreditButDate.MatchString(message) {
		monthYear = time.Now()
		params = strings.Split(message, " ")
		usdToArs, err = strconv.ParseFloat(params[2], 64)
		if err != nil {
			log.Errorf("could not parse usdToArs: %v", monthYear)
			return errCreditPay
		}
		err = repositories.SetParam(client, "USD2ARS", usdToArs)
		if err != nil {
			log.Errorf("error setting USD2ARS: %v", monthYear)
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
	if strings.Contains(message, "AR") {
		if pay {
			err = entries.ConfirmCreditPayment(toshlRepository, monthYear, repositories.Configs.CreditTag, usdToArs)
			if err != nil {
				log.Errorf("error paying creditAR in Toshl: %v", err)
				return errCreditPay
			}
		}
		res, err = generateCreditARReport(monthYear, usdToArs)
	} else {
		if pay {
			err = entries.ConfirmCreditPayment(toshlRepository, monthYear, repositories.Configs.CreditNLTag, usdToArs)
			if err != nil {
				log.Errorf("error paying creditNL in Toshl: %v", err)
				return errCreditPay
			}
		}
		res, err = generateCreditNLReport(monthYear, usdToArs)
	}
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
	response += fmt.Sprintf("\n💳PAYING YOUR 🇳🇱CREDIT CARD🇳🇱")
	response += fmt.Sprintf("\n🐷PERIOD: %v", monthYear)
	response += fmt.Sprintf("\n💰TOTAL: €%0.2f", result["amountUSD"])
	response += fmt.Sprintf("\nYour credit items are: ")

	for _, item := range items {
		response += fmt.Sprintf("\n ☑ %s", item)
	}
	return response, nil
}

func generateCreditARReport(monthYear time.Time, usdToArs float64) (string, error) {
	var response string
	result, items, err := entries.GetCreditCardStatus(toshlRepository, monthYear, usdToArs, repositories.Configs.CreditTag)
	if err != nil {
		return "", err
	}
	response += fmt.Sprintf("\n💳PAYING YOUR 🇦🇷CREDIT CARD🇦🇷")
	response += fmt.Sprintf("\n🐷PERIOD: %v", monthYear)
	response += fmt.Sprintf("\n💵Amount in USD: $%0.2f ($%0.2f per U$D)", result["amountUSD"], usdToArs)
	response += fmt.Sprintf("\n🇦🇷Amount in ARS: $%0.2f", result["amountARS"])
	response += fmt.Sprintf("\n💰TOTAL IN ARS: $%0.2f", result["total"])
	response += fmt.Sprintf("\nYour credit items are: ")

	for _, item := range items {
		response += fmt.Sprintf("\n ☑ %s", item)
	}
	return response, nil
}
