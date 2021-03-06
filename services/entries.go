package services

import (
	"fmt"
	"strconv"
	"time"

	entries "../repositories"
)

// ConfirmCreditPayment confirms payment of item
func ConfirmCreditPayment(e entries.EntriesRepo, monthYear string, tag string, usdToArs float64) error {
	creditEntries := e.GetEntriesByMonth(monthYear, tag)

	for _, entry := range creditEntries {
		err := e.PutEntry(payEntry(entry, tag, usdToArs))
		if err != nil {
			fmt.Printf("Error paying entry ID: %s. Error: %e", entry.ID, err)
			return err
		}
	}

	return nil
}

func SetCurrencies(e entries.EntriesRepo, monthYear string, usdToArs float64, eurToUsd float64) (int, error) {
	entries := e.GetEntriesByMonth(monthYear, "")
	var cont int

	for _, entry := range entries {
		if entry.Currency.Code == "ARS" {
			err := e.PutEntry(setEntry(entry, usdToArs, eurToUsd))
			if err != nil {
				fmt.Printf("Error setting entry ID: %s. Error: %e", entry.ID, err)
				return 0, err
			}
			cont++
		}
	}
	return cont, nil
}

func setEntry(entry entries.Entry, usdToArs float64, eurToUsd float64) entries.MinimalEntry {
	minEntry := entries.MinimalEntry{
		ID:        entry.ID,
		Date:      entry.Date,
		Account:   entry.Account,
		Category:  entry.Category,
		Modified:  entry.Modified,
		Amount:    entry.Amount,
		Tags:      entry.Tags,
		Completed: entry.Completed,
	}
	minEntry.Currency = entries.Currency{
		Code:     entry.Currency.Code,
		Rate:     usdToArs * eurToUsd,
		MainRate: entry.Currency.MainRate,
		Fixed:    true,
	}
	return minEntry
}

func payEntry(entry entries.Entry, creditTag string, usdToArs float64) entries.MinimalEntry {
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
			if tag != creditTag {
				minEntry.Tags = append(minEntry.Tags, tag)
			}
		}
	} else {
		minEntry.Tags = entry.Tags
	}
	if entry.Currency.Code != "USD" {
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
func GetCreditCardStatus(e entries.EntriesRepo, monthYear string, usdToArs float64, tags string) (map[string]float64, []string) {

	totals := make(map[string]float64)
	totalUSD := float64(0.0)
	totalARS := float64(0.0)
	itemsList := []string{}

	entries := e.GetEntriesByMonth(monthYear, tags)

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
func GetMonthStatus(e entries.EntriesRepo, monthYear string, amountPerDay float64, usdToArs float64, eurToUsd float64) (map[string]float64, map[int]float64) {
	totals := make(map[string]float64)
	total := float64(0.0)
	cash := float64(0.0)
	monthEntries := e.GetEntriesByMonth(monthYear, "")

	currentLocation, _ := time.LoadLocation(entries.Configs.TimeZone)
	year, month, day := time.Now().In(currentLocation).Date()
	today := time.Date(year, month, day, 0, 0, 0, 0, currentLocation)

	remainingDays := float64(daysUntilEndOfMonth(monthYear, today))

	for _, entry := range monthEntries {
		entryDate, _ := time.Parse("2006-01-02", entry.Date)
		if entry.Currency.Code == "EUR" {
			total += entry.Amount
			if entryDate.Before(today) {
				cash += entry.Amount
			}
		} else if entry.Currency.Code == "ARS" {
			total += entry.Amount / (usdToArs * eurToUsd)
			if entryDate.Before(today) {
				cash += entry.Amount / (usdToArs * eurToUsd)
			}
		} else {
			total += entry.Amount / eurToUsd
			if entryDate.Before(today) {
				cash += entry.Amount / eurToUsd
			}
		}
	}

	totals["diff"] = total
	totals["cash"] = cash
	totals["dayRemaining"] = total / remainingDays
	totals["dayRemainingDiff"] = total - amountPerDay*remainingDays

	return totals, calcStairs(monthYear, total, today)
}

func calcStairs(monthYear string, total float64, today time.Time) map[int]float64 {
	stairs := make(map[int]float64)

	var dayStart int
	if isCurrentMonth(monthYear, today) {
		dayStart = today.Day()
	} else {
		dayStart = 1
	}

	for i := dayStart; i <= daysInAMonth(monthYear); i++ {
		stairs[i] = total / float64(daysInAMonth(monthYear)-i+1)
	}

	return stairs
}

func daysUntilEndOfMonth(monthYear string, today time.Time) int {
	daysInMonth := daysInAMonth(monthYear)
	if isFutureMonth(monthYear, today) {
		return daysInMonth
	} else if isCurrentMonth(monthYear, today) {
		return daysInMonth - today.Day() + 1
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

func isCurrentMonth(monthYear string, now time.Time) bool {
	currentYear, currentMonth, _ := now.Date()
	currentLocation := now.Location()
	querydate, err := time.ParseInLocation("2006-01-02", monthYear+"-01", currentLocation)
	if err != nil {
		panic("Month couldn't be parsed!")
	}
	firstOfMonth := time.Date(currentYear, currentMonth, 1, 0, 0, 0, 0, currentLocation)
	return querydate.Equal(firstOfMonth)
}

func isFutureMonth(monthYear string, now time.Time) bool {
	currentYear, currentMonth, _ := now.Date()
	currentLocation := now.Location()
	querydate, err := time.ParseInLocation("2006-01-02", monthYear+"-01", currentLocation)
	if err != nil {
		panic("Month couldn't be parsed!")
	}
	firstOfMonth := time.Date(currentYear, currentMonth, 1, 0, 0, 0, 0, currentLocation)
	return querydate.After(firstOfMonth)
}
