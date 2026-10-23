package embed

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type embedderStub struct {
	mu       sync.Mutex
	calls    int
	auth     string
	request  embeddingRequest
	status   int
	response string
}

func (s *embedderStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	var req embeddingRequest
	_ = json.Unmarshal(raw, &req)
	s.mu.Lock()
	s.calls++
	s.auth = r.Header.Get("Authorization")
	s.request = req
	status, response := s.status, s.response
	s.mu.Unlock()
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	_, _ = io.WriteString(w, response)
}

func (s *embedderStub) snapshot() (int, string, embeddingRequest) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls, s.auth, s.request
}

func vectorBody(t *testing.T, index int, first, second float64) string {
	t.Helper()
	vector := make([]float64, Dimensions)
	vector[0], vector[1] = first, second
	body, err := json.Marshal(map[string]any{"data": []any{map[string]any{"index": index, "embedding": vector}}})
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func newClient(t *testing.T, model string, stub *embedderStub) *Client {
	t.Helper()
	server := httptest.NewServer(stub)
	t.Cleanup(server.Close)
	return New(Config{BaseURL: server.URL + "/v1/", Model: model, APIKey: "secret"}, nil)
}

func TestQueryNormalisesVectorAndSendsContractRequest(t *testing.T) {
	stub := &embedderStub{response: vectorBody(t, 0, 3, 4)}
	client := newClient(t, "text-embedding-3-small", stub)

	vector, err := client.Query(t.Context(), "đau đầu")
	if err != nil {
		t.Fatal(err)
	}
	if vector[0] != 0.6 || vector[1] != 0.8 || len(vector) != Dimensions {
		t.Fatalf("vector starts %v, length %d", vector[:2], len(vector))
	}
	calls, auth, req := stub.snapshot()
	if calls != 1 || auth != "Bearer secret" || req.Model != "text-embedding-3-small" || req.Dimensions != Dimensions {
		t.Fatalf("calls=%d auth=%q request=%+v", calls, auth, req)
	}
	if len(req.Input) != 1 || req.Input[0] != "đau đầu" {
		t.Fatalf("input = %v, want the text without a prefix", req.Input)
	}
	if client.MaxDistance() != 0.35 {
		t.Fatalf("MaxDistance = %v, want 0.35", client.MaxDistance())
	}
}

func TestE5ModelPrefixesQueryAndTightensDistance(t *testing.T) {
	stub := &embedderStub{response: vectorBody(t, 0, 3, 4)}
	client := newClient(t, "multilingual-e5-small", stub)
	if _, err := client.Query(t.Context(), "ho"); err != nil {
		t.Fatal(err)
	}
	_, _, req := stub.snapshot()
	if len(req.Input) != 1 || req.Input[0] != "query: ho" {
		t.Fatalf("input = %v, want the query prefix", req.Input)
	}
	if client.MaxDistance() != 0.15 {
		t.Fatalf("MaxDistance = %v, want 0.15", client.MaxDistance())
	}
}

func TestRepeatedQueryIsCached(t *testing.T) {
	stub := &embedderStub{response: vectorBody(t, 0, 3, 4)}
	client := newClient(t, "text-embedding-3-small", stub)
	for i := 0; i < 2; i++ {
		if _, err := client.Query(t.Context(), "sot cao"); err != nil {
			t.Fatal(err)
		}
	}
	if calls, _, _ := stub.snapshot(); calls != 1 {
		t.Fatalf("embedder calls = %d, want 1", calls)
	}
}

func TestFailuresAreReturnedAndNotCached(t *testing.T) {
	stub := &embedderStub{status: http.StatusInternalServerError}
	client := newClient(t, "text-embedding-3-small", stub)
	if _, err := client.Query(t.Context(), "sot cao"); err == nil {
		t.Fatal("expected a status error")
	}
	stub.mu.Lock()
	stub.status = 0
	stub.response = vectorBody(t, 0, 3, 4)
	stub.mu.Unlock()
	if _, err := client.Query(t.Context(), "sot cao"); err != nil {
		t.Fatalf("second call: %v", err)
	}
	if calls, _, _ := stub.snapshot(); calls != 2 {
		t.Fatalf("embedder calls = %d, want 2", calls)
	}
}

func TestWrongDimensionIsRejected(t *testing.T) {
	stub := &embedderStub{response: `{"data":[{"index":0,"embedding":[0.1,0.2,0.3]}]}`}
	client := newClient(t, "text-embedding-3-small", stub)
	_, err := client.Query(t.Context(), "sot cao")
	if err == nil || !strings.Contains(err.Error(), "expected shape") {
		t.Fatalf("err = %v, want a shape error", err)
	}
}
