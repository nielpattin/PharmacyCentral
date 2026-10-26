# Pharmacy Central verification map

This directory maps the user-facing features of the customer shop (`customer-web`, `http://customer.pharmacy.localhost`) and the staff portal (`staff-web`, `http://staff.pharmacy.localhost`). Read [SKILL.md](../SKILL.md) for the two modes, doctor, cleanup, and evidence rules first. Then open the matching feature file and follow its steps.

## Modes

Ask the user which mode to use at the start of the session. Never assume it. Pass the answer to every helper as `--mode dev` or `--mode container`.

- **Dev mode** (`--mode dev`): infra in Docker (`pnpm run infra:up`), apps on the host through Nx. The skill may start the Nx targets it needs with `launch.mjs --need <names>` and stops exactly what it started with `stop.mjs`.
- **Container mode** (`--mode container`): everything in Docker (`pnpm run stack:up`), closest to AWS. The skill starts and stops nothing. It only checks (`doctor.mjs --mode container`) and drives.

Each feature file names the launch step for dev mode and the single `stack:up` step for container mode.

## Baseline preconditions

- Dev mode: `pnpm run infra:up` and `launch.mjs --need <names>`. Container mode: `pnpm run stack:up` and every container in `docker compose ps` healthy. Both modes: `pnpm run urls:up` once per session for the named URLs.
- The migrations and demo accounts exist: `pnpm run db:migrate` and `pnpm run dev:data`. The doctor checks the admin account by default, or the `--email` you pass.
- Dev mode: `.tmp/verify/current` names the run, or pass `--run <id>` to every helper. Container mode: the drive snippet creates `container-<YYYYMMDD-HHMMSS>`.
- Browser work uses the browser tool's default browser at 1920x1080, with `browser.open({ name, url, viewport, app: { tern: false, relay: false } })`. Signed-in roles are saved state files at `~/.omp/browser-profiles/<role>.json`. Read `xd://eval/browser` before first use.

## AI gate

These services can call a paid AI provider. Each feature file that needs one is marked. Start them only with the user's explicit approval for that run. Dev mode enforces it with `launch.mjs --ai-approved`. In container mode the approval is the user's recorded go-ahead before `pnpm run stack:up`, because the catalog sweep runs when its container starts.

| Service | Where AI runs |
| --- | --- |
| `catalog-service` | Startup calls `searchIndexer.requestSweep()`, which embeds product text. Each storefront search with a term embeds the query. |
| `chatbot-service` | Each shopper question calls the chat model (Gemini). Product lookup tools call the catalog. |
| `sales-service` | Prescription photo reading calls the vision model. The proof run does not start it. |

UI-only checks of the chatbot widget may stub `/api/chatbot/*` in the browser. Label such a proof as UI-only. It proves no model behavior.

## Features

| Feature | File | Services | AI | Status |
| --- | --- | --- | --- | --- |
| Staff sign-in and session | [staff-sign-in.md](./staff-sign-in.md) | identity-service, staff-web | No | Mapped, not yet re-driven under the new rules |
| Customer sign-in and account | [customer-sign-in-account.md](./customer-sign-in-account.md) | identity-service, sales-service, customer-web | No | Mapped, not yet re-driven under the new rules |
| Storefront search and product detail | [storefront-search.md](./storefront-search.md) | catalog-service, customer-web | Yes, gated | Mapped, not yet re-driven under the new rules |
| Cart and checkout | [cart-and-checkout.md](./cart-and-checkout.md) | identity, catalog, inventory, sales, payment, customer-web | Yes, gated | Mapped, not yet re-driven under the new rules |
| Shopping assistant widget | [shopping-assistant.md](./shopping-assistant.md) | identity, chatbot-service, customer-web | Yes, gated | Mapped, not yet re-driven under the new rules |
| Event delivery between services | [event-delivery.md](./event-delivery.md) | none (infra only, scratch vhost and databases) | No | Helper is mode independent; not yet re-run under this workflow |
| Online order stock and invoice pricing | [order-stock.md](./order-stock.md) | none (inventory, sales and payment started by the helper) | No | Helper is mode independent; not yet re-run under this workflow |

Areas without a feature file yet: staff data import, staff AI integrations, staff orders and prescriptions, operations dashboards. Add a file here before a run depends on them.

## Reachability

- Dev mode: a `pnpm dev` stack that is already running, or any other listener, holds the app ports. The doctor reports those ports as `foreign`, `launch.mjs` refuses, and every feature that needs a browser stays `verified-unreachable` until that stack is stopped. `event-delivery.md` and `order-stock.md` do not depend on the app ports.
- Container mode: the containers hold the ports. The skill does not stop them. If a container is unhealthy or `urls:up` is missing, the doctor reports it and the feature is `verified-unreachable` until the stack is fixed.

## Feature entry contract

Each feature file starts with an H1 and one paragraph. It then uses four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with the browser global`, and `Gotchas`. The driving section starts with `Preconditions:` and lists each user action with its exact handle and the observable result.

## Proof and skip reporting

- Record the feature ID, the mode, and the entry point with every artifact.
- Capture the action and the resulting state, not only the last screen.
- Verify side effects in the database or the saved state file. A visible state alone is not proof of a write.
- An unreachable path is reported with the command tried and the unmet precondition. Never report a skipped entry point as verified through another path.
