# Architecture Decision Records

An architecture decision record (ADR) is a short document that captures one significant decision, the context
that forced it, and its consequences. ADRs answer "why is it like this?" months after the fact, when the people
who made the call are no longer in the conversation.

We use the lightweight format from Michael Nygard's article
[Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
Each ADR has a Status, a Date, Context, Decision, and Consequences. An ADR may add Alternatives considered and Related business rules, which links the `BR-*` rules in [business-rules.md](../business-rules.md) that implement the decision.

## When to write an ADR

Write an ADR when a decision is hard to reverse or affects more than one service, and when the team would
otherwise have to rediscover the reason. Examples:

- choosing or replacing a technology, for example a broker, a database, or a search engine
- a rule about boundaries between services, data ownership, or the event model
- a deployment or security decision that constrains future work

Do not write an ADR for routine implementation choices, for bug fixes, or for decisions that only affect one
module and can be explained in its code.

## ADR or design document?

The two records answer different questions, and both live in `docs/`.

| | Design document ([docs/design](../design/README.md)) | ADR (this folder) |
| --- | --- | --- |
| Question | How will we build this feature? | Why did we decide this? |
| When | Before the big work starts | After the decision is made |
| Length | As long as the design needs | One page |
| Lifecycle | Draft, In review, Accepted, Implemented, Abandoned | Proposed, Accepted, Superseded |

A large feature usually starts with a design document. Any decision that the design settles and that will
outlive the feature becomes an ADR. The design document links to the ADRs it relies on.

## Status values

- **Proposed:** written and under discussion, not yet binding.
- **Accepted:** the decision is in force.
- **Superseded by NNNN:** a later ADR replaces this one. Keep the file and link to the replacement. Do not delete it.

## Naming and numbering

- File name: `NNNN-kebab-case-title.md`, where `NNNN` is the next free four-digit number, starting at `0001`.
- Numbers are never reused. A superseded ADR keeps its number.
- Use the title as the first line: `# NNNN. Title`.

## Index

| Number | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-record-decisions.md) | Record architecture decisions | Accepted | 2026-10-26 |
| [0002](0002-service-owned-databases.md) | Service-owned databases | Accepted | 2026-09-10 |
| [0003](0003-transactional-outbox-and-integration-events.md) | Transactional outbox and integration events | Accepted | 2026-09-10 |
| [0004](0004-server-authoritative-pricing-stock-and-fees.md) | Server-authoritative pricing, stock and fees | Accepted | 2026-09-10 |
| [0005](0005-opaque-sessions-and-csrf.md) | Opaque browser sessions and CSRF protection | Accepted | 2026-09-10 |
| [0006](0006-edge-identity-context.md) | Edge-verified identity context forwarded to services | Accepted | 2026-09-10 |
| [0007](0007-gateway-path-routing-and-two-topologies.md) | One path-routing map for the local gateway and AWS, in two topologies | Accepted | 2026-10-08 |
| [0008](0008-search-service-in-go-on-typesense.md) | Serve the product list from a Go search service on Typesense | Accepted | 2026-10-23 |
| [0009](0009-ai-feature-settings-in-database.md) | Store AI feature settings in the owning service's database | Accepted | 2026-10-20 |
| [0010](0010-fail-fast-environment-configuration.md) | Fail fast on missing configuration and never default it in code | Accepted | 2026-09-10 |
| [0011](0011-shared-ui-package-and-react-conventions.md) | Shared UI package and React conventions | Accepted | 2026-09-10 |
| [0012](0012-local-development-modes-and-named-urls.md) | Local development modes and named URLs | Accepted | 2026-10-08 |
| [0013](0013-observability-and-system-console.md) | Observability and the System console | Accepted | 2026-10-21 |
| [0014](0014-signed-out-cart-in-the-browser.md) | Keep the signed-out cart in the browser | Accepted | 2026-10-26 |
| [0015](0015-server-picks-the-cart-lines-of-an-order.md) | The server picks the cart lines of an order | Accepted | 2026-10-26 |
| [0016](0016-prescription-only-products-are-not-sold-online.md) | Prescription-only products are not put in the cart or sold online | Accepted | 2026-10-26 |
| [0017](0017-roles-checked-at-the-edge-and-in-each-service.md) | Roles are checked at the edge and in every service | Accepted | 2026-10-26 |
| [0018](0018-default-seed-and-demo-seed-are-separate.md) | The default seed and the demo seed are separate | Accepted | 2026-10-28 |
| [0019](0019-platform-admin-reads-and-administers.md) | Platform Admin reads and administers, and works nothing else | Accepted | 2026-10-30 |
| [0020](0020-interactions-have-physical-weight.md) | Interactions carry physical weight | Accepted | 2026-10-30 |
