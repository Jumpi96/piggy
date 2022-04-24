package services

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	entries "piggy/repositories"
)

// ConfirmCreditPayment confirms payment of item
func ConfirmCreditPayment(e entries.EntriesRepo, monthYear time.Time, tag string, usdToArs float64) error {
	creditEntries, err := e.GetEntriesByMonth(monthYear, tag)
	if err != nil {
		return err
	}

	for _, entry := range creditEntries {
		err := e.PutEntry(payEntry(entry, tag, usdToArs))
		if err != nil {
			fmt.Printf("Error paying entry ID: %s. Error: %e", entry.ID, err)
			return err
		}
	}

	return nil
}

func SetCurrencies(e entries.EntriesRepo, monthYear time.Time, usdToArs float64, eurToUsd float64) (int, error) {
	entries, err := e.GetEntriesByMonth(monthYear, "")
	if err != nil {
		return 0, err
	}

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
func GetCreditCardStatus(e entries.EntriesRepo, monthYear time.Time, usdToArs float64, tags string) (map[string]float64, []string, error) {

	totals := make(map[string]float64)
	totalUSD := float64(0.0)
	totalARS := float64(0.0)
	itemsList := []string{}

	entries, err := e.GetEntriesByMonth(monthYear, tags)
	if err != nil {
		return nil, nil, err
	}

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

	return totals, itemsList, nil
}

func GetBalance(e entries.EntriesRepo, fromDate string, toDate string, amountPerDay float64, usdToArs float64, eurToUsd float64) (map[string]float64, error) {
	totals := make(map[string]float64)
	total := float64(0.0)
	from := formatDate(fromDate)
	to := formatDate(toDate)
	remainingDays := float64(int(to.Sub(from).Hours() / 24))

	entries, err := e.GetEntriesFromTo(from, to, "")
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if entry.Currency.Code == "EUR" {
			total += entry.Amount
		} else if entry.Currency.Code == "ARS" {
			total += entry.Amount / (usdToArs * eurToUsd)
		} else {
			total += entry.Amount / eurToUsd
		}
	}

	totals["diff"] = total
	totals["dayRemainingDiff"] = total - amountPerDay*remainingDays

	return totals, nil
}

// GetMonthStatus to create status report based in month and year.
func GetMonthStatus(e entries.EntriesRepo, monthYear time.Time, amountPerDay float64, usdToArs float64, eurToUsd float64) (map[string]float64, map[int]float64, error) {
	totals := make(map[string]float64)
	total := float64(0.0)
	cash := float64(0.0)
	balance := float64(0.0)
	monthEntries, err := e.GetEntriesByMonth(monthYear, "")
	var daysModifier float64

	if err != nil {
		return nil, nil, err
	}

	currentLocation, _ := time.LoadLocation(entries.Configs.TimeZone)
	year, month, day := time.Now().In(currentLocation).Date()
	today := time.Date(year, month, day, 0, 0, 0, 0, currentLocation)

	remainingDays := float64(daysUntilEndOfMonth(monthYear, today))

	if isCurrentMonth(monthYear, today) {
		daysModifier = 1.0
	} else {
		daysModifier = 0.0
	}

	for _, entry := range monthEntries {
		entryDate, _ := time.ParseInLocation("2006-01-02", entry.Date, currentLocation)
		if entry.Currency.Code == "EUR" {
			total += entry.Amount
			if entryDate.Before(today) || entryDate.Equal(today) {
				cash += entry.Amount
			}
			if contains(entry.Tags, entries.Configs.BalanceTag) {
				balance -= entry.Amount
			}
		} else if entry.Currency.Code == "ARS" {
			total += entry.Amount / (usdToArs * eurToUsd)
			if entryDate.Before(today) || entryDate.Equal(today) {
				cash += entry.Amount / (usdToArs * eurToUsd)
			}
			if contains(entry.Tags, entries.Configs.BalanceTag) {
				balance -= entry.Amount / (usdToArs * eurToUsd)
			}
		} else {
			total += entry.Amount / eurToUsd
			if entryDate.Before(today) || entryDate.Equal(today) {
				cash += entry.Amount / eurToUsd
			}
			if contains(entry.Tags, entries.Configs.BalanceTag) {
				balance -= entry.Amount / eurToUsd
			}
		}
	}

	totals["diff"] = total
	totals["cash"] = cash
	totals["balance"] = balance
	totals["dayRemaining"] = total / remainingDays
	totals["dayRemainingDiff"] = total - amountPerDay*(remainingDays-daysModifier)

	return totals, calcStairs(monthYear, total, today), nil
}

func formatDate(date string) time.Time {
	currentLocation, _ := time.LoadLocation(entries.Configs.TimeZone)
	year, _ := strconv.Atoi(date[:4])
	month, _ := strconv.Atoi(date[5:7])
	day, _ := strconv.Atoi(date[8:])
	return time.Date(year, time.Month(month), day, 0, 0, 0, 0, currentLocation)
}

func calcStairs(monthYear time.Time, total float64, today time.Time) map[int]float64 {
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

func daysUntilEndOfMonth(monthYear time.Time, today time.Time) int {
	daysInMonth := daysInAMonth(monthYear)

	if isFutureMonth(monthYear, today) {
		return daysInMonth
	} else if isCurrentMonth(monthYear, today) {
		return daysInMonth - today.Day() + 1
	}
	return 1
}

func daysInAMonth(monthYear time.Time) int {
	t := time.Date(monthYear.Year(), monthYear.Month()+1, 0, 0, 0, 0, 0, time.UTC)
	return t.Day()
}

func isFutureMonth(monthYear time.Time, now time.Time) bool {
	return monthYear.Year() > now.Year() ||
		(monthYear.Year() == now.Year() && monthYear.Month() > now.Month())
}

func isCurrentMonth(monthYear time.Time, today time.Time) bool {
	return monthYear.Month() == today.Month() && monthYear.Year() == today.Year()
}

func contains(s []string, list string) bool {
	tags := strings.Split(list, ",")
	for _, a := range s {
		for _, e := range tags {
			if a == e {
				return true
			}
		}
	}
	return false
}
