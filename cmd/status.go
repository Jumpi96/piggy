package cmd

import (
	"fmt"
	"time"

	items "../services"
	"github.com/spf13/cobra"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Get expenses status in a month.",
	Args:  cobra.NoArgs,
	Run: func(cmd *cobra.Command, args []string) {
		result := items.GetMonthStatus(MonthYear)
		fmt.Printf(" You got: $%0.2f", result["incomes"])
		fmt.Printf("\n You have to give: $%0.2f", result["expenses"])
		fmt.Printf("\n YOUR CURRENT SITUATION: $%0.2f", result["diff"])
		fmt.Printf("\n That means for each remaining day: $%0.2f", result["dayRemaining"])
		fmt.Printf("\n USD-ARS: $%0.2f \n", result["usd"])

	},
}

func init() {
	statusCmd.Flags().StringVarP(&MonthYear, "monthYear", "m", time.Now().Format("2006-01-02")[0:7], "month and year of the expenses or incomes")
	statusCmd.Flags().BoolVarP(&Incomes, "incomes", "i", false, "do you want incomes?")

	RootCmd.AddCommand(statusCmd)
}
