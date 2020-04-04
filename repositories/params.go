package repositories

import (
	"fmt"
	"strconv"

	"github.com/boltdb/bolt"
)

var db *bolt.DB

// InitDB the database
func InitDB() error {
	var err error
	db, err = bolt.Open("db.db", 0600, nil)
	if err != nil {
		return fmt.Errorf("could not open db, %v", err)
	}
	err = db.Update(func(tx *bolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists([]byte("DB"))
		if err != nil {
			return fmt.Errorf("could not create root bucket: %v", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("could not set up buckets, %v", err)
	}
	return nil
}

func SetParam(key string, value float64) error {
	var err error
	valueStr := fmt.Sprintf("%.2f", value)
	err = db.Update(func(tx *bolt.Tx) error {
		err = tx.Bucket([]byte("DB")).Put([]byte(key), []byte(valueStr))
		if err != nil {
			return fmt.Errorf("could not set param: %v", err)
		}
		return nil
	})
	return err
}

func GetParam(key string) (float64, error) {
	var err error
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
