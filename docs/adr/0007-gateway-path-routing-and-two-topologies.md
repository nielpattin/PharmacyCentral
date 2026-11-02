# 0007. One path-routing map for the local gateway and AWS, in two topologies

Status: Accepted

Date: 2026-10-08

## Context

Browsers call `/api/...` and never reach a service directly. Locally, an Nginx gateway routes those calls. In AWS, an API Gateway HTTP API, a VPC Link, and an internal Application Load Balancer route them. The local rules were first written inline in `deploy/local/gateway/nginx.conf` (`01e90dc`, 2026-09-10), and the AWS rules in `deploy/aws/main.tf` `path_rules` (`121a585`, 2026-09-10). Commit `97c163b` (2026-10-08) moved the local rules into `deploy/local/gateway/routes.conf` so that "path rules live in one file". Later additions: `GET /api/products` to search-service (`fd01a5b`, 2026-10-23) and `/api/system` to ops-console-service (`21c4d0b`, 2026-10-24). The rules are listed in [AGENTS.md](../../AGENTS.md) (path routing map) and [runbook.md](../runbook.md).

## Decision

- `routes.conf` is included by `nginx.conf` (the `gateway` container, which forwards to app containers) and by `nginx.dev.conf.template` (`gateway-dev`, which forwards to `pnpm dev` processes on `127.0.0.1:${<SVC>_PORT}`). Both listen on `GATEWAY_PORT`, so only one runs at a time (`docker-compose.yml`).
- The AWS side is the `path_rules` map in `deploy/aws/main.tf` (ALB listener rules at priorities 10 to 90), plus an exact `GET /products` rule at priority 15 that sends that request to search-service. Priority 20 keeps every other `/products*` path on catalog-service.
- The `/api` prefix is stripped at both edges: nginx with `rewrite ^/api/(.*)$ /$1 break`, and API Gateway with `overwrite:path = /$request.path.proxy`.
- Both topologies run the same service images, built from the same Dockerfiles (`apps/Dockerfile.service`, `apps/search-service/Dockerfile`). Compose builds them from source. AWS takes digest-pinned references (`var.images`, validated for `@sha256:`) that `.github/workflows/release.yml` pushes to GHCR.
- Unmatched paths get a JSON 404 from both edges (`location /` in `routes.conf`; the ALB fixed-response default action).

## Consequences

- A new prefix means editing `routes.conf`, `path_rules` in `main.tf`, and the constant in `apps/ops-console-service/src/modules/system/route-table.ts`. The route-table test compares the prefixes and exact rules of `routes.conf` and the ALB, [observed]
- The edges differ on body limits. `routes.conf` sets 25 MB and 10 MB (prescription intake) limits per location, and `deploy/aws/main.tf` sets no body-size value for the ALB. [observed]
- Neither edge authenticates or checks roles. Both forward `Authorization` untouched and the services verify the access token. Those rules are covered in [0005](0005-jwt-only-authentication-no-sessions-or-csrf.md) and [0006](0006-jwt-access-tokens-verified-by-every-service.md).
- The local gateways are development-only, and AWS is configuration only: no AWS resources were deployed (README.md). The AWS path table has not been exercised against a live environment.

## Alternatives considered

- `host.docker.internal` upstreams for `gateway-dev` were rejected. Under ufw a container on the Compose bridge cannot reach host ports, so every route answered 504. `gateway-dev` uses host networking instead (comment in `docker-compose.yml`; commit `97c163b`).
