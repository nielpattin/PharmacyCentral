package handler

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
)

const catalogDownBody = `{"title":"Catalog service is unavailable","status":502}`

// NewFallback forwards a request unchanged to catalog-service, which answers the same list from PostgreSQL.
func NewFallback(catalogURL *url.URL, transport http.RoundTripper) http.Handler {
	return &httputil.ReverseProxy{
		Rewrite: func(out *httputil.ProxyRequest) {
			out.SetURL(catalogURL)
			out.SetXForwarded()
		},
		Transport: transport,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.ErrorContext(r.Context(), "catalog-service fallback failed", "error", err)
			writeProblem(w, http.StatusBadGateway, catalogDownBody)
		},
	}
}
