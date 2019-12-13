package db

import (
	"github.com/jinzhu/gorm"
)

// MonthlyItem in the db
type MonthlyItem struct {
	gorm.Model
	Day           uint
	Price         float32
	CreditCard    bool
	Category      Category `gorm:"foreignkey:CategoryRefer"`
	CategoryRefer uint
	Tag           Tag `gorm:"foreignkey:TagRefer"`
	TagRefer      uint
	Currency      string
	Expense       bool
}

// InitItems schema
func InitMonthlyItems() {
	// Migrate the schema
	DB.AutoMigrate(&MonthlyItem{})
}

func CreateMonthlyItem(item MonthlyItem) {
	DB.NewRecord(&item)
	DB.Create(&item)
}

func GetMonthlyItems(expenses bool) []MonthlyItem {
	var list []MonthlyItem
	var itemtype string
	if expenses {
		itemtype = "1"
	} else {
		itemtype = "0"
	}
	DB.Where("Expense = ?", itemtype).Find(&list)
	return list
}
