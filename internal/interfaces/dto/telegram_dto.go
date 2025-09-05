package dto

// TelegramUpdate represents a Telegram bot update
type TelegramUpdate struct {
	UpdateID int            `json:"update_id"`
	Message  TelegramMessage `json:"message"`
}

// TelegramMessage represents a Telegram message
type TelegramMessage struct {
	MessageID int                    `json:"message_id"`
	From      TelegramUser           `json:"from"`
	Chat      TelegramChat           `json:"chat"`
	Date      int                    `json:"date"`
	Text      string                 `json:"text"`
	Entities  []TelegramEntity       `json:"entities"`
}

// TelegramUser represents a Telegram user
type TelegramUser struct {
	ID           int    `json:"id"`
	FirstName    string `json:"first_name"`
	UserName     string `json:"username"`
	LanguageCode string `json:"language_code"`
}

// TelegramChat represents a Telegram chat
type TelegramChat struct {
	ID                          int    `json:"id"`
	FirstName                   string `json:"first_name"`
	UserName                    string `json:"username"`
	Type                        string `json:"type"`
	Title                       string `json:"title"`
	AllMembersAreAdministrators bool   `json:"all_members_are_administrators"`
}

// TelegramEntity represents a Telegram message entity
type TelegramEntity struct {
	Type   string `json:"type"`
	Offset int    `json:"offset"`
	Length int    `json:"length"`
}

// TelegramResponse represents a response message to send back
type TelegramResponse struct {
	ChatID int    `json:"chat_id"`
	Text   string `json:"text"`
}