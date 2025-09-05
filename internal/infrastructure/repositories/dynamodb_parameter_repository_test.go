package repositories

import (
	"testing"

	"piggy/internal/domain/entities"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/service/dynamodb"
	"github.com/aws/aws-sdk-go/service/dynamodb/dynamodbiface"
)

// Mock DynamoDB client for testing
type mockDynamoDBClient struct {
	dynamodbiface.DynamoDBAPI
	getItemOutput    *dynamodb.GetItemOutput
	getItemError     error
	putItemError     error
	updateItemError  error
	listTablesOutput *dynamodb.ListTablesOutput
	listTablesError  error
	createTableError error
	callLog          []string
}

func (m *mockDynamoDBClient) GetItem(input *dynamodb.GetItemInput) (*dynamodb.GetItemOutput, error) {
	m.callLog = append(m.callLog, "GetItem")
	if m.getItemError != nil {
		return nil, m.getItemError
	}
	return m.getItemOutput, nil
}

func (m *mockDynamoDBClient) PutItem(input *dynamodb.PutItemInput) (*dynamodb.PutItemOutput, error) {
	m.callLog = append(m.callLog, "PutItem")
	if m.putItemError != nil {
		return nil, m.putItemError
	}
	return &dynamodb.PutItemOutput{}, nil
}

func (m *mockDynamoDBClient) UpdateItem(input *dynamodb.UpdateItemInput) (*dynamodb.UpdateItemOutput, error) {
	m.callLog = append(m.callLog, "UpdateItem")
	if m.updateItemError != nil {
		return nil, m.updateItemError
	}
	return &dynamodb.UpdateItemOutput{}, nil
}

func (m *mockDynamoDBClient) ListTables(input *dynamodb.ListTablesInput) (*dynamodb.ListTablesOutput, error) {
	m.callLog = append(m.callLog, "ListTables")
	if m.listTablesError != nil {
		return nil, m.listTablesError
	}
	return m.listTablesOutput, nil
}

func (m *mockDynamoDBClient) CreateTable(input *dynamodb.CreateTableInput) (*dynamodb.CreateTableOutput, error) {
	m.callLog = append(m.callLog, "CreateTable")
	if m.createTableError != nil {
		return nil, m.createTableError
	}
	return &dynamodb.CreateTableOutput{}, nil
}

func TestDynamoDBParameterRepository_Get(t *testing.T) {
	testCases := []struct {
		name           string
		key            string
		mockOutput     *dynamodb.GetItemOutput
		mockError      error
		expectedError  bool
		expectedValue  float64
	}{
		{
			name: "successful get",
			key:  "USD2ARS",
			mockOutput: &dynamodb.GetItemOutput{
				Item: map[string]*dynamodb.AttributeValue{
					"Parameter": {
						S: aws.String("USD2ARS"),
					},
					"ParameterValue": {
						N: aws.String("350.75"),
					},
				},
			},
			mockError:     nil,
			expectedError: false,
			expectedValue: 350.75,
		},
		{
			name: "parameter not found",
			key:  "NONEXISTENT",
			mockOutput: &dynamodb.GetItemOutput{
				Item: nil,
			},
			mockError:     nil,
			expectedError: true,
			expectedValue: 0.0,
		},
		{
			name: "zero value parameter",
			key:  "ZERO_PARAM",
			mockOutput: &dynamodb.GetItemOutput{
				Item: map[string]*dynamodb.AttributeValue{
					"Parameter": {
						S: aws.String("ZERO_PARAM"),
					},
					"ParameterValue": {
						N: aws.String("0.0"),
					},
				},
			},
			mockError:     nil,
			expectedError: true, // Zero values are considered invalid per the implementation
			expectedValue: 0.0,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mock client
			mockClient := &mockDynamoDBClient{
				getItemOutput: tc.mockOutput,
				getItemError:  tc.mockError,
			}

			// Create repository
			repo := NewDynamoDBParameterRepositoryWithInterface(mockClient, "test-table")

			// Execute
			result, err := repo.Get(tc.key)

			// Assert
			if tc.expectedError {
				if err == nil {
					t.Errorf("Expected error, but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}

				if result == nil {
					t.Errorf("Expected result, but got nil")
					return
				}

				if result.Key != tc.key {
					t.Errorf("Expected key %s, got %s", tc.key, result.Key)
				}

				if result.Value != tc.expectedValue {
					t.Errorf("Expected value %f, got %f", tc.expectedValue, result.Value)
				}
			}

			// Verify GetItem was called
			if len(mockClient.callLog) != 1 || mockClient.callLog[0] != "GetItem" {
				t.Errorf("Expected GetItem to be called once, got: %v", mockClient.callLog)
			}
		})
	}
}

func TestDynamoDBParameterRepository_Set_NewParameter(t *testing.T) {
	// Mock client that returns "not found" for Get, then allows PutItem
	mockClient := &mockDynamoDBClient{
		getItemOutput: &dynamodb.GetItemOutput{Item: nil}, // Parameter doesn't exist
		getItemError:  nil,
		putItemError:  nil,
	}

	repo := NewDynamoDBParameterRepositoryWithInterface(mockClient, "test-table")
	param := entities.NewParameter("NEW_PARAM", 123.45)

	err := repo.Set(param)

	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}

	// Should have called GetItem first, then PutItem
	expectedCalls := []string{"GetItem", "PutItem"}
	if len(mockClient.callLog) != len(expectedCalls) {
		t.Errorf("Expected calls %v, got %v", expectedCalls, mockClient.callLog)
	}

	for i, expectedCall := range expectedCalls {
		if i < len(mockClient.callLog) && mockClient.callLog[i] != expectedCall {
			t.Errorf("Expected call %d to be %s, got %s", i, expectedCall, mockClient.callLog[i])
		}
	}
}

func TestDynamoDBParameterRepository_Set_ExistingParameter(t *testing.T) {
	// Mock client that returns existing parameter for Get, then allows UpdateItem
	mockClient := &mockDynamoDBClient{
		getItemOutput: &dynamodb.GetItemOutput{
			Item: map[string]*dynamodb.AttributeValue{
				"Parameter": {
					S: aws.String("EXISTING_PARAM"),
				},
				"ParameterValue": {
					N: aws.String("100.0"),
				},
			},
		},
		getItemError:    nil,
		updateItemError: nil,
	}

	repo := NewDynamoDBParameterRepositoryWithInterface(mockClient, "test-table")
	param := entities.NewParameter("EXISTING_PARAM", 200.0)

	err := repo.Set(param)

	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}

	// Should have called GetItem first, then UpdateItem
	expectedCalls := []string{"GetItem", "UpdateItem"}
	if len(mockClient.callLog) != len(expectedCalls) {
		t.Errorf("Expected calls %v, got %v", expectedCalls, mockClient.callLog)
	}
}

func TestNewDynamoDBParameterRepository(t *testing.T) {
	mockClient := &mockDynamoDBClient{}
	tableName := "test-table"

	repo := NewDynamoDBParameterRepositoryWithInterface(mockClient, tableName)

	dynamoRepo, ok := repo.(*DynamoDBParameterRepository)
	if !ok {
		t.Error("Expected *DynamoDBParameterRepository, got different type")
	}

	if dynamoRepo.client == nil {
		t.Error("DynamoDB client not set correctly")
	}

	if dynamoRepo.tableName != tableName {
		t.Errorf("Expected tableName %s, got %s", tableName, dynamoRepo.tableName)
	}
}