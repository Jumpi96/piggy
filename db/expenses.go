package db

import (
	"github.com/jinzhu/gorm"
)

// Expense in the db
type Expense struct {
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
}

// InitExpenses schema
func InitExpenses() {
	// Migrate the schema
	DB.AutoMigrate(&Expense{})
}

func CreateExpense(expense Expense) {
	DB.NewRecord(&expense)
	DB.Create(&expense)
}