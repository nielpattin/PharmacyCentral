package config

import (
	"strings"
	"testing"
)

func lookupFrom(env map[string]string) func(string) (string, bool) {
	return func(name string) (string, bool) {
		v, ok := env[name]
		return v, ok
	}
}

func validEnv() map[string]string {
	return map[string]string{
		"PORT":                        "3009",
		"TYPESENSE_URL":               "http://typesense:8108",
		"TYPESENSE_API_KEY":           "key",
		"CATALOG_SERVICE_URL":         "http://catalog-service:3002",
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel-collector:4318",
	}
}

func assertLoadError(t *testing.T, env map[string]string, want string) {
	t.Helper()
	_, err := Load(lookupFrom(env))
	if err == nil {
		t.Fatalf("Load succeeded, want an error naming %s", want)
	}
	if !strings.Contains(err.Error(), want) {
		t.Fatalf("error = %v, want it to name %s", err, want)
	}
}

func TestLoadAcceptsCompleteEnvironmentWithoutEmbedding(t *testing.T) {
	cfg, err := Load(lookupFrom(validEnv()))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 3009 || cfg.Embedding != nil || cfg.CatalogURL != "http://catalog-service:3002" {
		t.Fatalf("config = %+v", cfg)
	}
}

func TestLoadFailsFastOnMissingOrEmptyRequiredVariables(t *testing.T) {
	for _, name := range []string{"PORT", "TYPESENSE_URL", "TYPESENSE_API_KEY", "CATALOG_SERVICE_URL", "OTEL_EXPORTER_OTLP_ENDPOINT"} {
		env := validEnv()
		delete(env, name)
		assertLoadError(t, env, name)

		for _, blank := range []string{"", "   "} {
			env := validEnv()
			env[name] = blank
			assertLoadError(t, env, name)
		}
	}
}

func TestLoadRejectsMalformedValues(t *testing.T) {
	cases := map[string]map[string]string{
		"PORT not a number":    {"PORT": "abc"},
		"PORT zero":            {"PORT": "0"},
		"PORT too large":       {"PORT": "70000"},
		"typesense no scheme":  {"TYPESENSE_URL": "typesense:8108"},
		"catalog wrong scheme": {"CATALOG_SERVICE_URL": "ftp://catalog"},
	}
	for want, override := range cases {
		env := validEnv()
		for k, v := range override {
			env[k] = v
		}
		_, err := Load(lookupFrom(env))
		if err == nil {
			t.Errorf("%s: Load succeeded", want)
		}
	}
}

func TestLoadEmbeddingGroupIsAllOrNone(t *testing.T) {
	full := validEnv()
	full["AI_EMBEDDING_PROVIDER"] = "openai-compatible"
	full["AI_EMBEDDING_BASE_URL"] = "http://embedder:80/v1"
	full["AI_EMBEDDING_MODEL"] = "multilingual-e5-small"
	full["AI_EMBEDDING_API_KEY"] = "secret"

	cfg, err := Load(lookupFrom(full))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Embedding == nil || cfg.Embedding.Model != "multilingual-e5-small" || cfg.Embedding.BaseURL != "http://embedder:80/v1" {
		t.Fatalf("embedding = %+v", cfg.Embedding)
	}

	// Compose passes unset variables as empty strings, which means the same as unset.
	empty := validEnv()
	for _, name := range []string{"AI_EMBEDDING_PROVIDER", "AI_EMBEDDING_BASE_URL", "AI_EMBEDDING_MODEL", "AI_EMBEDDING_API_KEY"} {
		empty[name] = ""
	}
	if cfg, err := Load(lookupFrom(empty)); err != nil || cfg.Embedding != nil {
		t.Fatalf("empty group: cfg = %+v, err = %v", cfg.Embedding, err)
	}

	partial := validEnv()
	partial["AI_EMBEDDING_PROVIDER"] = "openai-compatible"
	partial["AI_EMBEDDING_MODEL"] = "multilingual-e5-small"
	assertLoadError(t, partial, "AI_EMBEDDING_BASE_URL")
	assertLoadError(t, partial, "AI_EMBEDDING_API_KEY")

	wrongProvider := validEnv()
	for k, v := range full {
		wrongProvider[k] = v
	}
	wrongProvider["AI_EMBEDDING_PROVIDER"] = "gemini"
	assertLoadError(t, wrongProvider, "AI_EMBEDDING_PROVIDER")
}
