package main

import (
	"path/filepath"

	"./db"

	homedir "github.com/mitchellh/go-homedir"
)

func main() {
	home, _ := homedir.Dir()
	dbPath := filepath.Join(home, "db.db")
	db.Init(dbPath)
}
