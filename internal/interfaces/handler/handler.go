package handler

import (
	"context"
	"os"

	"piggy/internal/application/usecases"
	"piggy/internal/domain/services"
	"piggy/internal/infrastructure/config"
	"piggy/internal/infrastructure/external"
	"piggy/internal/infrastructure/repositories"
	"piggy/internal/interfaces/telegram"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/dynamodb"
)

// Handler handles AWS Lambda requests
type Handler struct {
	telegramController *telegram.TelegramController
}

// NewHandler creates a new Lambda handler with all dependencies injected
func NewHandler() *Handler {
	// Initialize AWS session and DynamoDB client
	awsSession := session.Must(session.NewSession(&aws.Config{
		Region: aws.String(getEnv("AWS_REGION", "us-west-2")),
	}))
	dynamoClient := dynamodb.New(awsSession)

	// Initialize external clients
	toshlToken := getEnv("TOSHL_TOKEN", "")
	toshlClient := external.NewToshlClient(toshlToken)

	// Initialize repositories
	timeZone := getEnv("TIME_ZONE", "Europe/Amsterdam")
	entryRepo := repositories.NewToshlEntryRepository(toshlClient, timeZone)

	parameterTableName := getEnv("PARAMETER_TABLE_NAME", "piggy")
	parameterRepo := repositories.NewDynamoDBParameterRepository(dynamoClient, parameterTableName)

	// Initialize config service
	var configService services.ConfigService = config.NewConfigService()

	// Initialize use cases
	statusUseCase := usecases.NewStatusUseCase(entryRepo, parameterRepo, configService)
	balanceUseCase := usecases.NewBalanceUseCase(entryRepo, parameterRepo, configService)
	creditUseCase := usecases.NewCreditUseCase(entryRepo, parameterRepo, configService)
	parameterUseCase := usecases.NewParameterUseCase(entryRepo, parameterRepo, configService)

	// Initialize Telegram controller
	telegramToken := getEnv("TELEGRAM_TOKEN", "")
	telegramController := telegram.NewTelegramController(
		creditUseCase,
		statusUseCase,
		balanceUseCase,
		parameterUseCase,
		configService,
		telegramToken,
	)

	return &Handler{
		telegramController: telegramController,
	}
}

// HandleRequest handles AWS Lambda requests
func (h *Handler) HandleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	return h.telegramController.HandleWebhook(ctx, request)
}

// getEnv gets environment variable with fallback
func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}