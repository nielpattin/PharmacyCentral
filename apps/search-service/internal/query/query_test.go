package query

import (
	"errors"
	"net/url"
	"strings"
	"testing"

	"pharmacycentral/search-service/internal/cursor"
)

func TestParseAppliesContractDefaults(t *testing.T) {
	got, err := Parse(url.Values{})
	if err != nil {
		t.Fatal(err)
	}
	if got.Limit != 20 || got.Offset != 0 || got.Search != "" || got.Category != "" || got.PrescriptionRequired != nil {
		t.Fatalf("defaults = %+v", got)
	}
}

func TestParseNormalisesSearchLikeCatalog(t *testing.T) {
	got, err := Parse(url.Values{"search": {"  Đau   Đầu  "}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Search != "đau đầu" {
		t.Fatalf("Search = %q", got.Search)
	}
}

func TestParseAcceptsValidValues(t *testing.T) {
	cursorValue := cursor.Encode(40)
	cases := []struct {
		name   string
		values url.Values
		check  func(Params) bool
	}{
		{"search at maximum", url.Values{"search": {strings.Repeat("a", 200)}}, func(p Params) bool { return len(p.Search) == 200 }},
		{"limit with spaces", url.Values{"limit": {" 7 "}}, func(p Params) bool { return p.Limit == 7 }},
		{"limit exponent", url.Values{"limit": {"1e2"}}, func(p Params) bool { return p.Limit == 100 }},
		{"prescription false", url.Values{"prescriptionRequired": {"false"}}, func(p Params) bool {
			return p.PrescriptionRequired != nil && !*p.PrescriptionRequired
		}},
		{"cursor", url.Values{"cursor": {cursorValue}}, func(p Params) bool { return p.Offset == 40 }},
		{"unknown keys ignored", url.Values{"foo": {"bar"}}, func(p Params) bool { return p.Limit == 20 }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Parse(c.values)
			if err != nil {
				t.Fatal(err)
			}
			if !c.check(got) {
				t.Fatalf("Parse = %+v", got)
			}
		})
	}
}

func TestParseRejectsInvalidValues(t *testing.T) {
	cases := map[string]url.Values{
		"limit zero":             {"limit": {"0"}},
		"limit above maximum":    {"limit": {"101"}},
		"limit not a number":     {"limit": {"ten"}},
		"limit fraction":         {"limit": {"7.5"}},
		"limit empty":            {"limit": {""}},
		"limit bracket syntax":   {"limit[]": {"5"}},
		"repeated search":        {"search": {"a", "b"}},
		"nested search":          {"search[a]": {"b"}},
		"search too long":        {"search": {strings.Repeat("a", 201)}},
		"category too long":      {"category": {strings.Repeat("a", 101)}},
		"prescription uppercase": {"prescriptionRequired": {"TRUE"}},
		"prescription numeric":   {"prescriptionRequired": {"1"}},
		"empty cursor":           {"cursor": {""}},
		"foreign cursor":         {"cursor": {"abc"}},
	}
	for name, values := range cases {
		if _, err := Parse(values); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
}
