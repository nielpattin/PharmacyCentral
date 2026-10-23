// Package query validates GET /products parameters the way catalog-service's productSearchQuerySchema does.
package query

import (
	"errors"
	"math"
	"net/url"
	"strconv"
	"strings"

	"pharmacycentral/search-service/internal/cursor"
	"pharmacycentral/search-service/internal/jsstring"
)

// ErrInvalid means the request breaks the contract and is answered 400 invalid_request.
var ErrInvalid = errors.New("invalid request")

const (
	maxSearchLength   = 200
	maxCategoryLength = 100
	defaultLimit      = 20
	minLimit          = 1
	maxLimit          = 100
)

// knownKeys are the parameters that Express would parse into objects or arrays when written with brackets.
var knownKeys = map[string]bool{
	"search":               true,
	"category":             true,
	"prescriptionRequired": true,
	"limit":                true,
	"cursor":               true,
}

// Params is the validated query, shaped like the catalog-service handler's query object.
type Params struct {
	// Search is the shopper's text trimmed, lower-cased and with whitespace runs collapsed. Empty means browse.
	Search   string
	Category string
	// PrescriptionRequired is nil when the parameter is absent.
	PrescriptionRequired *bool
	Limit                int
	Offset               int
}

func Parse(values url.Values) (Params, error) {
	for key := range values {
		if base, _, nested := strings.Cut(key, "["); nested && knownKeys[base] {
			return Params{}, ErrInvalid
		}
	}
	params := Params{Limit: defaultLimit}

	if raw, present, err := singleValue(values, "search"); err != nil {
		return Params{}, err
	} else if present {
		text := jsstring.Trim(raw)
		if jsstring.Length(text) > maxSearchLength {
			return Params{}, ErrInvalid
		}
		params.Search = jsstring.CollapseSpaces(strings.ToLower(text))
	}

	if raw, present, err := singleValue(values, "category"); err != nil {
		return Params{}, err
	} else if present {
		category := jsstring.Trim(raw)
		if jsstring.Length(category) > maxCategoryLength {
			return Params{}, ErrInvalid
		}
		params.Category = category
	}

	if raw, present, err := singleValue(values, "prescriptionRequired"); err != nil {
		return Params{}, err
	} else if present {
		var required bool
		switch raw {
		case "true":
			required = true
		case "false":
			required = false
		default:
			return Params{}, ErrInvalid
		}
		params.PrescriptionRequired = &required
	}

	if raw, present, err := singleValue(values, "limit"); err != nil {
		return Params{}, err
	} else if present {
		n, ok := jsstring.ToNumber(raw)
		if !ok || n != math.Trunc(n) || n < minLimit || n > maxLimit {
			return Params{}, ErrInvalid
		}
		params.Limit = int(n)
	}

	if raw, present, err := singleValue(values, "cursor"); err != nil {
		return Params{}, err
	} else if present {
		offset, ok := cursor.Decode(raw)
		if !ok {
			return Params{}, ErrInvalid
		}
		params.Offset = offset
	}
	return params, nil
}

// CacheKey identifies the answer to a query. Only the normalised fields take part, so equal answers share one entry.
func (p Params) CacheKey() string {
	prescription := "any"
	if p.PrescriptionRequired != nil {
		prescription = strconv.FormatBool(*p.PrescriptionRequired)
	}
	return strconv.Quote(p.Search) + "|" + strconv.Quote(p.Category) + "|" + prescription + "|" +
		strconv.Itoa(p.Limit) + "|" + strconv.Itoa(p.Offset)
}

// singleValue returns the one value of a parameter. A repeated parameter is an array to Express, which the string
// schemas reject.
func singleValue(values url.Values, name string) (string, bool, error) {
	list, present := values[name]
	if !present {
		return "", false, nil
	}
	if len(list) != 1 {
		return "", false, ErrInvalid
	}
	// Express decodes bytes leniently, so invalid UTF-8 reaches the schema as U+FFFD.
	return strings.ToValidUTF8(list[0], "\uFFFD"), true, nil
}
