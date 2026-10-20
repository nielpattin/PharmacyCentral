# Pharmacy Central dependency baseline

This document defines the accepted runtime, package, and infrastructure version constraints across the repository. Refresh this baseline only through an explicit dependency decision.

## Runtime and package manager

| Component      | Accepted version or constraint                     | Evidence and dependency decision                                                                                                                                                                 |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js        | `24.19.0` LTS; engines `>=24.16.0 <25`             | Node 24 is the supported runtime for local development, CI, Docker, and production. Node 24 is Active LTS and reaches EOL on 2028-04-30.                                                         |
| pnpm           | `12.3.4`; policy `>=12.3.4 <13`                  | `pnpm --version` reports 12.3.4+ in the environment. Bootstrap explicitly because Corepack state is not assumed.                                                                              |
| TypeScript 7   | `@typescript/native`: `npm:typescript@^7.0.2`      | `@typescript/native` is an alias name, not a registry package. A direct registry lookup for `@typescript/native` returning 404 is expected. Nx's official side-by-side guide defines this alias. |
| TypeScript API | `typescript`: `npm:@typescript/typescript6@^6.0.2` | TypeScript 6.0.2 supplies the programmatic API required by Nx/Vite and exposes `tsc6`; TypeScript 7 supplies the `tsc` executable.                                                               |

Workspace installation and verification must run under Node 24.19.x.

## Application packages

All versions below were queried from the npm registry with pnpm. Application packages use exact catalog entries.

| Package                | Accepted version | Peer/engine result                                                                                                             |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `nx`, `@nx/js`         | `23.1.1`         | TypeScript 6 API alias is required by the Nx TypeScript plugin.                                                                |
| `express`              | `5.2.1`          | Requires Node `>=18`; Node 24 satisfies it.                                                                                    |
| `@types/express`       | `5.0.6`          | No peer constraint returned.                                                                                                   |
| `drizzle-orm`          | `0.45.2`         | PostgreSQL peer `>=8`; `pg` 8.23.0 satisfies it.                                                                               |
| `drizzle-kit`          | `0.31.10`        | No blocking peer constraint returned.                                                                                          |
| `pg`                   | `8.23.0`         | Requires Node `>=16`; Node 24 satisfies it.                                                                                    |
| `zod`                  | `4.4.3`          | Contract runtime.                                                                                                              |
| `zod-openapi`          | `6.0.1`          | Requires Node `>=22.14.0` and Zod `^4.0.0`; selected versions satisfy both.                                                    |
| `pino`                 | `10.3.1`         | Structured application logging.                                                                                                |
| `amqplib`              | `2.0.1`          | Requires Node `>=18`; Node 24 satisfies it.                                                                                    |
| `ioredis`              | `6.0.0`          | Redis client for the sales-service delivery cache and rate limiter; pure JavaScript, so it runs on Windows.                    |
| `openid-client`        | `6.8.7`          | Google authorization-code flow with PKCE, state, and nonce.                                                                    |
| `resend`               | `6.21.0`         | Official Resend Node SDK. The package is `resend`, not `@resend/node`.                                                         |
| `nodemailer`           | `9.0.5`          | Local Mailpit adapter.                                                                                                         |
| `react`, `react-dom`   | `19.2.8`         | Same versions in both web applications.                                                                                        |
| `vite`                 | `8.2.2`          | Requires Node `^20.19.0 \| >=22.12.0`; Node 24 satisfies it.                                                                   |
| `vitest`               | `4.1.11`         | Requires Node `^20.0.0 \| ^22.0.0 \| >=24.0.0`; Node 24 satisfies it.                                                          |
| `@types/node`          | `24.13.3`        | Keep Node declarations on the 24 line. Do not use the registry latest 26.x package in this Node 24-only project.               |
| `@vitejs/plugin-react` | `6.1.0`          | React/Vite integration.                                                                                                        |
| `@vietmap/vietmap-gl-js` | `6.0.1`        | Browser map renderer. Vietmap tiles are not standard MVT, so stock `maplibre-gl` cannot parse them. Registry `latest` is a 7.x pre-release; stay on 6.0.1. |
| `oxlint`               | `1.79.0`         | Local project linter.                                                                                                          |
| `oxlint-tsgolint`      | `7.0.2001`       | Type-aware Oxlint integration.                                                                                                 |
| `oxfmt`                | `0.64.0`         | Formatter across workspace and projects.                                                                                       |

