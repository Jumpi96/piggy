package cmd

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	repo "../db"
	"github.com/spf13/cobra"
)

var addCmd = &cobra.Command{
	Use:   "add <price> <category> <tag>",
	Short: "Add an expense or income.",
	Args: func(cmd *cobra.Command, args []string) error {
		if len(args) != 3 {
			return errors.New("requires three arguments")
		}
		category := repo.GetCategoryByName(args[1], !Income)
		if category.ID == 0 {
			return errors.New("category does not exist")
		}
		_, err := strconv.ParseFloat(args[0], 32)
		if err != nil {
			return errors.New("price is not valid")
		}
		return nil
	},
	Run: func(cmd *cobra.Command, args []string) {
		price, _ := strconv.ParseFloat(args[0], 32)
		category := repo.GetCategoryByName(args[1], !Income)
		tag := repo.GetOrCreateTagByName(args[2], !Income)
		if Monthly {
			day, _ := strconv.Atoi(Date[8:10])
			item := repo.MonthlyItem{
				Day:           uint(day),
				Price:         float32(price),
				CategoryRefer: category.ID,
				TagRefer:      tag.ID,
				CreditCard:    CreditCard,
				Currency:      Currency,
				Expense:       !Income,
			}
			repo.CreateMonthlyItem(item)
			if Income {
				fmt.Printf("Added (%s - %s - %s$%0.2f) to your monthly incomes.\n", category.Name, tag.Name, Currency, item.Price)
			} else {
				fmt.Printf("Added (%s - %s - %s$%0.2f) to your monthly expenses.\n", category.Name, tag.Name, Currency, item.Price)
			}
		} else {
			item := repo.Item{
				Date:          Date,
				Price:         float32(price),
				Paid:          false,
				CategoryRefer: category.ID,
				TagRefer:      tag.ID,
				CreditCard:    CreditCard,
				Currency:      Currency,
				Expense:       !Income,
			}
			repo.CreateItem(item)
			if Income {
				fmt.Printf("Added (%s - %s - %s$%0.2f) to your incomes.\n", category.Name, tag.Name, Currency, item.Price)
			} else {
				fmt.Printf("Added (%s - %s - %s$%0.2f) to your expenses.\n", category.Name, tag.Name, Currency, item.Price)
			}
		}

	},
}

var Date string
var CreditCard bool
var Income bool
var Currency string
var Monthly bool

func init() {
	addCmd.Flags().StringVarP(&Date, "date", "d", time.Now().Format("2006-01-02"), "date of your expense or income")
	addCmd.Flags().StringVarP(&Currency, "currency", "m", "ARS", "is the currency the incredible ARSs?")
	addCmd.Flags().BoolVarP(&CreditCard, "credit", "c", false, "did you pay it with a credit card?")
	addCmd.Flags().BoolVarP(&Income, "income", "i", false, "is it an income?")
	addCmd.Flags().BoolVarP(&Monthly, "recurring", "r", false, "is it a monthly monthly income?")

	RootCmd.AddCommand(addCmd)
}
