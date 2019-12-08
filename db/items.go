package db

import (
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
