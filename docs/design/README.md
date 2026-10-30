# Design documents

A design document describes a proposed change before the work starts: the problem, the goals, the proposed
contracts and data, the alternatives that were rejected, and how the change reaches production. It gives reviewers
a chance to disagree while disagreeing is still cheap.

Use the [template](0000-template.md) and copy it to a new file. Decisions that a design settles, and that will
outlive the feature, are recorded afterwards as ADRs (see [docs/adr/README.md](../adr/README.md)).

## When a design document is required

Write one before starting when the change does any of the following:

- adds a new service
- adds or changes an integration event contract on `pharmacy.events`
- changes a schema that touches more than one service, or moves data between services
- adds a new external dependency, such as a third-party API, a broker, a store, or a hosted service

Small changes inside one service do not need a design document. The rules for the code itself are in
[AGENTS.md](../../AGENTS.md), and the contribution process is in [CONTRIBUTING.md](../../CONTRIBUTING.md).

A design document says how to build something. It is not where a page or user-facing feature is defined: what the
page contains, for whom, and why belongs in a [product spec](../product/README.md).

## Naming

- File name: `NNNN-feature-name.md`, where `NNNN` is the next free four-digit number, starting at `0001`.
  `0000-template.md` is the template and is never used for a feature.
- Use kebab-case for the feature name, for example `0003-order-cancellation.md`.
- Numbers are never reused.

## Lifecycle

| Status | Meaning |
| --- | --- |
| Draft | The author is still writing. The document may be incomplete. |
| In review | The document is in a pull request and open for comments. |
| Accepted | The design is approved and the work may start. |
| Implemented | The change has shipped. Link the pull requests or releases that delivered it. |
| Abandoned | The change will not be built. Keep the file and say why. |

## Review flow

1. Open a pull request that adds the design document with status `Draft`, and set the status to `In review` when
   the author is ready for comments. The pull request uses the
   [pull request template](../../.github/PULL_REQUEST_TEMPLATE.md).
2. [CODEOWNERS](../../.github/CODEOWNERS) assigns the owners of the repository as reviewers automatically. They
   review the design, not only the code that follows from it.
3. Resolve the open questions in the document, or move them into the open questions section with an owner.
4. When the design is approved, merge the pull request with the status `Accepted`. Update the status to
   `Implemented` or `Abandoned` in the pull request that completes or drops the work.

## Index

| Number | Title | Status | Author | Date |
| --- | --- | --- | --- | --- |
| [0001](0001-operations-query-reads-only-events.md) | Operations query reads only through events | Draft | TBD (unclaimed) | 2026-10-26 |
| [0002](0002-close-fail-fast-configuration-gaps.md) | Close the fail-fast configuration gaps | Draft | TBD (unclaimed) | 2026-10-26 |
| [0003](0003-harden-guest-cart-cookie-and-trusted-headers.md) | Harden the guest cart cookie and edge identity headers | Implemented | TBD (unclaimed) | 2026-10-26 |
| [0004](0004-order-from-selected-cart-lines.md) | Order from the selected cart lines on the server | Implemented | TBD (unclaimed) | 2026-10-26 |
| [0005](0005-client-only-guest-cart.md) | Keep the signed-out cart in the browser only | Implemented | TBD (unclaimed) | 2026-10-26 |
| [0008](0008-disposal-records.md) | Disposal records for expired, damaged and recalled stock | Implemented | @nielpattin | 2026-10-30 |
| [0009](0009-analytics-tabbed-workspace.md) | The analytics workspace reads one tab at a time | Implemented | @nielpattin | 2026-10-30 |
