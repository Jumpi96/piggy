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

func GetCategoryByName(name string, expense bool) Category {
	var category Category
	DB.First(&category, &Category{Name: strings.ToUpper(name), Expense: expense})
	return category
}

func GetCategory(id uint) Category {
	var category Category
	DB.First(&category, id)
	return category
}
