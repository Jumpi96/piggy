package cmd

import (
	"fmt"
	"strconv"
	"time"

	repo "../db"
	"github.com/spf13/cobra"
)

var addCmd = &cobra.Command{
	Use:   "add",
	Short: "Add an expense or income.",
	Args:  cobra.MinimumNArgs(3),
	Run: func(cmd *cobra.Command, args []string) {
		price, _ := strconv.ParseFloat(args[0], 32)
		if !Income {
			expense := repo.Expense{
				Date:          Date,
				Price:         float32(price),
				Paid:          false,
				CategoryRefer: repo.GetCategory(args[1]).ID,
				TagRefer:      repo.GetOrCreateTag(args[2], !Income).ID,
				CreditCard:    CreditCard,
				Currency:      Currency,
			}
			repo.CreateExpense(expense)
			fmt.Printf("Added to your expense list.\n")
		} else {

		}

	},
}

var Date string
var CreditCard bool
var Income bool
var Currency string

func init() {
	addCmd.Flags().StringVarP(&Date, "date", "d", time.Now().Format("02-01-2006"), "date of your expense or income")
	addCmd.Flags().StringVarP(&Currency, "currency", "m", "ARS", "is the currency the incredible ARSs?")
	addCmd.Flags().BoolVarP(&CreditCard, "credit", "c", false, "did you pay it with a credit card?")
	addCmd.Flags().BoolVarP(&Income, "income", "i", false, "is it an income?")

	RootCmd.AddCommand(addCmd)
}
