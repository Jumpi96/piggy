package services

import (
	"encoding/csv"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/araddon/dateparse"

	repo "../db"
)

func ImportToshlFile(path string) int {
	csvfile, err := os.Open(path)
	if err != nil {
		panic("Couldn't open the csv file")
	}

	r := csv.NewReader(csvfile)

	var count int
	var income bool
	var index int

	r.Read() // First line

	for {
		record, err := r.Read()

		if err == io.EOF {
			break
		}

		if err != nil {
			panic(err)
		}

		if record[4] == "0" {
			income = true
			index = 5
		} else {
			income = false
			index = 4
		}

		price, err := strconv.ParseFloat(CleanPrice(record[index]), 32)

		if err != nil {
			panic("Price couldn't be parsed.")
		}

		category := repo.GetCategoryByName(record[2], !income)
		tag := repo.GetOrCreateTagByName(record[3], !income)

		date, err := dateparse.ParseLocal(record[0])
		if err != nil {
			panic("Date couldn't be parsed.")
		}

		item := repo.Item{
			Date:          date.Format("2006-01-02"),
			Price:         float32(price),
			Paid:          true,
			CategoryRefer: category.ID,
			TagRefer:      tag.ID,
			CreditCard:    false,
			Currency:      record[6],
			Expense:       !income,
		}

		repo.CreateItem(item)
		count += 1
	}
	return count
}

func CleanPrice(price string) string {
	return strings.Replace(strings.Replace(price, ",", "", -1), "\"", "", -1)
}
