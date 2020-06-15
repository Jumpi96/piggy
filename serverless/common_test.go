package serverless

import (
	"strings"
	"testing"
)

func TestStatusRoute(t *testing.T) {
	result := routeCommand("/status")
	expected := "YOUR CURRENT SITUATION"
	if !strings.Contains(result, expected) {
		t.Errorf("Incorrect route, got: %s, want to have: %s.", result, expected)
	}
}

func TestCreditRoute(t *testing.T) {
	result := routeCommand("/credit")
	expected := "Credit WIP"
	if result != expected {
		t.Errorf("Incorrect route, got: %s, want: %s.", result, expected)
	}
}
