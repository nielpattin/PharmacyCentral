# Pharmacy Central Architecture

## Purpose
This document defines the target architecture for Pharmacy Central.
It is aligned with `docs/Research.md` and `docs/ProjectInfo.md`.

Diagram files:
- `docs/production-architecture.drawio`
- `docs/request-flow.drawio`
- `docs/deployment-flow.drawio`

## Architecture Summary
Pharmacy Central is an internal-only enterprise web platform for operating a pharmacy chain.
The selected architecture is a **modular monolith** with a React frontend and an ASP.NET Core backend.
The system is deployed to the cloud in **containers**, uses **PostgreSQL** as the single OLTP system of record, and scales horizontally by running multiple backend instances behind a reverse proxy or ingress.

Current locked assumptions from research:
- multi-country baseline with local compliance overlays per country
- 2500+ stores in the target business shape
- design target of 5000+ peak concurrent users
- cloud deployment
- containers as the runtime model
- local user/password authentication managed by the app
- manual prescription entry inside the app
- no EHR or clinic integration in the baseline
- no cold-chain scope in the baseline
- no compounding scope in the baseline
- integrations for ERP/accounting, supplier API, BI/warehouse, internal payment, and inter-warehouse courier/proof-of-delivery
- greenfield start with a big-bang go-live assumption

## Architectural Principles
- Keep one deployable backend unit.
- Enforce strict internal module boundaries.
- Keep business invariants in the domain and application layers, not in controllers.
- Use PostgreSQL as the source of truth for transactional workflows.
- Prefer REST for commands and transactional APIs.
- Allow GraphQL later for aggregate reads if dashboard complexity requires it.
- Keep authentication simple in v1, but enforce strong session security and auditability.
- Use asynchronous processing for side effects and integrations after the main transaction commits.
- Do not introduce microservices unless there is proven operational pressure.

## Selected Stack
### Frontend
- `React`
- `TypeScript`
- `Vite`
- `Tailwind CSS`
- `TanStack Query`
- optional lightweight client state where needed

### Backend
- `ASP.NET Core`
- modular monolith
- layered architecture with clear domain boundaries
- REST APIs
- `OpenAPI`
- local auth with secure session cookies
- background processing through hosted services and DB-backed job tables

### Data and Platform
- `PostgreSQL`
- `EF Core + Dapper`
- distributed cache such as `Redis`
- DB-backed outbox and job tables
- object storage for attachments and evidence files

### Observability
- `OpenTelemetry`
- structured logging
- metrics, traces, and logs wired to the chosen monitoring stack

### Delivery
- reverse proxy or ingress
- containers
- CI/CD with `GitHub Actions`
- cloud-first deployment

## High-Level Topology
```text
Internal users
  -> Browser
  -> Reverse Proxy / Ingress
  -> React SPA
  -> ASP.NET Core Modular Monolith
  -> PostgreSQL / Distributed Cache / Object Storage / Job Tables
  -> ERP / Supplier API / BI / Payment / Courier integrations
  -> Observability stack
```

## Core Runtime Components
### 1. Edge Layer
Responsibilities:
- terminate TLS
- serve or route frontend assets
- proxy `/api` traffic to the backend
- enforce basic edge policies such as request size and timeouts

### 2. Frontend Layer
The frontend is one internal SPA used by head office, store staff, warehouse staff, pharmacists, finance users, and administrators.

Main responsibilities:
- role-based navigation and workspace access
- authenticated session usage through secure cookies
- server-state fetching and caching
- operational screens for inventory, dispensing, procurement, transfers, pricing, dashboards, and audit

The frontend must not hold core business rules such as FEFO allocation, approval policy, recall blocking, or stock state transitions.

### 3. Backend Layer
The backend is one deployable application split internally into modules.

Why this shape:
- simpler to build and operate than microservices
- better fit for transactional integrity across inventory, dispensing, procurement, pricing, and audit
- easier to keep a single source of truth
- still allows strong internal boundaries and later extraction if ever needed

Suggested internal modules:
- Identity and Access Control
- Site and Storage Location Management
- Master Data and Catalog
- Supplier and Procurement
- Receiving and QC
- Inventory and Batch Control
- Prescription and Dispensing
- Transfers and Stocktaking
- Pricing and Promotions
- Returns, Recall, and Destruction
- Payment and Settlement Integration
- Courier and Proof-of-Delivery Integration
- Reporting and Dashboard
- Audit and Governance

### 4. Data Layer
#### PostgreSQL
`PostgreSQL` is the transactional source of truth for:
- users, roles, scopes, and sessions
- sites and storage locations
- products, suppliers, and price books
- purchase orders, receipts, QC decisions, and batches
- stock ledger, reservations, transfers, and stocktakes
- prescriptions, dispense records, and returns
- recall cases and audit logs
- outbox messages and job tables

