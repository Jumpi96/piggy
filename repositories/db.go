package repositories

import (
	"fmt"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/dynamodb"
	"github.com/aws/aws-sdk-go/service/dynamodb/dynamodbattribute"
)

var tableName = "piggy"

type parameter struct {
	Parameter      string
	ParameterValue float64
}

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

func GetParam(client dynamodb.DynamoDB, key string) (float64, error) {
	result, err := client.GetItem(&dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]*dynamodb.AttributeValue{
			"Parameter": {
				S: aws.String(key),
			},
		},
	})

	if err != nil {
		fmt.Println(err.Error())
		return -1, err
	}

	item := parameter{}

	err = dynamodbattribute.UnmarshalMap(result.Item, &item)
	if err != nil {
		fmt.Println(err.Error())
		return -1, err
	}

	if item.ParameterValue == 0.0 {
		return 0, err
	}

	return item.ParameterValue, nil
}

func SetParam(client dynamodb.DynamoDB, key string, value float64) error {
	_, err := GetParam(client, key)
	if err != nil {
		av := make(map[string]*dynamodb.AttributeValue)
		av, err = dynamodbattribute.MarshalMap(parameter{Parameter: key, ParameterValue: value})
		input := &dynamodb.PutItemInput{
			Item:      av,
			TableName: aws.String(tableName),
		}

		_, err = client.PutItem(input)
	} else {
		input := &dynamodb.UpdateItemInput{
			ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
				":v": {
					N: aws.String(fmt.Sprintf("%.2f", value)),
				},
			},
			TableName: aws.String(tableName),
			Key: map[string]*dynamodb.AttributeValue{
				"Parameter": {
					S: aws.String(key),
				},
			},
			UpdateExpression: aws.String("set ParameterValue = :v"),
		}
		_, err = client.UpdateItem(input)
	}
	return err
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
		},
		KeySchema: []*dynamodb.KeySchemaElement{
			{
				AttributeName: aws.String("Parameter"),
				KeyType:       aws.String("HASH"),
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
