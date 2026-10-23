package fold

import (
	"encoding/json"
	"os"
	"testing"
)

type foldCase struct {
	Input  string `json:"input"`
	Folded string `json:"folded"`
}

// The fixture is generated from the Node foldSearchText; both implementations must produce the same output.
func TestFoldMatchesSharedFixture(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/fold-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []foldCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("fixture has no cases")
	}
	for _, c := range cases {
		if got := Fold(c.Input); got != c.Folded {
			t.Errorf("Fold(%q) = %q, want %q", c.Input, got, c.Folded)
		}
	}
}
