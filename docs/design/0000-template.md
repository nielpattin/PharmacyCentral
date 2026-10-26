# NNNN. Feature title

<!-- Copy this file to docs/design/NNNN-feature-name.md and fill in every section. Delete the comments when done. -->

- **Status:** Draft
- **Author:** @github-handle
- **Date:** YYYY-MM-DD

## Summary

<!-- Two to four sentences: what changes, for whom, and which services are affected. -->

## Motivation

<!-- The problem, with evidence from the code, the runbook, or the business rules. Link to them. -->

## Goals

- <!-- A measurable outcome or behavior the change must deliver. -->

## Non-goals

- <!-- What this change deliberately does not do, so reviewers do not expect it. -->

## Proposed design

<!-- Describe the change. Name every service, route, table, and event. Follow the data ownership rules in
docs/architecture.md: each service owns its own schema and outbox, and no service reads another's database. -->

### Contracts

<!-- HTTP routes (method, path, request, response, errors) and transport contracts under src/contracts/.
State the path routing map entry if a new route prefix is added (see AGENTS.md). Link to docs/api-guide.md for
the existing contract that changes. -->

### Data model

<!-- New or changed tables and columns per service, the migration, and the owning service role. -->

### Events

<!-- Integration events on pharmacy.events: routing key, version (.v1), payload, producer, consumers, queue names,
and what happens on failure (retry, .dead queue). Describe the outbox row if the event is published. -->

### Security and CSRF

<!-- Who may call the change, how the caller is authenticated and authorized, site scope, CSRF for browser mutations,
and any new secret or external credential. -->

### Observability

<!-- Traces, metrics, and logs added, and the dashboard or alert that uses them. See docs/runbook.md#observability. -->

## Alternatives considered

- <!-- Option, why it was rejected. -->

## Rollout and migration

<!-- Order of deployment across services, feature flags if any, data backfill, rollback plan, and removal of
obsolete code. Name the migrations and their order. -->

## Testing

<!-- Unit, integration, and browser tests, and the load or chaos scenarios that apply. -->

## Open questions

- <!-- Question, and who will answer it. -->

## Related ADRs

<!-- Link each ADR that this design relies on or that it will produce. See docs/adr/README.md. -->

- None yet.
