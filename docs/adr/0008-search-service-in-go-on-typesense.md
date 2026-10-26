# 0008. Serve the product list from a Go search service on Typesense

Status: Accepted

Date: 2026-10-23

## Context

The product list and product search are the busiest read path of the storefront. Until commit fd01a5b (2026-10-23), `catalog-service` answered `GET /api/products` itself, running hybrid keyword and embedding search over the Typesense index it writes. The same day, commit 4c64ddf added cursor paging, a response cache, self-hosted embeddings and a `payload` field per Typesense document, and removed the N+1 unit and store lookups from the list path. Commit 114f654 records the Node baseline: 296 to 387 requests per second at 1,000 users with no think time on one vCPU, with p95 between 4.5 s and 5.4 s (see [runbook](../runbook.md), "Measured capacity of search-service").

The repository does not record why Go was chosen over Node or another language. The only recorded rationale is the measurement in commit 114f654, which compares the two on the same vCPU.

## Decision

`apps/search-service` is a Go 1.26 service on port 3009 that answers `GET /api/products` and nothing else. Every other `/api/products*` path stays on `catalog-service`. The local gateway, the AWS ALB and the release workflow each route that one path to search-service ([AGENTS.md](../../AGENTS.md), path routing map; commits fd01a5b and 4d63112).

- It owns no database and reads only Typesense, collection `catalog_products_v3` (`internal/typesense/client.go`). Each document carries the JSON that catalog-service returns for the product in a `payload` field, so the answer is joined without a SQL lookup.
- Queries of three words or more are embedded through `internal/embed`. If the embedder fails, or no embedding group is configured, the query runs on keywords only (`internal/search/search.go`).
- Answers are cached for 30 seconds, up to 5,000 entries (`internal/handler/handler.go`).
- If the Typesense search fails, times out after 2 seconds, or the collection is missing, the original request is reverse-proxied to `CATALOG_SERVICE_URL` (`internal/handler/fallback.go`). An invalid query gets a 400 and is not forwarded.
- `catalog-service` keeps owning the index. It writes the index from PostgreSQL; search-service only reads it ([.env.example](../../.env.example), Typesense comment).
- Query parsing, text folding and cursor decoding follow catalog-service's rules. Commit fd01a5b says they share a fixture, `testdata/fold-cases.json`.

## Consequences

- Measured on one vCPU with 1,000 users and no think time (114f654): 1,505 requests per second, median 183 ms, p95 3.28 s, zero failures in 219,610 requests. The p95 target of 500 ms is still not met at that load. The runbook names more replicas and a larger embedder as the next step.
- Two implementations of the list rules exist, in TypeScript and in Go. Their agreement is guarded only by the shared fixture and each side's tests.
- Every fallback request runs through catalog-service on PostgreSQL, the slower path this service exists to avoid. Each fallback logs a warning (`internal/handler/handler.go`).
- Freshness: a product change appears after the next index sweep plus up to 30 seconds of response cache ([API Guide](../api-guide.md), `GET /api/products`).
- A change to the document shape triggers a full reindex into the new collection. Until it completes, a missing collection sends requests to catalog-service ([runbook](../runbook.md), "Typesense index").
- Any change to the `GET /api/products` route has to reach the gateway, the ALB rule and the release workflow together.
- Local build, test and dev need Go 1.26 or newer on `PATH`. Docker builds need no local Go ([AGENTS.md](../../AGENTS.md), Search service section).
- Semantic search settings are held in two places: search-service's environment and catalog-service's database. See [ADR 0009](0009-ai-feature-settings-in-database.md).

## Alternatives considered

- Keep the list in catalog-service on Node. This is the state measured in commit 114f654 (296 to 387 requests per second on one vCPU).

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-SYN-006 and BR-SYN-007 (only approved synonym groups reach the index; search text normalisation).
