# Pharmacy Central project summary

Pharmacy Central is a Node.js 24 and TypeScript monorepo with an AWS API Gateway + VPC Link + internal Application Load Balancer edge routing topology (configuration-only under `deploy/aws`, no resources deployed), six independently deployable Express 5 backend services running on ECS Fargate, two React/Vite web applications, Drizzle/PostgreSQL/PostGIS persistence, RabbitMQ integration events, Valkey operational caching, and service-local logging.

The system handles customer commerce and internal pharmacy operations: customer registration, guest and authenticated carts, customer-selected store delivery, provider-resolved addresses, route snapshots, distance-based delivery fees with a free zone and a delivery radius, and staff pharmacy operations (prescriptions, inventory, procurement, quality, transfers, stocktakes, reporting). Each service owns its database and emits versioned events through transactional outbox and inbox boundaries.

Key implementation technologies: Nx, pnpm 12, Zod contracts, native Argon2id, `openid-client` Google PKCE, MapLibre, OpenFreeMap, OpenRouteService, Vitest, Oxlint, Oxfmt, AWS API Gateway, ECS Fargate, RabbitMQ, Valkey, and GHCR digest-addressed container images.
