package jsstring

import (
	"math"
	"testing"
)

func TestToNumberMatchesJavaScript(t *testing.T) {
	cases := []struct {
		in   string
		want float64
		ok   bool
	}{
		{"", 0, true},
		{" 7 ", 7, true},
		{"1e2", 100, true},
		{"0x10", 16, true},
		{"7.5", 7.5, true},
		{"Infinity", math.Inf(1), true},
		{"abc", 0, false},
		{"0x", 0, false},
		{"1_0", 0, false},
	}
	for _, c := range cases {
		got, ok := ToNumber(c.in)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("ToNumber(%q) = %v, %v; want %v, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestCollapseSpacesAndLength(t *testing.T) {
	if got := CollapseSpaces("a \t b\u00a0\u3000c"); got != "a b c" {
		t.Errorf("CollapseSpaces = %q", got)
	}
	if got := Length("a\U0001F600"); got != 3 {
		t.Errorf("Length = %d, want 3 UTF-16 units", got)
	}
}
