package cmd

import (
	"fmt"
	"sort"
	"time"

	entries "../services"
	"github.com/spf13/cobra"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Get expenses status in a month.",
	Args:  cobra.NoArgs,
	Run: func(cmd *cobra.Command, args []string) {
		result, stairs := entries.GetMonthStatus(MonthYear, AmountPerDay)

		fmt.Printf("\n PERIOD: %v", MonthYear)
		fmt.Printf("\n YOUR CURRENT SITUATION: $%0.2f", result["diff"])
		fmt.Printf("\n That means for each remaining day: $%0.2f", result["dayRemaining"])
		fmt.Printf("\n Comparing with what you expected to have: $%0.2f\n\n", result["dayRemainingDiff"])

		var keys []int
		for k := range stairs {
			keys = append(keys, k)
		}
		sort.Ints(keys)

		for _, k := range keys {
			fmt.Printf(" %v ................. $%0.2f\n", k, stairs[k])
		}

		fmt.Printf("\n Your available cash should be: $%0.2f\n", result["cash"])
	},
}

var MonthYear string
var AmountPerDay float64

func init() {
	statusCmd.Flags().StringVarP(&MonthYear, "monthYear", "m", time.Now().Format("2006-01-02")[0:7], "month and year of the expenses or incomes")
	statusCmd.Flags().Float64VarP(&AmountPerDay, "amountPerDay", "a", 0.0, "amount of money per day")

	RootCmd.AddCommand(statusCmd)
}
