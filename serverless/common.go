package serverless

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"

	repositories "../repositories"
	"github.com/aws/aws-lambda-go/events"
)

// Update struct
type Update struct {
	UpdateID int     `json:"update_id"`
	Message  Message `json:"message"`
}

// Message struct
type Message struct {
	MessageID int        `json:"message_id"`
	From      From       `json:"from"`
	Chat      Chat       `json:"chat"`
	Date      int        `json:"date"`
	Text      string     `json:"text"`
	Entities  []Entities `json:"entities"`
}

// From struct
type From struct {
	ID           int    `json:"id"`
	FirstName    string `json:"first_name"`
	UserName     string `json:"username"`
	LanguageCode string `json:"language_code"`
}

// Chat struct
type Chat struct {
	ID                          int    `json:"id"`
	FirstName                   string `json:"first_name"`
	UserName                    string `json:"username"`
	Type                        string `json:"type"`
	Title                       string `json:"title"`
	AllMembersAreAdministrators bool   `json:"all_members_are_administrators"`
}

// Entities struct
type Entities struct {
	Type   string `json:"type"`
	Offset int    `json:"offset"`
	Length int    `json:"length"`
}

// TelegramMessage struct
type TelegramMessage struct {
	ChatID int    `json:"chat_id"`
	Text   string `json:"text"`
}

// Handler receives bot webhook and returns reports.
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var u Update

	err := json.Unmarshal([]byte(request.Body), &u)
	must(err)

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", repositories.Configs.TelegramToken)

	client := &http.Client{}
	message, err := json.Marshal(TelegramMessage{
		ChatID: u.Message.Chat.ID,
		Text:   routeCommand(u.Message.Text),
	})
	must(err)

	req, err := http.NewRequest("POST", url, bytes.NewReader(message))
	req.Header.Add("Content-Type", "application/json")
	_, err = client.Do(req)
	must(err)

	return events.APIGatewayProxyResponse{StatusCode: 200}, nil
}

var rStatus = regexp.MustCompile(`/status .*`)
var rCredit = regexp.MustCompile(`/credit .*`)

func routeCommand(message string) string {
	switch {
	case rStatus.MatchString(message):
		return handleStatus(message)
	case rCredit.MatchString(message):
		return "WIP"
	}
	return "I don't understand you!"
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
