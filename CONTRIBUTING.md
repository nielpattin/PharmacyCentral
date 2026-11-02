# Contributing to Pharmacy Central

This file explains how a change moves from a branch to `main`. The project rules for code, architecture, configuration, and AI agents live in [AGENTS.md](AGENTS.md). This file links to them instead of repeating them.

## Setup

- Prerequisites, dependency install, and the local stack: [README.md](README.md#prerequisites) and [README.md](README.md#local-development).
- Migrations, the default seed (one admin), and the demo dataset: [README.md](README.md#migrations-and-seeds) and [docs/runbook.md](docs/runbook.md).
- Browser testing and named local URLs: [AGENTS.md](AGENTS.md#browser-testing).

## Branches

- `main` is the only long-lived branch. Branch from an up-to-date `main` and open the pull request against `main`.
- The repository does not enforce a branch-name pattern. Use a short lowercase name that describes the change.
- Keep each pull request to one change. Edits stay surgical, as [AGENTS.md](AGENTS.md#non-negotiable-rules) requires.

## Commit messages

Commits follow Conventional Commits, as the history on `main` does:

```text
feat(customer-web): one /don-hang page with Đặt hàng and Đơn của tôi tabs
```

- **Type**: one of `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `chore`, or `build`.
- **Scope**: the app, service, package, or area the change touches, for example `customer-web`, `payment-service`, `ui`, `dev`, or `data`. When two scopes are touched, list both, separated by a comma, as in `fix(customer-web,catalog-service)`.
- **Subject**: imperative mood, lowercase after the colon, no trailing period.
- **Body** (optional): wrap at about 72 columns and explain why the change was made.

## Pull requests and review

- Fill in every section of the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).
- Every file is owned by `@nielpattin` ([.github/CODEOWNERS](.github/CODEOWNERS)). Code owner review applies to every pull request.
- The `Workspace validation` workflow ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on pull requests to `main`. It must pass before merge. It checks formatting and TypeScript project references, runs lint, typecheck, test, and build for affected projects, and runs `docker compose config --quiet`.
- Run the verification commands below locally before you request review.

## Verification

The commands below are listed in [AGENTS.md](AGENTS.md#verification-workflow), which is the source. Run all of them before you finish a change:

```bash
pnpm run fmt:check
pnpm run sync:check
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm test
git diff --check
```

For Docker validation:

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

Do not claim container validation passed until `docker compose ps` shows the containers healthy. Report in the pull request which checks you ran and which you did not.

## Where documentation goes

- **Product spec for pages and features**: when you add or change a page or a user-facing feature, write or update its spec in [docs/product/](docs/product/README.md) in the same pull request: what it contains, for whom, and why. Tag what is the owner's word and what is only observed from code.
- **Design doc before big work**: write it in [docs/design/](docs/design/README.md) before you start a large or cross-service change. Start from [docs/design/0000-template.md](docs/design/0000-template.md).
- **Decision records**: after a decision is made, record it in [docs/adr/](docs/adr/README.md).
- **Changelog**: add an entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for every user-visible or permanent change.
- **Business rules**: a new or changed rule of product behavior goes into [docs/business-rules.md](docs/business-rules.md) in the same pull request, under a stable `BR-*` ID (section 25 of that file). Record a gap there too when the server does not enforce a rule.
- **Docs live next to code**: update the matching document in the same pull request. The API contract is in [docs/api-guide.md](docs/api-guide.md), user-facing behavior in [docs/user-guide.md](docs/user-guide.md), operations in [docs/runbook.md](docs/runbook.md), and architecture diagrams in [docs/diagrams/README.md](docs/diagrams/README.md).

## Rules that matter

Read these sections of [AGENTS.md](AGENTS.md) before you change code. They are not repeated here:

- [Non-negotiable rules](AGENTS.md#non-negotiable-rules)
- [Architecture and service boundaries](AGENTS.md#architecture-and-service-boundaries), including how identity is carried by the bearer JWT
- [Configuration and environment variables](AGENTS.md#configuration-and-environment-variables)
- [Frontend guidelines](AGENTS.md#frontend-guidelines)

## AI-assisted contributions

- **Disclose AI-written code.** Say in the pull request which parts were written with AI assistance. The [pull request template](.github/PULL_REQUEST_TEMPLATE.md) has a section for this.
- **The author owns the change.** Read every line an agent wrote, and run the verification commands yourself before you ask for review.
- **Agents follow AGENTS.md.** Agents must not commit, push, or mutate Git history unless the author explicitly asks. See [AGENTS.md](AGENTS.md#non-negotiable-rules).
- **Keep secrets and customer data out of prompts.** Do not paste `.env` values, API keys, tokens, passwords, or real customer records. Use the committed sample data in `data/` and the demo accounts described in [docs/runbook.md](docs/runbook.md).

Security problems are not reported through issues or pull requests. See [SECURITY.md](SECURITY.md).
