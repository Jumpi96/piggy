package db

import (
	"encoding/json"
	"io/ioutil"
	"net/http"

	"github.com/jinzhu/gorm"
)

type Currency struct {
	gorm.Model
	Name  string
	Value float32
}

// InitCurrencies schema
func InitCurrencies() {
	// Migrate the schema

	DB.AutoMigrate(&Currency{})
}

func GetCurrencyByName(name string) Currency {
	var currency Currency
	DB.First(&currency, &Currency{Name: name})
	return currency
}

type APICurrency struct {
	Disclaimer string `json:"disclaimer"`
	License    string `json:"license"`
	Timestamp  int    `json:"timestamp"`
	Base       string `json:"base"`
	Rates      struct {
		ARS float32 `json:"ARS"`
	} `json:"rates"`
}

func USDtoARS(usd float32) float32 {

	url := "https://openexchangerates.org/api/latest.json?app_id=6097390c8e5f4bb39127c0b97a3dc16b"

	req, err := http.Get(url)
	if err != nil {
		panic(err)
	}

	defer req.Body.Close()
	body, err := ioutil.ReadAll(req.Body)

	if err != nil {
		panic(err)
	}

	var result APICurrency
	json.Unmarshal([]byte(body), &result)
	return result.Rates.ARS * usd
}
