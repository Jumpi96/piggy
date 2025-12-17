package entities

// Currency represents a financial currency with conversion rates
type Currency struct {
	Code     string  `json:"code"`
	Rate     float64 `json:"rate"`
	MainRate float64 `json:"main_rate"`
	Fixed    bool    `json:"fixed"`
}

// IsFixed returns whether the currency rate is fixed
func (c Currency) IsFixed() bool {
	return c.Fixed
}

func (c Currency) ConvertAmount(amount float64) float64 {
	return amount * c.Rate
}