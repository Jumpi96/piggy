package services

import (
	"strconv"
	"time"

	entries "../repositories"
)

// GetMonthStatus to create status report based in month and year.
func GetMonthStatus(monthYear string, amountPerDay float64) (map[string]float64, map[int]float64) {
	usdToArs, _ := entries.GetParam("USD")
	if amountPerDay == 0.0 {
		amountPerDay, _ = entries.GetParam("ApD")
	}
	totals := make(map[string]float64)
	total := float64(0.0)
	cash := float64(0.0)
	entries := entries.GetEntriesByMonth(monthYear)
	remainingDays := float64(daysUntilEndOfMonth(monthYear))

	year, month, day := time.Now().Date()
	today := time.Date(year, month, day, 0, 0, 0, 0, time.Now().Location())

	for _, entry := range entries {
		entryDate, _ := time.Parse("2006-01-02", entry.Date)
		if entry.Currency.Code == "ARS" {
			total += entry.Amount
			if entryDate.Before(today) {
				cash += entry.Amount
			}
		} else {
			total += entry.Amount * usdToArs
			if entryDate.Before(today) {
				cash += entry.Amount * usdToArs
			}
		}
	}

	totals["diff"] = total
	totals["cash"] = cash
	totals["dayRemaining"] = total / remainingDays
	totals["dayRemainingDiff"] = total - amountPerDay*remainingDays

	return totals, calcStairs(monthYear, total)
}

func calcStairs(monthYear string, total float64) map[int]float64 {
	stairs := make(map[int]float64)

	var dayStart int
	if isCurrentMonth(monthYear) {
		dayStart = time.Now().Day()
	} else {
		dayStart = 1
	}

	for i := dayStart; i <= daysInAMonth(monthYear); i++ {
		stairs[i] = total / float64(daysInAMonth(monthYear)-i+1)
	}

	return stairs
}

func daysUntilEndOfMonth(monthYear string) int {
	daysInMonth := daysInAMonth(monthYear)
	if isFutureMonth(monthYear) {
		return daysInMonth
	} else if isCurrentMonth(monthYear) {
		t := time.Now()
		return daysInMonth - t.Day() + 1
	}
	return 1
}

func daysInAMonth(monthYear string) int {
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

func isCurrentMonth(monthYear string) bool {
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

func isFutureMonth(monthYear string) bool {
	now := time.Now()
	currentYear, currentMonth, _ := now.Date()
	currentLocation := now.Location()
	querydate, err := time.ParseInLocation("2006-01-02", monthYear+"-01", currentLocation)
	if err != nil {
		panic("Month couldn't be parsed!")
	}
	firstOfMonth := time.Date(currentYear, currentMonth, 1, 0, 0, 0, 0, currentLocation)
	return querydate.After(firstOfMonth)
}
