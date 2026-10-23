// Package handler serves GET /products and the operational routes of the search service.
package handler

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"time"

	"pharmacycentral/search-service/internal/cache"
	"pharmacycentral/search-service/internal/query"
	"pharmacycentral/search-service/internal/search"
)

const (
	responseCacheEntries = 5000
	responseCacheTTL     = 30 * time.Second
	jsonContentType      = "application/json; charset=utf-8"
	invalidRequestBody   = `{"title":"Invalid request","status":400,"code":"invalid_request"}`
	notFoundBody         = `{"title":"Not Found","status":404}`
)

// Products answers GET /products. Identical lists are served from a short-lived response cache. A request the index
// cannot answer goes to catalog-service unchanged.
type Products struct {
	finder   *search.Service
	cache    *cache.Cache[search.Answer]
	fallback http.Handler
}

func NewProducts(finder *search.Service, fallback http.Handler) *Products {
	responses := cache.New[search.Answer](cache.Options{MaxEntries: responseCacheEntries, TTL: responseCacheTTL})
	return newProducts(finder, fallback, responses)
}

func newProducts(finder *search.Service, fallback http.Handler, responses *cache.Cache[search.Answer]) *Products {
	return &Products{finder: finder, cache: responses, fallback: fallback}
}

func (p *Products) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	params, err := query.Parse(r.URL.Query())
	if err != nil {
		writeProblem(w, http.StatusBadRequest, invalidRequestBody)
		return
	}
	answer, err := p.cache.Load(params.CacheKey(), func() (search.Answer, error) {
		// A shared load outlives the request that started it, so one client disconnecting does not fail the others.
		return p.finder.Find(context.WithoutCancel(r.Context()), params)
	})
	if err != nil {
		slog.WarnContext(r.Context(), "product search degraded; forwarding to catalog-service", "error", err)
		p.fallback.ServeHTTP(w, r)
		return
	}
	if answer.NextCursor != "" {
		w.Header().Set("X-Next-Cursor", answer.NextCursor)
	}
	w.Header().Set("Content-Type", jsonContentType)
	_, _ = w.Write(answer.Body)
}

// Routes maps the service surface. Every other path answers 404 as JSON, like catalog-service.
func Routes(products http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /products", products)
	mux.HandleFunc("GET /healthz", healthz)
	mux.HandleFunc("/", notFound)
	return mux
}

func healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, "ok")
}

func notFound(w http.ResponseWriter, _ *http.Request) {
	writeProblem(w, http.StatusNotFound, notFoundBody)
}

func writeProblem(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", jsonContentType)
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
}