## Infrastructure support windows

| Component                       | Accepted baseline | Support check                                                                                                                      |
| ------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL                      | `18.4`            | PostgreSQL 18 community support ends 2030-11-14.                                                                                   |
| PostGIS                         | `3.6.2`           | CloudNativePG documents PostGIS 3.6.2 with PostgreSQL 18.4.                                                                        |
| RabbitMQ                        | `4.3.5`           | RabbitMQ 4.3 community support ends 2026-11-30.                                                                                    |
| RabbitMQ Cluster Operator       | `2.22.3`          | Latest 2.22 patch. Requires RabbitMQ 4.2.4+ or 4.3.0+ for its HTTP startup probe.                                                   |
| Redis                           | `8.10.2`          | Current stable Redis 8 line. Used for non-authoritative rate counters and delivery cache.                                          |
| Kubernetes                      | `1.36.2`          | Actively supported. EOL 2027-06-28.                                                                                                |
| CloudNativePG                   | `1.30.0`          | Supports Kubernetes 1.34 through 1.36 and PostgreSQL 14 through 18.                                                                |
| OpenTelemetry Collector Contrib | `0.159.0`         | Pinned collector image for application telemetry traces and metrics.                                                               |
| Mailpit                         | `v1.30.7`         | Stable tagged local development image.                                                                                             |

## Container image index digests

Multi-platform OCI index digests checked with `docker buildx imagetools inspect`:

| Image                         | Accepted reference                                         | OCI index digest                                                            |
| ----------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Node build/runtime            | `docker.io/library/node:24.19.0-bookworm-slim`             | `sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03`   |
| Nginx web runtime             | `docker.io/library/nginx:1.27-alpine`                      | `sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`   |
| Local PostgreSQL/PostGIS      | `docker.io/postgis/postgis:18-3.6`                         | `sha256:db8c151a4e1f4686b1a985a3490cf96f9f8c8c2725f58a46ef7a57e52f167cc3`   |
| Production PostgreSQL operand | `ghcr.io/cloudnative-pg/postgresql:18.4-minimal-trixie`    | `sha256:2cf8d1c297265331b8a81aefe5b7b397ddbb836e15eaa953543f6190e8dabf98`   |
| Production PostGIS extension  | `ghcr.io/cloudnative-pg/postgis-extension:3.6.2-18-trixie` | `sha256:93584892e25a57e47e988b0f80ad9988035d1396d4a87824307eddf2242348c8`   |
| Local RabbitMQ                | `docker.io/library/rabbitmq:4.3.5-management`              | `sha256:397fde82bc04522d88680b57cbf5d70caae715a76c957404e52e3f0fa056b8f3`   |
| Redis                         | `docker.io/library/redis:8.10.2-alpine`                    | `sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0`   |
| Mailpit                       | `docker.io/axllent/mailpit:v1.30.7`                        | `sha256:d5ecbb067db3705fa953d79e1b7f81ef84038df67aba6c52825d8c02a1ea748a`   |
| OTLP collector                | `docker.io/otel/opentelemetry-collector-contrib:0.159.0`   | `sha256:1f2c54a30e713fac6b3ae77a1ec84010c2007e29ced8ec666214fc2f6739c1cc`   |
| RabbitMQ Cluster Operator     | `ghcr.io/rabbitmq/cluster-operator:2.22.3`                 | `sha256:d0fb3cf372285ba76b0b1051751991a497b6c23d9bbf067533a4add894ac7a2c`   |

The Compose file uses the exact tag plus digest for local infrastructure. Production application images are built by CI and referenced by their pushed content digest.
