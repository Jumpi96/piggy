package services

import (
	"fmt"
	"time"

	repo "../db"
)

func GetItemsFromMonth(monthYear string, expenses bool) []repo.Item {
	items := repo.GetItemsFromMonth(monthYear, expenses)

	if IsCurrentMonth(monthYear) {
		monthlyitems := repo.GetMonthlyItems(expenses)
		for _, monthlyitem := range monthlyitems {
			day := fmt.Sprintf("-%02d", monthlyitem.Day)
			item := repo.Item{
				Date:          monthYear + day,
				Price:         monthlyitem.Price,
				Paid:          false,
				CategoryRefer: monthlyitem.CategoryRefer,
				TagRefer:      monthlyitem.TagRefer,
				CreditCard:    monthlyitem.CreditCard,
				Currency:      monthlyitem.Currency,
				Expense:       monthlyitem.Expense,
			}
			items = append(items, item)
		}
	}
	return items
}

func IsCurrentMonth(monthYear string) bool {
	querydate, _ := time.Parse("2006-01-02", monthYear+"-01")
	now := time.Now()
	currentYear, currentMonth, _ := now.Date()
	currentLocation := now.Location()
	firstOfMonth := time.Date(currentYear, currentMonth, 1, 0, 0, 0, 0, currentLocation)
	return firstOfMonth.Before(querydate)
}
