package serverless

import (
	"testing"
)

func TestHandleStatus(t *testing.T) {
	handleStatus("/status")
}
