package cmd

import (
	"fmt"

	items "../services"
	"github.com/spf13/cobra"
)

var importCmd = &cobra.Command{
	Use:   "import",
	Short: "Import items from Toshl file.",
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("Imported %v items. \n", items.ImportToshlFile(args[0]))
	},
}

func init() {
	RootCmd.AddCommand(importCmd)
}
