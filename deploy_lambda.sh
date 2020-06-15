#!/bin/bash
GOOS=linux go build -o main main.go
zip deployment.zip main 
aws lambda update-function-code --function-name Piggy --zip-file fileb://deployment.zip 
rm deployment.zip main