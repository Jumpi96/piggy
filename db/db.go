package db

import (
	"github.com/jinzhu/gorm"
	_ "github.com/mattn/go-sqlite3" // SQLite3 driver
)

var DB *gorm.DB

// Init the database
func Init(path string) *gorm.DB {
	var err error
	DB, err = gorm.Open("sqlite3", path)
	if err != nil {
		panic("failed to connect database")
	}

	InitItems()
	InitMonthlyItems()
	InitTags()
	InitCategories()
	return DB
}
