// Command search-service answers GET /products (the public /api/products list) from the Typesense index, and hands
// every request it cannot answer to catalog-service.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"pharmacycentral/search-service/internal/config"
	"pharmacycentral/search-service/internal/embed"
	"pharmacycentral/search-service/internal/handler"
	"pharmacycentral/search-service/internal/search"
	"pharmacycentral/search-service/internal/telemetry"
	"pharmacycentral/search-service/internal/typesense"
)

const (
	readHeaderTimeout = 10 * time.Second
	shutdownTimeout   = 10 * time.Second
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "search-service: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	shutdownTelemetry, err := telemetry.Setup(ctx)
	if err != nil {
		return err
	}
	transport := telemetry.Transport()
	index, err := typesense.New(cfg.TypesenseURL, cfg.TypesenseAPIKey, transport)
	if err != nil {
		return err
	}
	var embedder *embed.Client
	if cfg.Embedding != nil {
		embedder = embed.New(embed.Config{
			BaseURL: cfg.Embedding.BaseURL,
			Model:   cfg.Embedding.Model,
			APIKey:  cfg.Embedding.APIKey,
		}, transport)
	}
	catalogURL, err := url.Parse(cfg.CatalogURL)
	if err != nil {
		return err
	}
	products := handler.NewProducts(search.NewService(index, embedder), handler.NewFallback(catalogURL, transport))
	server := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           otelhttp.NewHandler(handler.Routes(products), "search-service"),
		ReadHeaderTimeout: readHeaderTimeout,
	}

	serveErr := make(chan error, 1)
	go func() { serveErr <- server.ListenAndServe() }()
	slog.Info("search-service listening", "port", cfg.Port, "semantic", cfg.Embedding != nil)

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}
	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	return errors.Join(server.Shutdown(shutdownCtx), shutdownTelemetry(shutdownCtx))
}
