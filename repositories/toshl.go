package repositories

import (
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
)

func doToshlRequest(verb string, url string) []byte {
	query := fmt.Sprintf("%v%v", config.ToshlAPI, url)
	request, err := http.NewRequest(verb, query, nil)
	request.SetBasicAuth(config.ToshlToken, "")
	client := &http.Client{}
	resp, err := client.Do(request)
	if err != nil {
		log.Fatal(err)
	}
	bodyText, err := ioutil.ReadAll(resp.Body)
	return bodyText
}
