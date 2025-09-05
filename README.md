# Piggy ![Test](https://github.com/Jumpi96/piggy/workflows/Test/badge.svg?branch=main) [![codecov](https://codecov.io/gh/Jumpi96/piggy/branch/main/graph/badge.svg)](https://codecov.io/gh/Jumpi96/piggy)

A personal finance Telegram bot written in Go that helps you track expenses, credit card payments, and monthly budgets through Toshl integration.

## Features

### Telegram Commands
- `/status` - Get monthly spending status and budget overview
- `/balance` - View current balance and remaining budget
- `/credit[CODE]` - Check credit card spending for specific country (AR/NL)
- `/pay[CODE]` - Mark credit card payments as completed
- `/set` - Configure budget and exchange rate parameters

### Integrations
- **Telegram Bot API** - Interactive command interface
- **Toshl API** - Financial data synchronization
- **AWS Lambda** - Serverless deployment
- **DynamoDB** - Configuration storage

## Architecture

```
Telegram Bot Webhook → AWS Lambda → Toshl API
                            ↓
                       DynamoDB (Config)
```

## Setup

### Prerequisites
- Go 1.17+
- AWS Account with Lambda and DynamoDB access
- Telegram Bot Token
- Toshl API Token

### Environment Variables
```bash
TOSHL_TOKEN=your_toshl_api_token
TELEGRAM_TOKEN=your_bot_token
TELEGRAM_USER=your_telegram_username
CREDIT_NL_TAG=netherlands_credit_tag
CREDIT_TAG=argentina_credit_tag
BALANCE_TAG=balance_tracking_tag
TIME_ZONE=Europe/Amsterdam
```

### Local Development
```bash
go mod download
go test ./...
go run main.go
```

### Deployment
The CI/CD pipeline automatically deploys to AWS Lambda on push to main:
```bash
GOOS=linux go build -o main main.go
zip deployment.zip main
aws lambda update-function-code --function-name Piggy --zip-file fileb://deployment.zip
```

## Project Structure
```
├── main.go                 # Lambda entry point
├── serverless/            # Bot handlers and routing
│   ├── common.go          # Telegram webhook handler
│   ├── credit.go          # Credit card commands
│   ├── balance.go         # Balance tracking
│   ├── status.go          # Monthly status reports
│   └── set.go            # Configuration commands
├── services/              # Business logic
│   └── entries.go        # Financial calculations
└── repositories/         # Data access layer
    ├── entries.go        # Toshl API client
    ├── db.go            # DynamoDB operations
    └── config.go        # Environment configuration
```

## Usage Example
```
/status 2023-10
# Returns monthly spending breakdown with budget tracking

/creditNL 2023-10 90.50
# Shows Netherlands credit card expenses

/payNL
# Marks current month's NL credit entries as paid
```

## Testing
```bash
go test ./...
```