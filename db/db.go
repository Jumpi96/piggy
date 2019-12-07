package db

import (
	"github.com/jinzhu/gorm"
)

var db *gorm.DB

// Init the database
func Init(path string) *gorm.DB {
	db, err := gorm.Open("sqlite3", path)
	if err != nil {
		panic("failed to connect database")
	}
	defer db.Close()

	InitExpenses(db)
	return db
}
