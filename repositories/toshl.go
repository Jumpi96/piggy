package repositories

import (
	"io/ioutil"
	"log"
	"net/http"
)

func DoToshlRequest(verb string, url string) []byte {
	request, err := http.NewRequest(verb, url, nil)
	request.SetBasicAuth(config.ToshlToken, "")
	client := &http.Client{}
	resp, err := client.Do(request)
	if err != nil {
		log.Fatal(err)
	}
	bodyText, err := ioutil.ReadAll(resp.Body)
	return bodyText
}
