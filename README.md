# Piggy

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
- **AWS Parameter Store** - Configuration storage

## Architecture

Built with Clean Architecture principles for maintainability and testability:

```
┌─────────────────────────────────────────────────────────────┐
│                    Interface Layer                          │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │ Telegram Bot    │    │ AWS Lambda Handler              │ │
│  │ (Webhook)       │────│ (main.go)                      │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                   │
┌─────────────────────────────────────────────────────────────┐
│                  Application Layer                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Use Cases (Business Logic)                              │ │
│  │ • CreditUseCase   • StatusUseCase   • BalanceUseCase   │ │
│  │ • ParameterUseCase                                     │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                   │
┌─────────────────────────────────────────────────────────────┐
│                    Domain Layer                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Entities: Entry, Currency, Parameter                    │ │
│  │ Repository Interfaces: EntryRepo, ParameterRepo        │ │
│  │ Service Interfaces: ConfigService                      │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                   │
┌─────────────────────────────────────────────────────────────┐
│                Infrastructure Layer                         │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │ Repositories    │    │ External Services               │ │
│  │ • ToshlRepo     │    │ • Toshl API                     │ │
│  │ • ParameterRepo │    │ • AWS Parameter Store           │ │
│  │ • ConfigService │    │ • Environment Variables         │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### Prerequisites
- Go 1.21+
- AWS Account with Lambda and Parameter Store access
- Telegram Bot Token
- Toshl API Token

### Environment Variables
```bash
TOSHL_TOKEN=your_toshl_api_token
TELEGRAM_TOKEN=your_bot_token
TELEGRAM_USER=your_telegram_username
CREDIT_NL_TAGS=1234,2345  # Comma-separated tags for NL
CREDIT_AR_TAGS=9876,8765 # Comma-separated tags for AR  
BALANCE_TAGS=balance,income             # Comma-separated balance tags
TIME_ZONE=Europe/Amsterdam
PARAMETER_NAME=/piggy/config            # Parameter Store parameter name
```

### Parameter Store Configuration
Create a SecureString parameter in AWS Parameter Store with the following JSON structure:
```json
{
  "currency": "ARS",
  "conversions": {
    "ARS2USD": 0.001,
    "ARS2EUR": 0.0009,
    "USD2EUR": 0.85
  },
  "budgeting": {
    "amountPerDay": 100.0
  }
}
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

## Usage Example
```
/status 2023-10
# Returns monthly spending breakdown with budget tracking

/creditNL 2023-10
# Shows Netherlands credit card expenses

/payNL
# Marks current month's NL credit entries as paid
```

## Testing
```bash
go test ./...
```