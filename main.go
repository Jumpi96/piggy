package main

import (
	"github.com/aws/aws-lambda-go/lambda"

	serverless "./serverless"
)

func main() {
	lambda.Start(serverless.Handler)
}
