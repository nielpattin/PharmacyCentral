# 0001. Record architecture decisions

Status: Accepted

Date: 2026-10-26

## Context

Pharmacy Central has many decisions that shape its code: the service boundaries, the data ownership rules, the
transactional outbox, the path routing map, and the two deployment topologies. Some of them are written down in
[AGENTS.md](../../AGENTS.md) as rules, but the reasons behind them are scattered across commit messages, chat
threads, and code comments. The rules alone do not explain when a rule may change or what it was traded against.

Large changes also start without a shared written plan, so reviewers see the code before they see the intent.

## Decision

We record architecture decisions as ADRs in `docs/adr`, one file per decision, numbered in order and written in
the format of this record. The rules for writing them are in [docs/adr/README.md](README.md).

We write a design document in `docs/design` before big work, as described in [docs/design/README.md](../design/README.md).
The design document describes the proposal, and the ADR records the decision once it is made.

The non-negotiable rules stay in [AGENTS.md](../../AGENTS.md). An ADR explains the reason behind a rule and links to
the rule instead of copying it.

## Consequences

- Decisions have a durable home that reviewers and future contributors can find and link to.
- Changing a decision means writing a new ADR and marking the old one as superseded, which keeps the history visible.
- Writing an ADR costs a short amount of time per significant decision. The format keeps that cost low.
- The index in `docs/adr/README.md` must be updated in the same change that adds an ADR.
