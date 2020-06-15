package serverless

import (
	"fmt"
	"sort"
	"time"

	entries "../services"
)

func handleStatus(message string) string {
	monthYear := time.Now().Format("2006-01-02")[0:7]
	amountPerDay := 1180.0
	usdToArs := 90.0
	result, stairs := entries.GetMonthStatus(monthYear, amountPerDay, usdToArs)

	var response string
	response = fmt.Sprintf("\n 🐷PERIOD: %v", monthYear)
	response += fmt.Sprintf("\n 💵YOUR CURRENT SITUATION: $%0.2f", result["diff"])
	response += fmt.Sprintf("\n 💶That means for each remaining day: $%0.2f", result["dayRemaining"])
	response += fmt.Sprintf("\n 💷Comparing with what you expected to have: $%0.2f\n\n", result["dayRemainingDiff"])

	var keys []int
	for k := range stairs {
		keys = append(keys, k)
	}
	sort.Ints(keys)

	for _, k := range keys {
		response += fmt.Sprintf(" %v ................. $%0.2f\n", k, stairs[k])
	}

	response += fmt.Sprintf("\n 💰Your available cash should be: $%0.2f\n", result["cash"])
	return response
}
