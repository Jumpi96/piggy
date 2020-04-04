package repositories

import (
	"fmt"
	"strconv"

	"github.com/boltdb/bolt"
)

var db *bolt.DB
var err error

// Init the database
func Init() {
	db, err = bolt.Open("db.db", 0600, nil)
	if err != nil {
		fmt.Printf("could not open db, %v", err)
	}
	err = db.Update(func(tx *bolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists([]byte("DB"))
		if err != nil {
			fmt.Printf("could not create root bucket: %v", err)
		}
		return nil
	})
	if err != nil {
		fmt.Printf("could not set up buckets, %v", err)
	}
}

func SetParam(key string, value float64) error {
	valueStr := fmt.Sprintf("%.2f", value)
	err := db.Update(func(tx *bolt.Tx) error {
		err = tx.Bucket([]byte("DB")).Put([]byte(key), []byte(valueStr))
		if err != nil {
			return fmt.Errorf("could not set param: %v", err)
		}
		return nil
	})
	return err
}

func GetParam(key string) (float64, error) {
	if err != nil {
		return -1, fmt.Errorf("could not get param: %v", err)
	}
	var param float64
	err = db.View(func(tx *bolt.Tx) error {
		paramString := string(tx.Bucket([]byte("DB")).Get([]byte(key)))
		param, err = strconv.ParseFloat(paramString, 64)
		return nil
	})
	return param, nil
}
