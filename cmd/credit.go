package cmd

import (
	"fmt"
	"time"

	entries "../services"
	"github.com/spf13/cobra"
)

var creditCmd = &cobra.Command{
	Use:   "credit",
	Short: "Status of credit card before payment.",
	Args:  cobra.NoArgs,
	Run: func(cmd *cobra.Command, args []string) {
		result, items := entries.GetCreditCardStatus(monthYear)
		fmt.Printf("\nPAYING YOUR CREDIT CARD")
		fmt.Printf("\n PERIOD: %v", monthYear)
		fmt.Printf("\n Amount in USD: $%0.2f", result["amountUSD"])
		fmt.Printf("\n Amount in ARS: $%0.2f", result["amountARS"])
		fmt.Printf("\n TOTAL IN ARS: $%0.2f", result["total"])
		fmt.Print("\n Your credit items are: ")

		for _, item := range items {
			fmt.Printf("\n ... %s", item)
		}
		fmt.Println()
	},
}

var confirm bool

func init() {
	creditCmd.Flags().StringVarP(&monthYear, "monthYear", "m", time.Now().Format("2006-01-02")[0:7], "month and year of the expenses or incomes")
	creditCmd.Flags().BoolVarP(&confirm, "confirm", "c", false, "confirm the payment")

	RootCmd.AddCommand(creditCmd)
}
