package db

import (
	"github.com/jinzhu/gorm"
)

// Expense in the db
type Expense struct {
	gorm.Model
	Date       string
	Price      float32
	Paid       bool
	CreditCard bool
}

// InitExpenses schema
func InitExpenses(db *gorm.DB) {
	// Migrate the schema
	db.AutoMigrate(&Expense{})
}
