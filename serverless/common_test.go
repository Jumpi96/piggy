package serverless

import "testing"

func TestStatusRoute(t *testing.T) {
	result := routeCommand("/status")
	expected := "Status WIP"
	if result != expected {
		t.Errorf("Incorrect route, got: %s, want: %s.", result, expected)
	}
}

func TestCreditRoute(t *testing.T) {
	result := routeCommand("/status")
	expected := "Status WIP"
	if result != expected {
		t.Errorf("Incorrect route, got: %s, want: %s.", result, expected)
	}
}
