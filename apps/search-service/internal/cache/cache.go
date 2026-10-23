// Package cache keeps whole product list answers for a short time. Concurrent requests for one key share one load,
// and a failed load is never stored, so the caller can fall back for that request alone.
package cache

import (
	"context"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"golang.org/x/sync/singleflight"

	"pharmacycentral/search-service/internal/lru"
)

// Options sizes a cache. Now defaults to time.Now; tests move the clock through it.
type Options struct {
	MaxEntries int
	TTL        time.Duration
	Now        func() time.Time
}

type entry[V any] struct {
	value     V
	expiresAt time.Time
}

// Cache is a TTL and LRU cache with singleflight loads. The counter pharmacy.search.cache records every lookup as
// hit (served from memory), shared (joined a load in flight) or miss (ran the loader).
type Cache[V any] struct {
	ttl     time.Duration
	now     func() time.Time
	group   singleflight.Group
	lookups metric.Int64Counter

	mu      sync.Mutex
	entries *lru.Cache[string, entry[V]]
}

// New creates a cache. The counter comes from the global meter provider, so telemetry must be set up first.
func New[V any](opts Options) *Cache[V] {
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	// The API returns a no-op instrument when creation fails, so the error carries nothing to act on.
	lookups, _ := otel.Meter("search-service").Int64Counter(
		"pharmacy.search.cache",
		metric.WithUnit("{lookup}"),
		metric.WithDescription("Product list lookups by outcome: hit (served from memory), shared (joined a load in flight), miss"),
	)
	return &Cache[V]{
		ttl:     opts.TTL,
		now:     now,
		lookups: lookups,
		entries: lru.New[string, entry[V]](opts.MaxEntries),
	}
}

// Load returns the cached value for key. Otherwise it runs load once for all concurrent callers and stores the result
// unless load failed.
func (c *Cache[V]) Load(key string, load func() (V, error)) (V, error) {
	if value, ok := c.fresh(key); ok {
		c.count("hit")
		return value, nil
	}
	outcome := "miss"
	result, err, shared := c.group.Do(key, func() (any, error) {
		// A load that finished after the check above has already stored its answer.
		if value, ok := c.fresh(key); ok {
			outcome = "hit"
			return value, nil
		}
		value, err := load()
		if err != nil {
			return nil, err
		}
		c.mu.Lock()
		c.entries.Add(key, entry[V]{value: value, expiresAt: c.now().Add(c.ttl)})
		c.mu.Unlock()
		return value, nil
	})
	if shared {
		outcome = "shared"
	}
	c.count(outcome)
	if err != nil {
		var zero V
		return zero, err
	}
	return result.(V), nil
}

func (c *Cache[V]) fresh(key string) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	cached, ok := c.entries.Get(key)
	if ok && c.now().Before(cached.expiresAt) {
		return cached.value, true
	}
	if ok {
		c.entries.Remove(key)
	}
	var zero V
	return zero, false
}

func (c *Cache[V]) count(outcome string) {
	c.lookups.Add(context.Background(), 1, metric.WithAttributes(attribute.String("outcome", outcome)))
}
