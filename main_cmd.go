package main

import (
	"fmt"
	"os"

	"./cmd"
	repositories "./repositories"
)

func main() {
	must(repositories.InitDB())
	must(repositories.InitConfig())
	must(cmd.RootCmd.Execute())
}

func must(err error) {
	if err != nil {
		fmt.Println(err.Error())
		os.Exit(1)
	}
}
