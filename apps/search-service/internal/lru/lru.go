// Package lru is a fixed-size least-recently-used map. It is not safe for concurrent use; callers lock around it.
package lru

import "container/list"

type Cache[K comparable, V any] struct {
	max   int
	order *list.List
	items map[K]*list.Element
}

type item[K comparable, V any] struct {
	key   K
	value V
}

func New[K comparable, V any](maxEntries int) *Cache[K, V] {
	return &Cache[K, V]{max: maxEntries, order: list.New(), items: make(map[K]*list.Element)}
}

// Get returns the value stored under key and marks it most recently used.
func (c *Cache[K, V]) Get(key K) (V, bool) {
	el, ok := c.items[key]
	if !ok {
		var zero V
		return zero, false
	}
	c.order.MoveToFront(el)
	return el.Value.(*item[K, V]).value, true
}

// Add stores value under key and evicts the least recently used entry when the cache is over its size.
func (c *Cache[K, V]) Add(key K, value V) {
	if el, ok := c.items[key]; ok {
		el.Value.(*item[K, V]).value = value
		c.order.MoveToFront(el)
		return
	}
	c.items[key] = c.order.PushFront(&item[K, V]{key: key, value: value})
	if c.order.Len() > c.max {
		oldest := c.order.Back()
		c.order.Remove(oldest)
		delete(c.items, oldest.Value.(*item[K, V]).key)
	}
}

func (c *Cache[K, V]) Remove(key K) {
	if el, ok := c.items[key]; ok {
		c.order.Remove(el)
		delete(c.items, key)
	}
}
