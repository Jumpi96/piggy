package entities

// Parameter represents a configuration parameter with a value
type Parameter struct {
	Key   string  `json:"parameter"`
	Value float64 `json:"parameter_value"`
}

// NewParameter creates a new parameter
func NewParameter(key string, value float64) *Parameter {
	return &Parameter{
		Key:   key,
		Value: value,
	}
}