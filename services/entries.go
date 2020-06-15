package services

import (
	"fmt"
	"strconv"
	"time"

	entries "../repositories"
)

// ConfirmCreditPayment confirms payment of item
func ConfirmCreditPayment(monthYear string) {
	usdToArs, _ := entries.GetParam("USD")
	creditEntries := entries.GetCreditEntriesByMonth(monthYear)

	for _, entry := range creditEntries {
		err := entries.PayCreditEntry(payEntry(entry, usdToArs))
		if err != nil {
			fmt.Printf("Error paying entry ID: %s. Error: %e", entry.ID, err)
		}
	}
}

func payEntry(entry entries.Entry, usdToArs float64) entries.MinimalEntry {
	minEntry := entries.MinimalEntry{
		ID:        entry.ID,
		Date:      entry.Date,
		Account:   entry.Account,
		Category:  entry.Category,
		Modified:  entry.Modified,
		Completed: true,
	}
	minEntry.Tags = []string{}
	if len(entry.Tags) > 1 {
		for _, tag := range entry.Tags {
			if tag != entries.Configs.CreditTag {
				minEntry.Tags = append(minEntry.Tags, tag)
			}
		}
	} else {
		minEntry.Tags = entry.Tags
	}
	if entry.Currency.Code == "ARS" {
		minEntry.Currency = entry.Currency
		minEntry.Amount = entry.Amount
	} else {
		minEntry.Currency = entries.Currency{
			Code:     "ARS",
			Rate:     1.0,
			MainRate: 1.0,
			Fixed:    false,
		}
		minEntry.Amount = entry.Amount * usdToArs
	}
	return minEntry
}

// GetCreditCardStatus to get credit status report based in month and year.
func GetCreditCardStatus(monthYear string) (map[string]float64, []string) {
	usdToArs, _ := entries.GetParam("USD")

	totals := make(map[string]float64)
	totalUSD := float64(0.0)
	totalARS := float64(0.0)
	itemsList := []string{}

	entries := entries.GetCreditEntriesByMonth(monthYear)

	for _, entry := range entries {
		if entry.Currency.Code == "ARS" {
			totalARS += entry.Amount
		} else {
			totalUSD += entry.Amount
		}
		itemsList = append(itemsList, fmt.Sprintf("%s %0.2f", entry.Currency.Code, -1*entry.Amount))
	}

	totals["amountUSD"] = -1 * totalUSD
	totals["amountARS"] = -1 * totalARS
	totals["total"] = -1 * (totalUSD*usdToArs + totalARS)

	return totals, itemsList
}

// GetMonthStatus to create status report based in month and year.
func GetMonthStatus(monthYear string, amountPerDay float64, usdToArs float64) (map[string]float64, map[int]float64) {
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
