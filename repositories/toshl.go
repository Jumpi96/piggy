package repositories

import (
	"io/ioutil"
	"log"
	"net/http"
)

func DoToshlRequest(verb string, url string) []byte {
	request, err := http.NewRequest(verb, url, nil)
	// TODO: use config file.
	request.SetBasicAuth("12b914d4-1b81-45c8-bdc5-f5ef7028af8c728e6370-42be-4c39-aa54-666b2ae25c78", "")
	client := &http.Client{}
	resp, err := client.Do(request)
	if err != nil {
		log.Fatal(err)
	}
	bodyText, err := ioutil.ReadAll(resp.Body)
	return bodyText
}
