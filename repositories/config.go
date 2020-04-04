package repositories

import (
	"encoding/json"
	"os"
)

type Config struct {
	ToshlToken string
}

var config Config

func InitConfig() error {
	file, err := os.Open("config.json")
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(file)
	err = decoder.Decode(&config)
	if err != nil {
		return err
	}
	return nil
}