#### EF Core and Dapper
- `EF Core` handles transactional writes and standard persistence.
- `Dapper` can be used for read-heavy queries, dashboards, and report-oriented read models.

#### Distributed Cache
A distributed cache such as `Redis` is used for:
- hot read caching
- short-lived reference data caching
- rate limiting counters
- idempotency support where useful

The system must not depend on cache as the system of record.

#### Environment seam
The Infrastructure layer must only read the connection string from configuration.
- shared key: `ConnectionStrings:PharmacyCentral`
- local development: Aspire AppHost supplies the PostgreSQL container connection string
- production: AWS supplies the same key from environment variables or a secret store
- the app code must not branch on local versus AWS database providers

### 5. Authentication and Authorization
Baseline authentication model:
- local user/password managed by the application
- password hashing with strong algorithms such as Argon2id or PBKDF2
- secure session cookies with `Secure`, `HttpOnly`, and appropriate `SameSite`
- CSRF protection for state-changing requests
- login rate limiting, lockout, session rotation, and password reset flow
- MFA required for privileged roles

Authorization model:
- RBAC plus site-scoped permissions
- segregation of duties for high-risk approvals
- creator must not approve their own high-risk transactions
- all critical state changes must be auditable

### 6. Background Processing and Integration
Baseline approach:
- use `IHostedService` or `BackgroundService` for in-process background workers
- store jobs and outbox messages in PostgreSQL
- commit the business transaction first, then process side effects asynchronously

Typical background workloads:
- near-expiry checks
- stockout and replenishment alerts
- price publish scheduling
- retryable integration delivery
- report materialization
- cleanup and housekeeping jobs

Integration boundaries:
- ERP/accounting
- supplier API
- BI/warehouse export or CDC pipeline
- internal payment or settlement adapter
- inter-warehouse courier and proof-of-delivery adapter

No EHR or clinic adapter is included in the baseline.

### 7. Observability
The system should emit:
- structured application logs
- distributed traces for requests and background jobs
- metrics for API latency, DB pressure, queue lag, cache hit rate, and business SLIs

Important operational metrics:
- request rate, error rate, p95 and p99 latency
- DB connections, lock waits, deadlocks, slow queries
- cache hit ratio
- outbox and job lag
- dispense success and failure rates
- recall block effectiveness
- transfer discrepancy rates
- payment and courier integration failures

## Main Business Flows
### Authentication Flow
1. user signs in through the app
2. backend validates credentials and role assignments
3. backend creates a secure server-side session
4. frontend calls secured APIs with the session cookie

### Procurement to Receipt Flow
1. procurement creates a purchase order
2. backend stores the PO in PostgreSQL
3. approved PO is sent to the supplier adapter
4. receiving staff records GRN with batch and expiry details
5. stock enters `quarantine` or `pending_qc`
6. QC releases or rejects the batch
7. accounting and downstream integrations are triggered through the outbox

### Dispensing Flow
1. pharmacist or store staff enters the prescription manually in the app
2. backend validates required fields and stock eligibility
3. inventory domain suggests FEFO-compliant batches
4. reservation and stock ledger updates commit transactionally
5. audit records are written for all critical actions

### Transfer and Stocktake Flow
1. source or destination site creates a transfer or stocktake workflow
2. backend enforces approval, reservation, and reconciliation rules
3. stock ledger records every movement and adjustment
4. discrepancies trigger approval and exception handling

### Recall and Governance Flow
1. compliance or QA activates a recall case
2. affected lots are blocked immediately in transactional APIs
3. sites work through quarantine and disposition tasks
4. audit and reporting surfaces show residual exposure and closure state

## Deployment Topology
### Target Runtime
Production is cloud-first and container-based.
The default deployment shape is:
- reverse proxy or ingress
- frontend container or static asset hosting
- one or more backend containers
- PostgreSQL
- distributed cache
- object storage
- observability components

Expected logical containers or services:
- `edge`
- `frontend`
- `api`
- `api-worker` if background load needs a separate runtime mode
- `postgres`
- `redis` or equivalent distributed cache
- monitoring stack components

### Development versus production shape
#### Development
- Aspire AppHost is the composition root
- AppHost starts the API, frontend, and PostgreSQL container
- local persistence uses a Docker volume or bind mount

#### Production
- frontend can be hosted separately from the API
- API runs on AWS compute
- PostgreSQL runs outside the app host, usually as managed AWS PostgreSQL
- the same `ConnectionStrings:PharmacyCentral` key is supplied at deploy time

### CI/CD
`GitHub Actions` should:
- run frontend and backend tests
- run static analysis and dependency scanning
- build production artifacts
- build and publish container images
- deploy to cloud environments
- run smoke checks after deployment

### Migration and Go-Live Assumption
The current research assumption is **greenfield start** with **big-bang go-live**.
This does not mean partial product delivery by workspace.
It means the finished system is prepared for one company-wide cutover.

