# 0012. Local development modes and named URLs

Status: Accepted

Date: 2026-10-08

## Context

Commit 01e90dc (2026-09-10) added the local Compose topology and an Nginx gateway (`gateway`), with the apps running as containers. Commit 97c163b (2026-10-08) added a day-to-day mode in which the apps run on the host. Its message says the host-run gateway, `gateway-dev`, uses host networking, because a container on the Compose bridge cannot reach host ports through ufw.

On `localhost`, the customer and staff apps have no stable origin of their own. Commit 067148e (2026-10-26) gave each app a portless name.

## Decision

1. Infrastructure always runs in Docker Compose. The apps run in one of two modes:
   - Dev mode: `pnpm run dev:infra` starts the infrastructure and `gateway-dev`. `pnpm dev` runs every service with `node --watch` and both webs with Vite HMR through Nx.
   - Container mode: `pnpm run aws` stops `gateway-dev`, rebuilds the images and waits until they are healthy. `pnpm run aws:down` returns to dev mode.
2. `gateway` and `gateway-dev` share `GATEWAY_PORT`, so only one of them runs. Both include `deploy/local/gateway/routes.conf`, so the path rules are written once.
3. `pnpm run urls:up` runs `tools/urls.mjs`. It starts a portless proxy on plain HTTP port 80 and aliases `customer.pharmacy.localhost` to `CUSTOMER_WEB_PORT`, `staff.pharmacy.localhost` to `STAFF_WEB_PORT`, and `api.pharmacy.localhost` to `GATEWAY_PORT`. Each name is its own browser origin. The names work the same in both modes, and browser tests use them (see [AGENTS.md](../../AGENTS.md), Browser testing).
4. Web clients call `/api/...` on the same origin. The Vite dev proxy forwards those calls to `API_BASE_URL` (see `apps/customer-web/vite.config.ts`).

## Alternatives considered

- Plain `localhost` ports (`http://localhost:5301`, `http://localhost:5302`). The README still lists them as fallback endpoints. They give the apps no stable named origin, which commit 067148e added.

## Consequences

- The two modes differ only in where the apps run. The runbook asks for container mode before a pull request, and after any change to a Dockerfile, `docker-compose.yml`, environment variables, dependencies or migrations ([runbook](../runbook.md), Two local modes).
- Switching modes requires stopping the other side first. `pnpm dev` must stop before `aws`, because the app containers publish the same host ports.
- `urls:up` fails when another program holds port 80. The named URLs are plain HTTP. HTTPS needs an extra portless step.
- Node scripts and Safari may not resolve `*.localhost`, so `API_BASE_URL` stays `http://localhost:8080` ([runbook](../runbook.md)).
- Docker Desktop needs host networking enabled for `gateway-dev` to work.
- The web servers use `strictPort`. A busy port stops the app instead of moving it, because the named URL alias points at a fixed port.
