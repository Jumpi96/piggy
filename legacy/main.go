package main

import (
	"piggy/internal/interfaces/handler"

	"github.com/aws/aws-lambda-go/lambda"
)

func main() {
	h := handler.NewHandler()
	lambda.Start(h.HandleRequest)
}
