package db

import (
	"github.com/jinzhu/gorm"
)

type Tag struct {
	gorm.Model
	Expense bool
	Name    string
}

// InitTags schema
func InitTags() {
	// Migrate the schema
	DB.AutoMigrate(&Tag{})
}

func GetOrCreateTagByName(name string, expense bool) Tag {
	var tag Tag
	DB.Where(Tag{Name: name, Expense: expense}).FirstOrCreate(&tag)
	return tag
}

func GetTag(id uint) Tag {
	var tag Tag
	DB.First(&tag, id)
	return tag
}
