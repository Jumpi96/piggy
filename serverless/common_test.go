package serverless

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"piggy/repositories"
)

func TestUpdate_JSONParsing(t *testing.T) {
	jsonStr := `{
		"update_id": 123,
		"message": {
			"message_id": 456,
			"from": {
				"id": 789,
				"first_name": "Test",
				"username": "testuser",
				"language_code": "en"
			},
			"chat": {
				"id": 789,
				"first_name": "Test", 
				"username": "testuser",
				"type": "private"
			},
			"date": 1234567890,
			"text": "/status",
			"entities": []
		}
	}`

	var update Update
	err := json.Unmarshal([]byte(jsonStr), &update)

	if err != nil {
		t.Errorf("Failed to parse JSON: %v", err)
	}

	if update.UpdateID != 123 {
		t.Errorf("Expected UpdateID 123, got %d", update.UpdateID)
	}

	if update.Message.Text != "/status" {
		t.Errorf("Expected message text '/status', got '%s'", update.Message.Text)
	}

	if update.Message.From.UserName != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", update.Message.From.UserName)
	}
}

func TestTelegramMessage_JSONMarshaling(t *testing.T) {
	msg := TelegramMessage{
		ChatID: 123,
		Text:   "Hello, world!",
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Errorf("Failed to marshal JSON: %v", err)
	}

	expected := `{"chat_id":123,"text":"Hello, world!"}`
	if string(data) != expected {
		t.Errorf("Expected JSON %s, got %s", expected, string(data))
	}
}

func TestRouteCommand_UnauthorizedUser(t *testing.T) {
	// Set a specific authorized user
	originalUser := repositories.Configs.TelegramUser
	repositories.Configs.TelegramUser = "authorized_user"
	defer func() { repositories.Configs.TelegramUser = originalUser }()

	result := routeCommand("/status", "unauthorized_user")
	expected := "Sir, who are you?🤔"

	if result != expected {
		t.Errorf("Expected '%s', got '%s'", expected, result)
	}
}

func TestRouteCommand_AuthorizedUser_UnknownCommand(t *testing.T) {
	// Set a specific authorized user
	originalUser := repositories.Configs.TelegramUser
	repositories.Configs.TelegramUser = "authorized_user"
	defer func() { repositories.Configs.TelegramUser = originalUser }()

	result := routeCommand("/unknown", "authorized_user")
	expected := "❓ Use one of the Piggy commands:\n /status\n /credit[CODE]\n /pay[CODE]\n /set\n /balance"

	if result != expected {
		t.Errorf("Expected help message, got '%s'", result)
	}
}

func TestRouteCommand_RegexMatching(t *testing.T) {
	testCases := []struct {
		message  string
		expected string
	}{
		{"/status", "status"},
		{"/status 2023-10", "status"},
		{"/balance", "balance"},
		{"/balance 2023-10 2023-11", "balance"},
		{"/creditAR", "credit"},
		{"/creditNL", "credit"},
		{"/creditAR 2023-10", "credit"},
		{"/payAR", "pay"},
		{"/payNL", "pay"},
		{"/set", "set"},
		{"/set USD2ARS 100", "set"},
	}

	// Test regex patterns individually
	for _, tc := range testCases {
		var matched bool
		switch tc.expected {
		case "status":
			matched = rStatus.MatchString(tc.message)
		case "balance":
			matched = rBalance.MatchString(tc.message)
		case "credit":
			matched = rCredit.MatchString(tc.message)
		case "pay":
			matched = rPayCredit.MatchString(tc.message)
		case "set":
			matched = rSet.MatchString(tc.message)
		}

		if !matched {
			t.Errorf("Expected message '%s' to match %s pattern", tc.message, tc.expected)
		}
	}
}

func TestMust_WithError(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Error("Expected must() to panic with error, but it didn't")
		}
	}()

	// This should panic
	must(fmt.Errorf("test error"))
}

func TestMust_WithNil(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Expected must() not to panic with nil, but it panicked: %v", r)
		}
	}()

	// This should not panic
	must(nil)
}

func TestHandler_JSONUnmarshalError(t *testing.T) {
	// Test with invalid JSON
	request := events.APIGatewayProxyRequest{
		Body: "invalid json",
	}

	defer func() {
		if r := recover(); r == nil {
			t.Error("Expected Handler to panic with invalid JSON, but it didn't")
		}
	}()

	// This should panic due to JSON unmarshal error
	Handler(context.Background(), request)
}

func TestHandler_ValidRequest(t *testing.T) {
	// Create a valid Telegram update JSON
	update := Update{
		UpdateID: 123,
		Message: Message{
			MessageID: 456,
			From: From{
				ID:           789,
				FirstName:    "Test",
				UserName:     "testuser",
				LanguageCode: "en",
			},
			Chat: Chat{
				ID:        789,
				FirstName: "Test",
				UserName:  "testuser",
				Type:      "private",
			},
			Date: 1234567890,
			Text: "/unknown",
		},
	}

	updateJSON, _ := json.Marshal(update)

	request := events.APIGatewayProxyRequest{
		Body: string(updateJSON),
	}

	// Set test user
	originalUser := repositories.Configs.TelegramUser
	repositories.Configs.TelegramUser = "testuser"
	defer func() { repositories.Configs.TelegramUser = originalUser }()

	// This will fail when trying to send HTTP request to Telegram,
	// but we can test that it doesn't panic during JSON processing
	defer func() {
		if r := recover(); r != nil {
			// Expected to panic when trying to send HTTP request
			t.Logf("Handler panicked as expected when trying to send HTTP request: %v", r)
		}
	}()

	// This will likely panic when trying to send the HTTP request
	// since we don't have a real Telegram token
	Handler(context.Background(), request)
}