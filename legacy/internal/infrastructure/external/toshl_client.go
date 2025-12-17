package external

import (
	"fmt"
	"io"
	"net/http"
)

// ToshlClient handles HTTP communication with Toshl API
type ToshlClient struct {
	token   string
	baseURL string
}

// NewToshlClient creates a new Toshl API client
func NewToshlClient(token string) *ToshlClient {
	return &ToshlClient{
		token:   token,
		baseURL: "https://api.toshl.com/",
	}
}

// DoRequest performs an HTTP request to the Toshl API
func (c *ToshlClient) DoRequest(verb, url string, payload io.Reader) ([]byte, map[string][]string, error) {
	query := fmt.Sprintf("%s%s", c.baseURL, url)
	
	request, err := http.NewRequest(verb, query, payload)
	if err != nil {
		return nil, nil, err
	}
	
	request.SetBasicAuth(c.token, "")
	request.Header.Add("Content-Type", "application/json")
	
	client := &http.Client{}
	resp, err := client.Do(request)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	
	bodyText, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	
	// Convert http.Header to map[string][]string for compatibility
	headers := make(map[string][]string)
	for key, values := range resp.Header {
		headers[key] = values
	}
	
	return bodyText, headers, nil
}