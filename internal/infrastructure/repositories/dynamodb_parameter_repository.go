package repositories

import (
    "fmt"

    "piggy/internal/domain/entities"
    "piggy/internal/domain/repositories"

    "github.com/aws/aws-sdk-go/aws"
    "github.com/aws/aws-sdk-go/service/dynamodb"
    "github.com/aws/aws-sdk-go/service/dynamodb/dynamodbattribute"
    "github.com/aws/aws-sdk-go/service/dynamodb/dynamodbiface"
)

// DynamoDBParameterRepository implements ParameterRepository using DynamoDB
type DynamoDBParameterRepository struct {
	client    dynamodbiface.DynamoDBAPI
	tableName string
}

// NewDynamoDBParameterRepository creates a new DynamoDB parameter repository
func NewDynamoDBParameterRepository(client *dynamodb.DynamoDB, tableName string) repositories.ParameterRepository {
	return &DynamoDBParameterRepository{
		client:    client,
		tableName: tableName,
	}
}

// NewDynamoDBParameterRepositoryWithInterface creates a new DynamoDB parameter repository with interface (for testing)
func NewDynamoDBParameterRepositoryWithInterface(client dynamodbiface.DynamoDBAPI, tableName string) repositories.ParameterRepository {
	return &DynamoDBParameterRepository{
		client:    client,
		tableName: tableName,
	}
}

// Get retrieves a parameter by key
func (r *DynamoDBParameterRepository) Get(key string) (*entities.Parameter, error) {
    result, err := r.client.GetItem(&dynamodb.GetItemInput{
        TableName: aws.String(r.tableName),
        Key: map[string]*dynamodb.AttributeValue{
            "Parameter": {
                S: aws.String(key),
            },
        },
    })

	if err != nil {
		return nil, fmt.Errorf("failed to get parameter: %w", err)
	}

    if result.Item == nil {
        return nil, fmt.Errorf("parameter not found: %s", key)
    }

    // Prefer StringValue if present
    if sv, ok := result.Item["StringValue"]; ok && sv.S != nil {
        return &entities.Parameter{Key: key, StringValue: aws.StringValue(sv.S)}, nil
    }

    // Fallback to numeric ParameterValue
    type dbParameter struct {
        Parameter      string  `json:"Parameter"`
        ParameterValue float64 `json:"ParameterValue"`
    }
    var dbParam dbParameter
    err = dynamodbattribute.UnmarshalMap(result.Item, &dbParam)
    if err != nil {
        return nil, fmt.Errorf("failed to unmarshal parameter: %w", err)
    }

    return entities.NewParameter(dbParam.Parameter, dbParam.ParameterValue), nil
}

// Set stores or updates a parameter
func (r *DynamoDBParameterRepository) Set(parameter *entities.Parameter) error {
	// Check if parameter exists
	_, err := r.Get(parameter.Key)
	
	if err != nil {
		// Parameter doesn't exist, create it
		return r.createParameter(parameter)
	} else {
		// Parameter exists, update it
		return r.updateParameter(parameter)
	}
}

// createParameter creates a new parameter
func (r *DynamoDBParameterRepository) createParameter(parameter *entities.Parameter) error {
    item := map[string]*dynamodb.AttributeValue{
        "Parameter": {S: aws.String(parameter.Key)},
    }
    if parameter.StringValue != "" {
        item["StringValue"] = &dynamodb.AttributeValue{S: aws.String(parameter.StringValue)}
    } else {
        item["ParameterValue"] = &dynamodb.AttributeValue{N: aws.String(fmt.Sprintf("%f", parameter.Value))}
    }

    _, err := r.client.PutItem(&dynamodb.PutItemInput{
        TableName: aws.String(r.tableName),
        Item:      item,
    })
    return err
}

// updateParameter updates an existing parameter
func (r *DynamoDBParameterRepository) updateParameter(parameter *entities.Parameter) error {
    // Choose attribute based on value presence
    key := map[string]*dynamodb.AttributeValue{
        "Parameter": {S: aws.String(parameter.Key)},
    }
    if parameter.StringValue != "" {
        input := &dynamodb.UpdateItemInput{
            ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
                ":v": {S: aws.String(parameter.StringValue)},
            },
            TableName:        aws.String(r.tableName),
            Key:              key,
            UpdateExpression: aws.String("set StringValue = :v"),
        }
        _, err := r.client.UpdateItem(input)
        return err
    }
    input := &dynamodb.UpdateItemInput{
        ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
            ":v": {N: aws.String(fmt.Sprintf("%f", parameter.Value))},
        },
        TableName:        aws.String(r.tableName),
        Key:              key,
        UpdateExpression: aws.String("set ParameterValue = :v"),
    }
    _, err := r.client.UpdateItem(input)
    return err
}

// tableExists checks if the DynamoDB table exists
func (r *DynamoDBParameterRepository) tableExists() bool {
	found := false
	
	input := &dynamodb.ListTablesInput{}
	for {
		result, err := r.client.ListTables(input)
		if err != nil {
			return false
		}

		for _, n := range result.TableNames {
			if r.tableName == *n {
				found = true
				break
			}
		}
		
		if found {
			break
		}

		input.ExclusiveStartTableName = result.LastEvaluatedTableName
		if result.LastEvaluatedTableName == nil {
			break
		}
	}
	
	return found
}

// createTable creates the DynamoDB table
func (r *DynamoDBParameterRepository) createTable() error {
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
		TableName: aws.String(r.tableName),
	}

	_, err := r.client.CreateTable(input)
	return err
}
