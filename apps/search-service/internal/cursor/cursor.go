// Package cursor encodes the page cursor of GET /products. The cursor is opaque to callers: base64url of the decimal
// offset, as catalog-service's page-cursor.ts writes it.
package cursor

import (
	"encoding/base64"
	"strconv"
)

const maxDigits = 6

func Encode(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}

// Decode returns the offset a cursor stands for. ok is false when the cursor was not made by Encode.
func Decode(cursor string) (offset int, ok bool) {
	for i := 0; i < len(cursor); i++ {
		c := cursor[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return 0, false
		}
	}
	// Buffer.from(text, "base64url") drops a dangling final character, so the decoder does the same.
	if len(cursor)%4 == 1 {
		cursor = cursor[:len(cursor)-1]
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, false
	}
	text := string(raw)
	if len(text) == 0 || len(text) > maxDigits || text[0] == '0' {
		return 0, false
	}
	for i := 0; i < len(text); i++ {
		if text[i] < '0' || text[i] > '9' {
			return 0, false
		}
	}
	n, err := strconv.Atoi(text)
	if err != nil {
		return 0, false
	}
	return n, true
}
