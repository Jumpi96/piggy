package cmd

import (
	"fmt"
	"os"
	"text/tabwriter"
	"time"

	repo "../db"
	items "../services"
	"github.com/spf13/cobra"
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List incomes or expenses in a month.",
	Args:  cobra.NoArgs,
	Run: func(cmd *cobra.Command, args []string) {
		w := new(tabwriter.Writer)
		w.Init(os.Stdout, 8, 8, 0, '\t', 0)
		defer w.Flush()
		items := items.GetItemsFromMonth(MonthYear, !Incomes)
		fmt.Fprintf(w, "\n %s\t%s\t%s\t%s\t%s\t%s\t%s\t", "Date", "Category", "Tag", "Price", "Currency", "Paid", "CreditCard")
		fmt.Fprintf(w, "\n %s\t%s\t%s\t%s\t%s\t%s\t%s\t", "----", "----", "----", "----", "----", "----", "----")

		for _, item := range items {
			var paid, credit string
			if item.Paid {
				paid = "yes"
			} else {
				paid = "no"
			}
			if item.CreditCard {
				credit = "yes"
			} else {
				credit = "no"
			}
			category := repo.GetCategory(item.CategoryRefer).Name
			tag := repo.GetTag(item.TagRefer).Name
			fmt.Fprintf(w, "\n %s\t%s\t%s\t%0.2f\t%s\t%s\t%s\t", item.Date, category, tag, item.Price, item.Currency, paid, credit)
		}
		fmt.Fprintf(w, "\n")
	},
}

var MonthYear string
var Incomes bool

func init() {
	listCmd.Flags().StringVarP(&MonthYear, "monthyear", "m", time.Now().Format("2006-01-02")[0:7], "month and year of the expenses or incomes")
	listCmd.Flags().BoolVarP(&Incomes, "incomes", "i", false, "do you want incomes?")

	RootCmd.AddCommand(listCmd)
}
