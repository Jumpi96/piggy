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
			"parameter": {
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

	// DynamoDB stores with different field names, so we need to map manually
	type dbParameter struct {
		Parameter      string  `json:"parameter"`
		ParameterValue float64 `json:"parameter_value"`
	}

	var dbParam dbParameter
	err = dynamodbattribute.UnmarshalMap(result.Item, &dbParam)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal parameter: %w", err)
	}

	if dbParam.ParameterValue == 0.0 {
		return nil, fmt.Errorf("parameter has zero value: %s", key)
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
	// Map to DynamoDB field names
	type dbParameter struct {
		Parameter      string  `json:"parameter"`
		ParameterValue float64 `json:"parameter_value"`
	}

	dbParam := dbParameter{
		Parameter:      parameter.Key,
		ParameterValue: parameter.Value,
	}

	av, err := dynamodbattribute.MarshalMap(dbParam)
	if err != nil {
		return fmt.Errorf("failed to marshal parameter: %w", err)
	}

	input := &dynamodb.PutItemInput{
		Item:      av,
		TableName: aws.String(r.tableName),
	}

	_, err = r.client.PutItem(input)
	return err
}

// updateParameter updates an existing parameter
func (r *DynamoDBParameterRepository) updateParameter(parameter *entities.Parameter) error {
	input := &dynamodb.UpdateItemInput{
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":v": {
				N: aws.String(fmt.Sprintf("%.2f", parameter.Value)),
			},
		},
		TableName: aws.String(r.tableName),
		Key: map[string]*dynamodb.AttributeValue{
			"parameter": {
				S: aws.String(parameter.Key),
			},
		},
		UpdateExpression: aws.String("set parameter_value = :v"),
	}

	_, err := r.client.UpdateItem(input)
	return err
}

// InitializeStorage initializes the parameter storage
func (r *DynamoDBParameterRepository) InitializeStorage() error {
	// Check if table exists
	if !r.tableExists() {
		return r.createTable()
	}
	return nil
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
				AttributeName: aws.String("parameter"),
				AttributeType: aws.String("S"),
			},
		},
		KeySchema: []*dynamodb.KeySchemaElement{
			{
				AttributeName: aws.String("parameter"),
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