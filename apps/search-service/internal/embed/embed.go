// Package embed turns the shopper's query into a unit vector through an OpenAI-compatible embeddings endpoint, the same
// wire format catalog-service uses.
package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"pharmacycentral/search-service/internal/lru"
)

// Dimensions is the vector size of every embedding in this stack (catalog-service text-embedder.ts).
const Dimensions = 384

const (
	queryTimeout = 3 * time.Second
	cacheEntries = 5000
)

var e5Model = regexp.MustCompile(`(?i)(^|[/_-])e5([/_-]|$)`)

type Config struct {
	BaseURL string
	Model   string
	APIKey  string
}

// Client embeds shopper queries. Vectors are kept in a small LRU keyed by the query text: the model is fixed for a
// process, so the text alone identifies a vector.
type Client struct {
	endpoint    string
	model       string
	apiKey      string
	queryPrefix string
	maxDistance float64
	http        *http.Client
	lookups     metric.Int64Counter

	mu      sync.Mutex
	vectors *lru.Cache[string, []float64]
}

type embeddingRequest struct {
	Model      string   `json:"model"`
	Input      []string `json:"input"`
	Dimensions int      `json:"dimensions"`
}

type embeddingResponse struct {
	Data []embeddingItem `json:"data"`
}

type embeddingItem struct {
	Index     *int      `json:"index"`
	Embedding []float64 `json:"embedding"`
}

// New builds a client. E5 models were trained with a "query: " prefix and their vectors sit closer together, so they
// get the tighter distance cut-off (catalog-service openai-compatible-text-embedder.ts).
func New(cfg Config, transport http.RoundTripper) *Client {
	c := &Client{
		endpoint:    strings.TrimRight(cfg.BaseURL, "/") + "/embeddings",
		model:       cfg.Model,
		apiKey:      cfg.APIKey,
		maxDistance: 0.35,
		http:        &http.Client{Transport: transport},
		vectors:     lru.New[string, []float64](cacheEntries),
	}
	if e5Model.MatchString(cfg.Model) {
		c.queryPrefix = "query: "
		c.maxDistance = 0.15
	}
	// The API returns a no-op instrument when creation fails, so the error carries nothing to act on.
	c.lookups, _ = otel.Meter("search-service").Int64Counter(
		"pharmacy.search.embedding_cache",
		metric.WithUnit("{lookup}"),
		metric.WithDescription("Query vector lookups by outcome: hit (no embedder call) or miss (one embedder call)"),
	)
	return c
}

// MaxDistance is the cosine distance above which a vector-only search hit is dropped.
func (c *Client) MaxDistance() float64 {
	return c.maxDistance
}

// Query returns the unit vector of a shopper query. Failures are not cached.
func (c *Client) Query(ctx context.Context, text string) ([]float64, error) {
	c.mu.Lock()
	cached, ok := c.vectors.Get(text)
	c.mu.Unlock()
	if ok {
		c.count("hit")
		return cached, nil
	}
	c.count("miss")
	vector, err := c.embed(ctx, c.queryPrefix+text)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.vectors.Add(text, vector)
	c.mu.Unlock()
	return vector, nil
}

func (c *Client) embed(ctx context.Context, input string) ([]float64, error) {
	body, err := json.Marshal(embeddingRequest{Model: c.model, Input: []string{input}, Dimensions: Dimensions})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embedding request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("embedding request failed with status %d", resp.StatusCode)
	}
	var decoded embeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("embedding response is not valid JSON: %w", err)
	}
	return firstVector(decoded.Data)
}

// firstVector returns the vector of the lowest index, the answer to the single input sent.
func firstVector(items []embeddingItem) ([]float64, error) {
	var first *embeddingItem
	for i := range items {
		item := &items[i]
		if item.Index == nil || *item.Index < 0 || len(item.Embedding) != Dimensions {
			return nil, fmt.Errorf("embedding response does not match the expected shape: %d-dimension vectors with an index", Dimensions)
		}
		if first == nil || *item.Index < *first.Index {
			first = item
		}
	}
	if first == nil {
		return nil, errors.New("embedding response has no embedding for the query")
	}
	return normalize(first.Embedding)
}

func normalize(values []float64) ([]float64, error) {
	var sum float64
	for _, v := range values {
		sum += v * v
	}
	norm := math.Sqrt(sum)
	if norm == 0 || math.IsInf(norm, 0) || math.IsNaN(norm) {
		return nil, errors.New("embedding has a zero or non-finite norm")
	}
	out := make([]float64, len(values))
	for i, v := range values {
		out[i] = v / norm
	}
	return out, nil
}

func (c *Client) count(outcome string) {
	c.lookups.Add(context.Background(), 1, metric.WithAttributes(attribute.String("outcome", outcome)))
}