Because the target business shape is very large, the deployment plan must include:
- full-chain rehearsal in staging
- cutover checklist
- rollback or cutback plan
- hypercare staffing
- reconciliation for stock, pricing, and finance-sensitive flows

## Security Baseline
- TLS at the edge
- secure cookie sessions
- strong password hashing
- MFA for privileged roles
- RBAC and site-scoped authorization
- anti-CSRF controls
- audit logs for critical actions
- secrets managed outside source control
- rate limiting and lockout for login endpoints

## Scaling Path
The baseline scaling order is:
1. optimize queries and indexes
2. add read caching and read models
3. scale out backend containers horizontally
4. partition large ledger or history tables in PostgreSQL
5. offload heavy BI workloads from OLTP

## Current Open Decisions
These items remain implementation decisions, not research blockers:
- exact controller style versus minimal APIs versus hybrid
- exact session store implementation details
- whether GraphQL is needed in v1 or later
- exact cache product if not using Redis
- exact object storage provider
- exact monitoring backend behind OpenTelemetry

## Recommended Default Direction
Until lower-level implementation details are finalized, the safest default direction is:
- keep one backend deployable unit
- use REST APIs with `OpenAPI`
- use PostgreSQL as the only transactional system of record
- use local auth with secure session cookies
- keep strong internal module boundaries
- use async outbox and background jobs for side effects
- avoid microservices in v1

## Final Code Architecture Decision

Pharmacy Central uses **Clean Modular Vertical Slice Architecture** for backend code organization.

This combines three concerns without treating them as competing patterns:

- **Modular monolith** defines the runtime and ownership shape: one deployable backend split by business capability.
- **Clean Architecture** defines dependency direction: business and application logic stay protected from frameworks, HTTP, EF Core, and external services.
- **Vertical slices** define use-case layout: code that changes together for a business action lives together.

### Dependency Direction

The dependency direction is fixed:

```text
Domain / SharedKernel
  <- Application
  <- Infrastructure
  <- Web.Api
  <- AppHost
```

Rules:

- `Domain` contains business entities, value objects, stable business rules, and domain services.
- `SharedKernel` contains tiny, stable primitives only, such as result/error types.
- `Application` contains use-case orchestration, commands, queries, handlers, and application abstractions.
- `Infrastructure` implements persistence, identity, authorization, external services, and other technical details.
- `Web.Api` adapts HTTP requests to Application use cases and must stay thin.

`Domain` and `Application` must not reference EF Core, ASP.NET Core, Web.Api, or Infrastructure.

### Vertical Slice Layout

Application features are organized by business capability and then by use case:

```text
Application/<Feature>/<UseCase>/
  Command.cs or Query.cs
  Handler.cs
  Details.cs or Response.cs
  Validator.cs if needed

Application/<Feature>/Shared/
  feature-family services or policies only
```

Examples:

```text
Application/Inventory/RecordStockMovement/
Application/Inventory/ListInventoryBalances/
Application/Inventory/Shared/StockMovementRecorder.cs

Application/Transfers/CreateTransfer/
Application/Transfers/ApproveTransfer/
Application/Transfers/ReceiveTransfer/

Application/Stocktakes/CreateStocktakeSession/
Application/Stocktakes/ApproveAdjustment/
Application/Stocktakes/Shared/StockAdjustmentMovementService.cs
```

Endpoint files remain grouped by API feature under `Web.Api/Endpoints/<Feature>`, but they should only perform HTTP adaptation, authorization policy registration, request validation that belongs at the transport boundary, current-user extraction, and result mapping.

### Shared Logic Decision Tree

When logic appears in multiple places, choose its home by meaning:

1. **One use case only** — keep it inside that use-case folder.
2. **Several use cases in one feature family** — put it under `Application/<Feature>/Shared`.
3. **Stable business rule** — move it into a Domain entity, value object, domain service, or domain policy.
4. **Technical plumbing** — put it in Infrastructure, Web.Api middleware, or SharedKernel only if it is stable and generic.
5. **Cross-feature abstraction** — allow only after at least three real, stable usages and a clear business name.

Do not share request/response DTOs merely because two shapes currently match. Each use case owns its API/application contract unless a shared business model is genuinely stable.

### Dead Traps to Avoid

- No global `Common`, `Utils`, or broad `SharedServices` junk drawer.
- No handler-to-handler calls.
- No EF Core references from Application or Domain.
- No ASP.NET Core references from Application or Domain.
- No business rules in endpoints.
- No trusted user identity accepted from request bodies.
- No broad shared DTOs across unrelated use cases.
- No vague classes named `Helper`, `Util`, `Manager`, or `CommonService` unless there is a specific domain meaning and review justification.

The goal is feature locality without losing boundary discipline: use cases stay easy to find and change, while business rules and technical details stay in their correct layers.
