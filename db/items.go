package db

import (
	"fmt"

	"github.com/jinzhu/gorm"
)

// Item in the db
type Item struct {
	gorm.Model
	Date          string
	Price         float32
	Paid          bool
	CreditCard    bool
	Category      Category `gorm:"foreignkey:CategoryRefer"`
	CategoryRefer uint
	Tag           Tag `gorm:"foreignkey:TagRefer"`
	TagRefer      uint
	Currency      string
	Expense       bool
}

// InitItems schema
func InitItems() {
	// Migrate the schema
	DB.AutoMigrate(&Item{})
}

func CreateItem(item Item) {
	DB.NewRecord(&item)
	DB.Create(&item)
}

func GetItemsFromMonth(monthyear string, expenses bool) []Item {
	var list []Item
	var itemtype string
	if expenses {
		itemtype = "1"
	} else {
		itemtype = "0"
	}
	query := fmt.Sprintf("Date BETWEEN '%s-01' AND '%s-31' AND Expense = %s", monthyear, monthyear, itemtype)
	DB.Where(query).Find(&list)
	return list
}
