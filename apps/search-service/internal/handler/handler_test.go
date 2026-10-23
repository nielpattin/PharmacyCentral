package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"pharmacycentral/search-service/internal/cache"
	"pharmacycentral/search-service/internal/cursor"
	"pharmacycentral/search-service/internal/search"
	"pharmacycentral/search-service/internal/typesense"
)

const threeHits = `{"results":[{"found":3,"hits":[
 {"document":{"payload":"{\"id\":\"a\"}"},"text_match":2},
 {"document":{"payload":"{\"id\":\"b\"}"},"text_match":1},
 {"document":{"payload":"{\"id\":\"c\"}"},"text_match":1}
]}]}`

type indexStub struct {
	status   int
	response string

	mu    sync.Mutex
	calls int
}

func (s *indexStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	_, _ = io.Copy(io.Discard, r.Body)
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	status := s.status
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	_, _ = io.WriteString(w, s.response)
}

func (s *indexStub) Calls() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

func newProductsUnderTest(t *testing.T, stub *indexStub, fallback http.Handler) *Products {
	t.Helper()
	server := httptest.NewServer(stub)
	t.Cleanup(server.Close)
	index, err := typesense.New(server.URL, "key", nil)
	if err != nil {
		t.Fatal(err)
	}
	responses := cache.New[search.Answer](cache.Options{MaxEntries: 10, TTL: time.Minute})
	return newProducts(search.NewService(index, nil), fallback, responses)
}

func get(h http.Handler, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func failIfCalled(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("catalog-service must not be called for %s", r.URL.String())
		w.WriteHeader(http.StatusInternalServerError)
	})
}

func TestInvalidQueryIsAnsweredWithoutSearching(t *testing.T) {
	stub := &indexStub{response: threeHits}
	h := newProductsUnderTest(t, stub, failIfCalled(t))
	rec := get(h, "/products?limit=0")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Body.String(); got != `{"title":"Invalid request","status":400,"code":"invalid_request"}` {
		t.Fatalf("body = %s", got)
	}
	if stub.Calls() != 0 {
		t.Fatal("invalid query reached Typesense")
	}
}

func TestPageCarriesNextCursorWhenMoreFollows(t *testing.T) {
	stub := &indexStub{response: threeHits}
	h := newProductsUnderTest(t, stub, failIfCalled(t))
	rec := get(h, "/products?limit=2")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Body.String(); got != `[{"id":"a"},{"id":"b"}]` {
		t.Fatalf("body = %s", got)
	}
	if got := rec.Header().Get("X-Next-Cursor"); got != cursor.Encode(2) {
		t.Fatalf("X-Next-Cursor = %q", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q", got)
	}
}

func TestLastPageHasNoNextCursor(t *testing.T) {
	stub := &indexStub{response: threeHits}
	h := newProductsUnderTest(t, stub, failIfCalled(t))
	rec := get(h, "/products?limit=3")
	if _, present := rec.Header()["X-Next-Cursor"]; present {
		t.Fatal("last page must not carry X-Next-Cursor")
	}
}

func TestIdenticalListIsServedFromCache(t *testing.T) {
	stub := &indexStub{response: threeHits}
	h := newProductsUnderTest(t, stub, failIfCalled(t))
	first := get(h, "/products?search=HO%20%20ho&limit=3")
	second := get(h, "/products?search=ho%20ho&limit=3")
	if stub.Calls() != 1 {
		t.Fatalf("Typesense calls = %d, want 1", stub.Calls())
	}
	if first.Body.String() != second.Body.String() {
		t.Fatal("cached answer differs")
	}
}

func TestTypesenseFailureProxiesRequestToCatalog(t *testing.T) {
	catalog := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/products" || r.URL.RawQuery != "search=ho&limit=5" {
			w.WriteHeader(http.StatusTeapot)
			return
		}
		w.Header().Set("X-Next-Cursor", "from-catalog")
		_, _ = io.WriteString(w, `[{"id":"catalog"}]`)
	}))
	t.Cleanup(catalog.Close)
	catalogURL, err := url.Parse(catalog.URL)
	if err != nil {
		t.Fatal(err)
	}
	stub := &indexStub{status: http.StatusServiceUnavailable}
	h := newProductsUnderTest(t, stub, NewFallback(catalogURL, nil))
	rec := get(h, "/products?search=ho&limit=5")
	if rec.Code != http.StatusOK || rec.Body.String() != `[{"id":"catalog"}]` {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Next-Cursor") != "from-catalog" {
		t.Fatalf("X-Next-Cursor = %q", rec.Header().Get("X-Next-Cursor"))
	}
}

func TestUnknownPathIsJSON404(t *testing.T) {
	rec := get(Routes(failIfCalled(t)), "/nope")
	if rec.Code != http.StatusNotFound || rec.Body.String() != `{"title":"Not Found","status":404}` {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHealthzAnswersOK(t *testing.T) {
	rec := get(Routes(failIfCalled(t)), "/healthz")
	if rec.Code != http.StatusOK || rec.Body.String() != "ok" {
		t.Fatalf("status=%d body=%q", rec.Code, rec.Body.String())
	}
}
