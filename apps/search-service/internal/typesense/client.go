// Package typesense runs product searches against the catalog_products_v3 collection. Every parameter mirrors
// catalog-service's TypesenseProductSearchIndex.search(); the only additions are the browse sort and the payload field.
package typesense

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"pharmacycentral/search-service/internal/fold"
)

// Collection is the product index written by catalog-service's indexer.
const Collection = "catalog_products_v3"

const (
	searchTimeout = 2 * time.Second
	// queryBy and queryByWeights are the same strings as catalog-service typesense-product-search-index.ts.
	queryBy        = "sku,barcode,name_folded,active_ingredient_folded,generic_name_folded,indications_folded"
	queryByWeights = "4,4,4,3,3,1"
	// includeFields returns only the stored product JSON; the hit fields used for ranking come back regardless.
	includeFields = "payload"
	// semanticAlpha is the vector weight of Typesense hybrid ranking (hybrid-search.ts SEMANTIC_ALPHA).
	semanticAlpha = 0.3
	// vectorCandidates is the minimum number of vector neighbours ranked (VECTOR_CANDIDATES).
	vectorCandidates = 100
	// browseSortBy orders browse lists, which have no text ranking, by SKU.
	browseSortBy = "sku:asc"
)

// Request is one page of a product search. Text must already be normalised by the caller.
type Request struct {
	// Text is the shopper's text. Empty means browse.
	Text string
	// Embedding is the unit query vector. Nil runs keyword-only.
	Embedding []float64
	// MaxDistance is the farthest vector-only hit kept when Embedding is set.
	MaxDistance          float64
	Category             string
	PrescriptionRequired *bool
	Limit                int
	Offset               int
}

// Result is one page: payloads in rank order, and whether the index ranks more results beyond this page.
type Result struct {
	Payloads []string
	HasMore  bool
}

type Client struct {
	searchURL string
	apiKey    string
	http      *http.Client
}

// New builds a client. baseURL is the Typesense origin, for example http://typesense:8108.
func New(baseURL, apiKey string, transport http.RoundTripper) (*Client, error) {
	base, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse Typesense URL: %w", err)
	}
	// An absolute path replaces any path in baseURL, as catalog-service's new URL(path, baseUrl) does.
	endpoint := base.ResolveReference(&url.URL{Path: "/multi_search"})
	return &Client{searchURL: endpoint.String(), apiKey: apiKey, http: &http.Client{Transport: transport}}, nil
}

// searchParams is one entry of the multi_search searches array.
type searchParams struct {
	Collection          string `json:"collection"`
	Q                   string `json:"q"`
	QueryBy             string `json:"query_by"`
	QueryByWeights      string `json:"query_by_weights"`
	DropTokensThreshold int    `json:"drop_tokens_threshold"`
	Prefix              bool   `json:"prefix"`
	IncludeFields       string `json:"include_fields"`
	Limit               int    `json:"limit"`
	Offset              int    `json:"offset"`
	FilterBy            string `json:"filter_by,omitempty"`
	SortBy              string `json:"sort_by,omitempty"`
	VectorQuery         string `json:"vector_query,omitempty"`
}

type multiSearchBody struct {
	Searches []searchParams `json:"searches"`
}

type multiSearchResponse struct {
	Results []searchResult `json:"results"`
}

type searchResult struct {
	Code  int     `json:"code"`
	Error *string `json:"error"`
	Hits  []hit   `json:"hits"`
}

type hit struct {
	Document       *document `json:"document"`
	TextMatch      *float64  `json:"text_match"`
	VectorDistance *float64  `json:"vector_distance"`
}

type document struct {
	Payload *string `json:"payload"`
}

// Search runs one page of product search. A category containing a backtick returns no hits without a request, as
// catalog-service does, because Typesense cannot quote it.
func (c *Client) Search(ctx context.Context, req Request) (Result, error) {
	var filters []string
	if req.PrescriptionRequired != nil {
		filters = append(filters, "prescription_required:="+strconv.FormatBool(*req.PrescriptionRequired))
	}
	if req.Category != "" {
		if strings.Contains(req.Category, "`") {
			return Result{}, nil
		}
		filters = append(filters, "category:=`"+req.Category+"`")
	}
	q := fold.Fold(req.Text)
	if q == "" {
		q = "*"
	}
	params := searchParams{
		Collection:     Collection,
		Q:              q,
		QueryBy:        queryBy,
		QueryByWeights: queryByWeights,
		// Typesense drops query words when nothing matches, so "điện thoại" would match everything with "điện".
		DropTokensThreshold: 0,
		// Without prefix false, "ho" also matches every word that starts with it ("hoá", "hoạt").
		Prefix:        false,
		IncludeFields: includeFields,
		// One hit more than the page, only to learn whether another page follows.
		Limit:  req.Limit + 1,
		Offset: req.Offset,
	}
	if len(filters) > 0 {
		params.FilterBy = strings.Join(filters, " && ")
	}
	if req.Text == "" {
		params.SortBy = browseSortBy
	}
	if req.Embedding != nil {
		// distance_threshold is ignored in hybrid mode, so the distance cut-off is applied to the hits instead.
		k := max(vectorCandidates, req.Offset+req.Limit+1)
		params.VectorQuery = fmt.Sprintf("embedding:([%s], k:%d, alpha:%s)",
			formatVector(req.Embedding), k, strconv.FormatFloat(semanticAlpha, 'f', -1, 64))
	}

	payload, err := json.Marshal(multiSearchBody{Searches: []searchParams{params}})
	if err != nil {
		return Result{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.searchURL, bytes.NewReader(payload))
	if err != nil {
		return Result{}, err
	}
	httpReq.Header.Set("X-TYPESENSE-API-KEY", c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return Result{}, fmt.Errorf("typesense search: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return Result{}, fmt.Errorf("typesense search failed with status %d", resp.StatusCode)
	}
	var body multiSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Result{}, fmt.Errorf("typesense search returned an invalid body: %w", err)
	}
	return page(body, req)
}

// page applies catalog-service's hit rules: at most `limit` hits, and in hybrid mode a hit is kept when it matched text
// or sits within the distance cut-off. Payloads are unwrapped, never decoded.
func page(body multiSearchResponse, req Request) (Result, error) {
	if len(body.Results) == 0 {
		return Result{}, errors.New("typesense search returned no result")
	}
	first := body.Results[0]
	if first.Error != nil {
		return Result{}, fmt.Errorf("typesense search failed with code %d: %s", first.Code, *first.Error)
	}
	hits := first.Hits
	result := Result{HasMore: len(hits) > req.Limit}
	if len(hits) > req.Limit {
		hits = hits[:req.Limit]
	}
	for _, h := range hits {
		if req.Embedding != nil && !keepHit(h, req.MaxDistance) {
			continue
		}
		if h.Document == nil || h.Document.Payload == nil {
			return Result{}, errors.New("typesense hit has no payload; the index needs a rebuild")
		}
		result.Payloads = append(result.Payloads, *h.Document.Payload)
	}
	return result, nil
}

func keepHit(h hit, maxDistance float64) bool {
	textMatch := 0.0
	if h.TextMatch != nil {
		textMatch = *h.TextMatch
	}
	distance := math.Inf(1)
	if h.VectorDistance != nil {
		distance = *h.VectorDistance
	}
	return textMatch > 0 || distance <= maxDistance
}

func formatVector(values []float64) string {
	parts := make([]string, len(values))
	for i, v := range values {
		parts[i] = strconv.FormatFloat(v, 'f', -1, 64)
	}
	return strings.Join(parts, ",")
}
