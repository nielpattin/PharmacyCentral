import { metrics } from "@opentelemetry/api";

import type { TextEmbedderSource } from "./text-embedder.ts";

// A 384-dimension vector is about 3 KB as a JavaScript array, so 5,000 of them are about 15 MB.
const DEFAULT_MAX_ENTRIES = 5000;

const lookups = metrics.getMeter("catalog-service").createCounter("pharmacy.search.embedding_cache", {
  unit: "{lookup}",
  description: "Query vector lookups by outcome: hit (no embedder call) or miss (one embedder call)",
});

/**
 * Remembers the most recent query vectors, so a repeated search skips the embedding call. A self-hosted model costs
 * a few hundred milliseconds per query on a small CPU, and shoppers repeat the same few words. The key includes the
 * model, so switching models never reuses a vector from the old one. Documents are never cached.
 */
export const withQueryEmbeddingCache = (
  source: TextEmbedderSource,
  maxEntries = DEFAULT_MAX_ENTRIES,
): TextEmbedderSource => {
  const cache = new Map<string, number[]>();
  return async () => {
    const embedder = await source();
    if (!embedder) return undefined;
    return {
      model: embedder.model,
      maxVectorDistance: embedder.maxVectorDistance,
      embedDocuments: (texts) => embedder.embedDocuments(texts),
      embedQuery: async (text) => {
        const key = `${embedder.model}\u0000${text}`;
        const hit = cache.get(key);
        if (hit) {
          // Map keeps insertion order, so re-inserting marks the entry as the most recently used.
          cache.delete(key);
          cache.set(key, hit);
          lookups.add(1, { outcome: "hit" });
          return hit;
        }
        lookups.add(1, { outcome: "miss" });
        const vector = await embedder.embedQuery(text);
        cache.set(key, vector);
        const oldest = cache.keys().next().value;
        if (cache.size > maxEntries && oldest !== undefined) cache.delete(oldest);
        return vector;
      },
    };
  };
};
