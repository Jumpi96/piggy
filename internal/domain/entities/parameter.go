package entities

// Parameter represents a configuration parameter with a value
type Parameter struct {
    Key   string  `json:"Parameter"`
    Value float64 `json:"ParameterValue"`
    StringValue string `json:"StringValue,omitempty"`
}

// NewParameter creates a new parameter
func NewParameter(key string, value float64) *Parameter {
    return &Parameter{
        Key:   key,
        Value: value,
    }
}

// NewStringParameter creates a new string parameter
func NewStringParameter(key string, value string) *Parameter {
    return &Parameter{
        Key:         key,
        StringValue: value,
    }
}
