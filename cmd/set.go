package cmd

import (
	"errors"
	"fmt"
	"strconv"

	params "../repositories"
	"github.com/spf13/cobra"
)

var setCmd = &cobra.Command{
	Use:   "set <key> <value>",
	Short: "Set param value.",
	Args: func(cmd *cobra.Command, args []string) error {
		if len(args) != 2 {
			return errors.New("requires two arguments")
		}
		_, err := strconv.ParseFloat(args[1], 64)
		if err != nil {
			return errors.New("value is not valid")
		}
		return nil
	},
	Run: func(cmd *cobra.Command, args []string) {
		value, _ := strconv.ParseFloat(args[1], 64)
		err := params.SetParam(args[0], value)
		if err != nil {
			fmt.Printf("%v", err)
		}
	},
}

func init() {
	RootCmd.AddCommand(setCmd)
}
