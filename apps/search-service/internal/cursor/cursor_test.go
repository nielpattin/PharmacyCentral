package cursor

import "testing"

func TestEncodeDecodeRoundTrip(t *testing.T) {
	for _, offset := range []int{1, 20, 40, 999999} {
		got, ok := Decode(Encode(offset))
		if !ok || got != offset {
			t.Errorf("Decode(Encode(%d)) = %d, %v", offset, got, ok)
		}
	}
}

func TestDecodeRejectsInvalidCursors(t *testing.T) {
	cases := map[string]string{
		"empty":              "",
		"zero offset":        "MA",
		"leading zero":       "MDE",
		"seven digits":       Encode(1000000),
		"padding":            "MjA=",
		"not digits":         "YWJj",
		"invalid characters": "MT+z",
		"negative":           "LTE",
		"single character":   "M",
	}
	for name, cursor := range cases {
		if got, ok := Decode(cursor); ok {
			t.Errorf("%s: Decode(%q) = %d, want rejection", name, cursor, got)
		}
	}
}
