package main

import (
	"fmt"
	"os"

	"./cmd"
	params "./repositories"
)

func main() {
	params.Init()
	must(cmd.RootCmd.Execute())
}

func must(err error) {
	if err != nil {
		fmt.Println(err.Error())
		os.Exit(1)
	}
}
