// Package config reads the search-service environment. Nothing has a default: a missing or malformed required
// variable stops the process at startup with an error that names it.
package config

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

const embeddingProvider = "openai-compatible"

// embeddingNames is the all-or-none group that configures the query embedder.
var embeddingNames = [...]string{"AI_EMBEDDING_PROVIDER", "AI_EMBEDDING_BASE_URL", "AI_EMBEDDING_MODEL", "AI_EMBEDDING_API_KEY"}

type Embedding struct {
	BaseURL string
	Model   string
	APIKey  string
}

type Config struct {
	Port            int
	TypesenseURL    string
	TypesenseAPIKey string
	CatalogURL      string
	// Embedding is nil when the group is unset, and queries then run by keyword only.
	Embedding *Embedding
}

// Load validates the environment. lookup is os.LookupEnv in production. Compose passes unset variables as empty
// strings, so an empty value counts as unset.
func Load(lookup func(string) (string, bool)) (Config, error) {
	var cfg Config
	port, err := required(lookup, "PORT")
	if err != nil {
		return Config{}, err
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return Config{}, fmt.Errorf("PORT must be an integer from 1 to 65535, got %q", port)
	}
	cfg.Port = number
	if cfg.TypesenseURL, err = requiredURL(lookup, "TYPESENSE_URL"); err != nil {
		return Config{}, err
	}
	if cfg.TypesenseAPIKey, err = required(lookup, "TYPESENSE_API_KEY"); err != nil {
		return Config{}, err
	}
	if cfg.CatalogURL, err = requiredURL(lookup, "CATALOG_SERVICE_URL"); err != nil {
		return Config{}, err
	}
	// The OTLP exporters read the endpoint from the environment themselves; this only enforces that it is set.
	if _, err = required(lookup, "OTEL_EXPORTER_OTLP_ENDPOINT"); err != nil {
		return Config{}, err
	}
	if cfg.Embedding, err = loadEmbedding(lookup); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func value(lookup func(string) (string, bool), name string) string {
	raw, _ := lookup(name)
	return strings.TrimSpace(raw)
}

func required(lookup func(string) (string, bool), name string) (string, error) {
	v := value(lookup, name)
	if v == "" {
		return "", fmt.Errorf("missing required environment variable: %s", name)
	}
	return v, nil
}

func requiredURL(lookup func(string) (string, bool), name string) (string, error) {
	v, err := required(lookup, name)
	if err != nil {
		return "", err
	}
	if err := checkURL(name, v); err != nil {
		return "", err
	}
	return v, nil
}

func checkURL(name, text string) error {
	u, err := url.Parse(text)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("%s must be an absolute http or https URL, got %q", name, text)
	}
	return nil
}

func loadEmbedding(lookup func(string) (string, bool)) (*Embedding, error) {
	values := make([]string, len(embeddingNames))
	var unset []string
	for i, name := range embeddingNames {
		values[i] = value(lookup, name)
		if values[i] == "" {
			unset = append(unset, name)
		}
	}
	if len(unset) == len(embeddingNames) {
		return nil, nil
	}
	if len(unset) > 0 {
		return nil, fmt.Errorf("the AI_EMBEDDING_* settings are all or none; missing: %s", strings.Join(unset, ", "))
	}
	provider, baseURL, model, apiKey := values[0], values[1], values[2], values[3]
	if provider != embeddingProvider {
		return nil, fmt.Errorf("AI_EMBEDDING_PROVIDER must be %q, got %q", embeddingProvider, provider)
	}
	if err := checkURL("AI_EMBEDDING_BASE_URL", baseURL); err != nil {
		return nil, err
	}
	return &Embedding{BaseURL: baseURL, Model: model, APIKey: apiKey}, nil
}
