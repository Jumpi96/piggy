package cmd

import (
	"github.com/spf13/cobra"
)

var RootCmd = &cobra.Command{
	Use:   "piggy",
	Short: "Piggy is an expense manager",
}
