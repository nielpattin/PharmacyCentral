package cache

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

func newTestCache(clk *clock, maxEntries int) *Cache[string] {
	return New[string](Options{MaxEntries: maxEntries, TTL: 30 * time.Second, Now: clk.Now})
}

func mustLoad(t *testing.T, c *Cache[string], key string, load func() (string, error)) string {
	t.Helper()
	value, err := c.Load(key, load)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestEntriesExpireAfterTTL(t *testing.T) {
	clk := &clock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	c := newTestCache(clk, 10)
	loads := 0
	load := func() (string, error) { loads++; return "v", nil }

	mustLoad(t, c, "k", load)
	clk.now = clk.now.Add(29 * time.Second)
	mustLoad(t, c, "k", load)
	if loads != 1 {
		t.Fatalf("loads before TTL = %d, want 1", loads)
	}
	clk.now = clk.now.Add(2 * time.Second)
	mustLoad(t, c, "k", load)
	if loads != 2 {
		t.Fatalf("loads after TTL = %d, want 2", loads)
	}
}

func TestLeastRecentlyUsedEntryIsEvicted(t *testing.T) {
	clk := &clock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	c := newTestCache(clk, 2)
	loads := map[string]int{}
	loader := func(key string) func() (string, error) {
		return func() (string, error) { loads[key]++; return key, nil }
	}

	mustLoad(t, c, "a", loader("a"))
	mustLoad(t, c, "b", loader("b"))
	mustLoad(t, c, "a", loader("a"))
	mustLoad(t, c, "c", loader("c"))

	mustLoad(t, c, "a", loader("a"))
	if loads["a"] != 1 {
		t.Fatalf("a reloaded: loads = %d", loads["a"])
	}
	mustLoad(t, c, "b", loader("b"))
	if loads["b"] != 2 {
		t.Fatalf("b not evicted: loads = %d", loads["b"])
	}
}

func TestFailedLoadIsNotStored(t *testing.T) {
	clk := &clock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	c := newTestCache(clk, 10)
	if _, err := c.Load("k", func() (string, error) { return "", errors.New("boom") }); err == nil {
		t.Fatal("expected the loader error")
	}
	if got := mustLoad(t, c, "k", func() (string, error) { return "ok", nil }); got != "ok" {
		t.Fatalf("after failure got %q", got)
	}
}

func TestConcurrentLoadsShareOneLoad(t *testing.T) {
	clk := &clock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	c := newTestCache(clk, 10)
	var loads atomic.Int32
	release := make(chan struct{})
	const callers = 16
	var wg sync.WaitGroup
	errs := make(chan error, callers)
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			value, err := c.Load("k", func() (string, error) {
				loads.Add(1)
				<-release
				return "v", nil
			})
			if err == nil && value != "v" {
				err = errors.New("wrong value")
			}
			errs <- err
		}()
	}
	close(release)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Error(err)
		}
	}
	if n := loads.Load(); n != 1 {
		t.Fatalf("loader ran %d times, want 1", n)
	}
}
