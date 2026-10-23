package typesense

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
)

type stub struct {
	response string

	mu     sync.Mutex
	calls  int
	path   string
	apiKey string
	body   map[string]any
}

func (s *stub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	s.mu.Lock()
	s.calls++
	s.path = r.URL.Path
	s.apiKey = r.Header.Get("X-TYPESENSE-API-KEY")
	s.body = body
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, s.response)
}

func newClient(t *testing.T, response string) (*Client, *stub) {
	t.Helper()
	s := &stub{response: response}
	server := httptest.NewServer(s)
	t.Cleanup(server.Close)
	client, err := New(server.URL, "test-key", nil)
	if err != nil {
		t.Fatal(err)
	}
	return client, s
}

func searchObject(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	list, ok := body["searches"].([]any)
	if !ok || len(list) != 1 {
		t.Fatalf("body = %v, want one search", body)
	}
	params, ok := list[0].(map[string]any)
	if !ok {
		t.Fatalf("search = %v", list[0])
	}
	return params
}

func assertParams(t *testing.T, got map[string]any, wantJSON string) {
	t.Helper()
	var want map[string]any
	if err := json.Unmarshal([]byte(wantJSON), &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		gotJSON, _ := json.Marshal(got)
		t.Fatalf("params =\n%s\nwant\n%s", gotJSON, wantJSON)
	}
}

const emptyResponse = `{"results":[{"found":0,"hits":[]}]}`

// Four hits: a matched text, b and c are vector-only (b near, c far), d matched text beyond the first page.
const mixedResponse = `{"results":[{"found":4,"hits":[
 {"document":{"payload":"{\"id\":\"a\"}"},"text_match":5},
 {"document":{"payload":"{\"id\":\"b\"}"},"text_match":0,"vector_distance":0.1},
 {"document":{"payload":"{\"id\":\"c\"}"},"text_match":0,"vector_distance":0.5},
 {"document":{"payload":"{\"id\":\"d\"}"},"text_match":1}
]}]}`

func TestTextSearchSendsTheNodeParameters(t *testing.T) {
	client, s := newClient(t, emptyResponse)
	prescription := true
	_, err := client.Search(context.Background(), Request{
		Text:                 "Đau đầu",
		Category:             "Kháng sinh",
		PrescriptionRequired: &prescription,
		Limit:                20,
		Offset:               0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if s.path != "/multi_search" || s.apiKey != "test-key" {
		t.Fatalf("path=%q key=%q", s.path, s.apiKey)
	}
	assertParams(t, searchObject(t, s.body), `{
		"collection": "catalog_products_v3",
		"q": "dau dau",
		"query_by": "sku,barcode,name_folded,active_ingredient_folded,generic_name_folded,indications_folded",
		"query_by_weights": "4,4,4,3,3,1",
		"drop_tokens_threshold": 0,
		"prefix": false,
		"include_fields": "payload",
		"limit": 21,
		"offset": 0,
		"filter_by": "prescription_required:=true && category:=`+"`Kháng sinh`"+`"
	}`)
}

func TestBrowseIsSortedBySkuWithoutText(t *testing.T) {
	client, s := newClient(t, emptyResponse)
	prescription := false
	if _, err := client.Search(context.Background(), Request{PrescriptionRequired: &prescription, Limit: 5, Offset: 10}); err != nil {
		t.Fatal(err)
	}
	assertParams(t, searchObject(t, s.body), `{
		"collection": "catalog_products_v3",
		"q": "*",
		"query_by": "sku,barcode,name_folded,active_ingredient_folded,generic_name_folded,indications_folded",
		"query_by_weights": "4,4,4,3,3,1",
		"drop_tokens_threshold": 0,
		"prefix": false,
		"include_fields": "payload",
		"limit": 6,
		"offset": 10,
		"filter_by": "prescription_required:=false",
		"sort_by": "sku:asc"
	}`)
}

func TestHybridSearchSendsVectorQueryWithCandidateCount(t *testing.T) {
	client, s := newClient(t, emptyResponse)
	_, err := client.Search(context.Background(), Request{
		Text:        "sốt cao cho bé",
		Embedding:   []float64{0.6, 0.8},
		MaxDistance: 0.15,
		Limit:       20,
		Offset:      200,
	})
	if err != nil {
		t.Fatal(err)
	}
	params := searchObject(t, s.body)
	if params["vector_query"] != "embedding:([0.6,0.8], k:221, alpha:0.3)" {
		t.Fatalf("vector_query = %v", params["vector_query"])
	}
	if params["q"] != "sot cao cho be" {
		t.Fatalf("q = %v", params["q"])
	}
	if _, ok := params["sort_by"]; ok {
		t.Fatal("text search must keep Typesense relevance order, not sort_by")
	}
}

func TestHybridHitsAreFilteredByDistanceAndPaged(t *testing.T) {
	client, _ := newClient(t, mixedResponse)
	got, err := client.Search(context.Background(), Request{Text: "sot", Embedding: []float64{0.6, 0.8}, MaxDistance: 0.15, Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if !got.HasMore {
		t.Fatal("HasMore = false, want true: the index returned a hit beyond the page")
	}
	if want := []string{`{"id":"a"}`, `{"id":"b"}`}; !reflect.DeepEqual(got.Payloads, want) {
		t.Fatalf("payloads = %v, want %v", got.Payloads, want)
	}
}

func TestKeywordSearchKeepsEveryHitOfThePage(t *testing.T) {
	client, _ := newClient(t, mixedResponse)
	got, err := client.Search(context.Background(), Request{Text: "sot", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if got.HasMore || len(got.Payloads) != 4 {
		t.Fatalf("got %+v", got)
	}
}

func TestCategoryWithBacktickSkipsTypesense(t *testing.T) {
	client, s := newClient(t, emptyResponse)
	got, err := client.Search(context.Background(), Request{Category: "a`b", Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if s.calls != 0 || len(got.Payloads) != 0 || got.HasMore {
		t.Fatalf("calls=%d result=%+v", s.calls, got)
	}
}

func TestTypesenseErrorsAreReturned(t *testing.T) {
	cases := map[string]string{
		"result error":    `{"results":[{"error":"Could not find a field named x.","code":404}]}`,
		"no result":       `{"results":[]}`,
		"missing payload": `{"results":[{"hits":[{"document":{}}]}]}`,
	}
	for name, response := range cases {
		client, _ := newClient(t, response)
		if _, err := client.Search(context.Background(), Request{Text: "sot", Limit: 20}); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}
