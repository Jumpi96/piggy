package db

import (
	"github.com/jinzhu/gorm"
)

// Income in the db
type Income struct {
	gorm.Model
	Date          string
	Price         float32
	Paid          bool
	Category      Category `gorm:"foreignkey:CategoryRefer"`
	CategoryRefer uint
	Tag           Tag `gorm:"foreignkey:TagRefer"`
	TagRefer      uint
	Currency      string
}

// InitIncomes schema
func InitIncomes() {
	// Migrate the schema
	DB.AutoMigrate(&Income{})
}
