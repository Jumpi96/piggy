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

// --- DEPENDENCY INJECTION ---
var toshlRepository = &repositories.ToshlEntriesRepo{}

// Handler receives bot webhook and returns reports.
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var u Update

	err := json.Unmarshal([]byte(request.Body), &u)
	must(err)

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", repositories.Configs.TelegramToken)

	client := &http.Client{}
	message, err := json.Marshal(TelegramMessage{
		ChatID: u.Message.Chat.ID,
		Text:   routeCommand(u.Message.Text, u.Message.Chat.UserName),
	})
	must(err)

	req, err := http.NewRequest("POST", url, bytes.NewReader(message))
	req.Header.Add("Content-Type", "application/json")
	_, err = client.Do(req)
	must(err)

	return events.APIGatewayProxyResponse{StatusCode: 200}, nil
}

var rStatus = regexp.MustCompile(`\/status.*`)
var rCreditAR = regexp.MustCompile(`\/creditAR.*`)
var rPayCreditAR = regexp.MustCompile(`\/payAR.*`)

func routeCommand(message string, username string) string {
	if username == repositories.Configs.TelegramUser {
		client := repositories.StartDynamoClient()
		repositories.InitParamsTable(client)
		switch {
		case rStatus.MatchString(message):
			return handleStatus(client, message)
		case rCreditAR.MatchString(message):
			return handleCredit(client, message, false)
		case rPayCreditAR.MatchString(message):
			return handleCredit(client, message, true)
		}
		return "❓ Use one of the Piggy commands:\n /status\n /credit[CODE]\n /pay[CODE]"
	}
	return "Sir, who are you?🤔"
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
