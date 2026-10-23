// Package fold is the one folding function for indexed product text and shopper queries. It must agree with
// catalog-service's foldSearchText; the shared fixture testdata/fold-cases.json proves it.
package fold

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"pharmacycentral/search-service/internal/jsstring"
)

func Fold(text string) string {
	decomposed := norm.NFD.String(text)
	var b strings.Builder
	b.Grow(len(decomposed))
	for _, r := range decomposed {
		if unicode.In(r, unicode.Mn, unicode.Mc, unicode.Me) {
			continue
		}
		if r == 'đ' || r == 'Đ' {
			r = 'd'
		}
		b.WriteRune(r)
	}
	return jsstring.Trim(jsstring.CollapseSpaces(strings.ToLower(b.String())))
}
