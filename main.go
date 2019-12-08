package main

import (
	"fmt"
	"os"

	"./cmd"
	"./db"
)

func main() {
	db.Init("db.db")
	must(cmd.RootCmd.Execute())
}

func must(err error) {
	if err != nil {
		fmt.Println(err.Error())
		os.Exit(1)
	}
}
