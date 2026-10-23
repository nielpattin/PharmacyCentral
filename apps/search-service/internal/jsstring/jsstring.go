// Package jsstring reproduces the JavaScript text rules catalog-service depends on (trim, \s, string length and
// Number()), so the Go service accepts and normalises exactly the same shopper input.
package jsstring

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// IsSpace reports whether r is whitespace for String.prototype.trim and the regular expression \s.
func IsSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

func Trim(s string) string {
	return strings.TrimFunc(s, IsSpace)
}

func CollapseSpaces(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	inSpace := false
	for _, r := range s {
		if IsSpace(r) {
			if !inSpace {
				b.WriteByte(' ')
			}
			inSpace = true
			continue
		}
		inSpace = false
		b.WriteRune(r)
	}
	return b.String()
}

// Length returns the length in UTF-16 code units, which is what JavaScript's string length counts.
func Length(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

var decimalLiteral = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`)

// ToNumber mirrors JavaScript's Number(text). ok is false where JavaScript yields NaN.
func ToNumber(text string) (value float64, ok bool) {
	t := Trim(text)
	switch t {
	case "":
		return 0, true
	case "Infinity", "+Infinity":
		return math.Inf(1), true
	case "-Infinity":
		return math.Inf(-1), true
	}
	if len(t) > 2 && t[0] == '0' {
		if base, prefixed := radix(t[1]); prefixed {
			n, err := strconv.ParseUint(t[2:], base, 64)
			if err != nil {
				return 0, false
			}
			return float64(n), true
		}
	}
	if !decimalLiteral.MatchString(t) {
		return 0, false
	}
	f, err := strconv.ParseFloat(t, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return 0, false
	}
	return f, true
}

func radix(prefix byte) (int, bool) {
	switch prefix {
	case 'x', 'X':
		return 16, true
	case 'o', 'O':
		return 8, true
	case 'b', 'B':
		return 2, true
	}
	return 0, false
}
