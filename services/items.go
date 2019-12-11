package services

import (
	"fmt"
	"time"

	repo "../db"
)

func GetItemsFromMonth(monthyear string, expenses bool) []repo.Item {
	items := repo.GetItemsFromMonth(monthyear, expenses)
	querydate, _ := time.Parse("2006-01-02", monthyear+"-01")
	now := time.Now()
	currentYear, currentMonth, _ := now.Date()
	currentLocation := now.Location()
	firstOfMonth := time.Date(currentYear, currentMonth, 1, 0, 0, 0, 0, currentLocation)
	if firstOfMonth.Before(querydate) {
		monthlyitems := repo.GetMonthlyItems(expenses)
		for _, monthlyitem := range monthlyitems {
			day := fmt.Sprintf("-%02d", monthlyitem.Day)
			item := repo.Item{
				Date:          monthyear + day,
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
