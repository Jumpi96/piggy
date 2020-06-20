package repositories

import (
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/dynamodb"
)

var tableName = "piggy"

func StartDynamoClient() dynamodb.DynamoDB {
	sess := session.Must(session.NewSessionWithOptions(session.Options{
		SharedConfigState: session.SharedConfigEnable,
	}))
	return *dynamodb.New(sess)
}

func InitParamsTable(client dynamodb.DynamoDB) {
	if !tableExists(client) {
		err := createTable(client)
		if err != nil {
			panic(err)
		}
	}
}

func tableExists(client dynamodb.DynamoDB) bool {
	found := false
	for {
		input := &dynamodb.ListTablesInput{}
		result, err := client.ListTables(input)
		if err != nil {
			panic(err)
		}

		for _, n := range result.TableNames {
			if tableName == *n {
				found = true
			}
		}
		input.ExclusiveStartTableName = result.LastEvaluatedTableName

		if result.LastEvaluatedTableName == nil {
			break
		}
	}
	return found
}

func createTable(client dynamodb.DynamoDB) error {
	input := &dynamodb.CreateTableInput{
		AttributeDefinitions: []*dynamodb.AttributeDefinition{
			{
				AttributeName: aws.String("Parameter"),
				AttributeType: aws.String("S"),
			},
			{
				AttributeName: aws.String("Value"),
				AttributeType: aws.String("N"),
			},
		},
		KeySchema: []*dynamodb.KeySchemaElement{
			{
				AttributeName: aws.String("Parameter"),
				KeyType:       aws.String("HASH"),
			},
			{
				AttributeName: aws.String("Value"),
				KeyType:       aws.String("RANGE"),
			},
		},
		ProvisionedThroughput: &dynamodb.ProvisionedThroughput{
			ReadCapacityUnits:  aws.Int64(1),
			WriteCapacityUnits: aws.Int64(1),
		},
		TableName: aws.String(tableName),
	}

	_, err := client.CreateTable(input)
	return err
}
