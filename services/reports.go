package services

import (
	"strconv"
	"time"
)

func GetMonthStatus(monthYear string) map[string]float32 {
	usdToArs := USDtoARS(1.0)
	m := make(map[string]float32)
	expTotal := float32(0.0)
	incTotal := float32(0.0)
	expenses := GetItemsFromMonth(monthYear, true)

	for _, expense := range expenses {
		if expense.Currency == "ARS" {
			expTotal += expense.Price
		} else {
			expTotal += expense.Price * usdToArs
		}
	}

	incomes := GetItemsFromMonth(monthYear, false)

	for _, income := range incomes {
		if income.Currency == "ARS" {
			incTotal += income.Price
		} else {
			incTotal += income.Price * usdToArs
		}
	}
	m["expenses"] = expTotal
	m["incomes"] = incTotal
	m["diff"] = incTotal - expTotal
	m["dayRemaining"] = (incTotal - expTotal) / float32(DaysUntilEndOfMonth(monthYear))
	m["usd"] = usdToArs
	return m
}

func DaysUntilEndOfMonth(monthYear string) int {
	daysInMonth := DaysInAMonth(monthYear)
	if IsCurrentMonth(monthYear) {
		year, err := strconv.Atoi(monthYear[0:4])
		if err != nil {
			panic("Failed to convert string to year")
		}
		month, err := strconv.Atoi(monthYear[5:7])
		if err != nil {
			panic("Failed to convert string to year")
		}
		t := time.Date(year, time.Month(month), 0, 0, 0, 0, 0, time.UTC)
		return daysInMonth - t.Day()
	}
	return daysInMonth
}

func DaysInAMonth(monthYear string) int {
	year, err := strconv.Atoi(monthYear[0:4])
	if err != nil {
		panic("Failed to convert string to year")
	}
	month, err := strconv.Atoi(monthYear[5:7])
	if err != nil {
		panic("Failed to convert string to year")
	}
	t := time.Date(year, time.Month(month+1), 0, 0, 0, 0, 0, time.UTC)
	return t.Day()
}
