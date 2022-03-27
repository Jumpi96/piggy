package main

import (
	"piggy/serverless"

	"github.com/aws/aws-lambda-go/lambda"
)

func main() {
	lambda.Start(serverless.Handler)
}
