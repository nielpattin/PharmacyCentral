package search

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"pharmacycentral/search-service/internal/cursor"
	"pharmacycentral/search-service/internal/embed"
	"pharmacycentral/search-service/internal/query"
	"pharmacycentral/search-service/internal/typesense"
)

const twoHitsResponse = `{"results":[{"found":3,"hits":[
 {"document":{"payload":"{\"id\":\"a\"}"},"text_match":2},
 {"document":{"payload":"{\"id\":\"b\"}"},"text_match":1},
 {"document":{"payload":"{\"id\":\"c\"}"},"text_match":1}
]}]}`

type recorder struct {
	response string
	status   int

	mu    sync.Mutex
	calls int
	body  map[string]any
}

func (r *recorder) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	raw, _ := io.ReadAll(req.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	r.mu.Lock()
	r.calls++
	r.body = body
	r.mu.Unlock()
	if r.status != 0 {
		w.WriteHeader(r.status)
	}
	_, _ = io.WriteString(w, r.response)
}

func (r *recorder) snapshot() (int, map[string]any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls, r.body
}

func embeddingBody() string {
	vector := make([]float64, embed.Dimensions)
	vector[0], vector[1] = 3, 4
	body, _ := json.Marshal(map[string]any{"data": []any{map[string]any{"index": 0, "embedding": vector}}})
	return string(body)
}

// newService wires a Service to stub servers. embedderStatus 0 means the embedder answers normally.
func newService(t *testing.T, indexResponse string, embedderStatus int) (*Service, *recorder, *recorder) {
	t.Helper()
	index := &recorder{response: indexResponse}
	indexServer := httptest.NewServer(index)
	t.Cleanup(indexServer.Close)
	client, err := typesense.New(indexServer.URL, "key", nil)
	if err != nil {
		t.Fatal(err)
	}
	embedderStub := &recorder{response: embeddingBody(), status: embedderStatus}
	embedderServer := httptest.NewServer(embedderStub)
	t.Cleanup(embedderServer.Close)
	embedder := embed.New(embed.Config{BaseURL: embedderServer.URL + "/v1", Model: "text-embedding-3-small", APIKey: "k"}, nil)
	return NewService(client, embedder), index, embedderStub
}

func indexSearchParams(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	list, ok := body["searches"].([]any)
	if !ok || len(list) != 1 {
		t.Fatalf("body = %v", body)
	}
	params, ok := list[0].(map[string]any)
	if !ok {
		t.Fatalf("search = %v", list[0])
	}
	return params
}

func TestQueriesUnderThreeWordsStayKeywordOnly(t *testing.T) {
	svc, index, embedder := newService(t, twoHitsResponse, 0)
	if _, err := svc.Find(context.Background(), query.Params{Search: "ho ho", Limit: 20}); err != nil {
		t.Fatal(err)
	}
	if calls, _ := embedder.snapshot(); calls != 0 {
		t.Fatalf("embedder calls = %d, want 0", calls)
	}
	_, body := index.snapshot()
	if _, ok := indexSearchParams(t, body)["vector_query"]; ok {
		t.Fatal("short query sent a vector_query")
	}
}

func TestLongQueriesUseTheVectorBranch(t *testing.T) {
	svc, index, embedder := newService(t, twoHitsResponse, 0)
	if _, err := svc.Find(context.Background(), query.Params{Search: "thuoc cho be bi sot", Limit: 20}); err != nil {
		t.Fatal(err)
	}
	if calls, _ := embedder.snapshot(); calls != 1 {
		t.Fatalf("embedder calls = %d, want 1", calls)
	}
	_, body := index.snapshot()
	vq, _ := indexSearchParams(t, body)["vector_query"].(string)
	if !strings.HasPrefix(vq, "embedding:([0.6,0.8,0,") {
		t.Fatalf("vector_query = %q", vq)
	}
}

func TestEmbedderFailureFallsBackToKeywordSearch(t *testing.T) {
	svc, index, _ := newService(t, twoHitsResponse, http.StatusInternalServerError)
	answer, err := svc.Find(context.Background(), query.Params{Search: "thuoc cho be bi sot", Limit: 20})
	if err != nil {
		t.Fatalf("Find: %v, want keyword-only success", err)
	}
	if string(answer.Body) != `[{"id":"a"},{"id":"b"},{"id":"c"}]` {
		t.Fatalf("body = %s", answer.Body)
	}
	_, body := index.snapshot()
	if _, ok := indexSearchParams(t, body)["vector_query"]; ok {
		t.Fatal("failed embedding still sent a vector_query")
	}
}

func TestBrowseNeverEmbeds(t *testing.T) {
	svc, index, embedder := newService(t, twoHitsResponse, 0)
	if _, err := svc.Find(context.Background(), query.Params{Limit: 20}); err != nil {
		t.Fatal(err)
	}
	if calls, _ := embedder.snapshot(); calls != 0 {
		t.Fatalf("embedder calls = %d, want 0", calls)
	}
	_, body := index.snapshot()
	if sort, _ := indexSearchParams(t, body)["sort_by"].(string); sort != "sku:asc" {
		t.Fatalf("sort_by = %q", sort)
	}
}

func TestAnswerJoinsPayloadsAndSetsNextCursor(t *testing.T) {
	svc, _, _ := newService(t, twoHitsResponse, 0)
	answer, err := svc.Find(context.Background(), query.Params{Search: "ho", Limit: 2, Offset: 0})
	if err != nil {
		t.Fatal(err)
	}
	if string(answer.Body) != `[{"id":"a"},{"id":"b"}]` {
		t.Fatalf("body = %s", answer.Body)
	}
	if answer.NextCursor != cursor.Encode(2) {
		t.Fatalf("NextCursor = %q, want %q", answer.NextCursor, cursor.Encode(2))
	}
}
