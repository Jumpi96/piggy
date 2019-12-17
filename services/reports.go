package services

import (
	"strconv"
	"time"

	db "../db"
)

func GetMonthStatus(monthYear string) map[string]float32 {
	usdToArs := db.GetCurrencyByName("USD").Value
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
	if IsFutureMonth(monthYear) {
		return daysInMonth
	} else if IsCurrentMonth(monthYear) {
		t := time.Now()
		return daysInMonth - t.Day()
	}
	return 1
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

func IsCurrentMonth(monthYear string) bool {
	now := time.Now()
	currentYear, currentMonth, _ := now.Date()
	currentLocation := now.Location()
	querydate, err := time.ParseInLocation("2006-01-02", monthYear+"-01", currentLocation)
	if err != nil {
		panic("Month couldn't be parsed!")
	}
	firstOfMonth := time.Date(currentYear, currentMonth, 1, 0, 0, 0, 0, currentLocation)
	return querydate.Equal(firstOfMonth)
}
