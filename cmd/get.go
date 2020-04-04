package cmd

import (
	"errors"
	"fmt"

	params "../repositories"
	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get <key>",
	Short: "Get param value.",
	Args: func(cmd *cobra.Command, args []string) error {
		if len(args) != 1 {
			return errors.New("requires two arguments")
		}
		return nil
	},
	Run: func(cmd *cobra.Command, args []string) {
		value, err := params.GetParam(args[0])
		if err != nil {
			fmt.Printf("%v", err)
		}
		fmt.Printf("Parameter: %v. Value: %v.\n", args[0], value)
	},
}

func init() {
	RootCmd.AddCommand(getCmd)
}
