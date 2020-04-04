package repositories

import (
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
)

func doToshlRequest(verb string, url string, payload io.Reader) ([]byte, error) {
	query := fmt.Sprintf("%v%v", config.ToshlAPI, url)
	request, err := http.NewRequest(verb, query, payload)
	request.SetBasicAuth(config.ToshlToken, "")
	request.Header.Add("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	bodyText, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return bodyText, nil
}
