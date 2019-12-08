package db

import (
	"strings"

	"github.com/jinzhu/gorm"
)

type Category struct {
	gorm.Model
	Expense bool
	Name    string
}

// InitCategories schema
func InitCategories() {
	// Migrate the schema

	DB.AutoMigrate(&Category{})
	DB.FirstOrCreate(&Category{}, Category{Name: "LIVING", Expense: true})
	DB.FirstOrCreate(&Category{}, Category{Name: "RECREATION", Expense: true})
	DB.FirstOrCreate(&Category{}, Category{Name: "DEBTS", Expense: true})
	DB.FirstOrCreate(&Category{}, Category{Name: "INVESTMENTS", Expense: true})
	DB.FirstOrCreate(&Category{}, Category{Name: "SALARY", Expense: false})
	DB.FirstOrCreate(&Category{}, Category{Name: "REIMBURSEMENTS", Expense: false})
	DB.FirstOrCreate(&Category{}, Category{Name: "LOANS", Expense: false})
	DB.FirstOrCreate(&Category{}, Category{Name: "GRANTS", Expense: false})
}

func GetCategory(name string) Category {
	var category Category
	DB.First(&category, &Category{Name: strings.ToUpper(name)})
	return category
}
