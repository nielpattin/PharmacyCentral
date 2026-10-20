# Pharmacy Central Architecture

Pharmacy Central is an Express 5 microservices monorepo for customer and staff pharmacy workflows.

## Runtime topology

```text
customer-web ─┐
staff-web ─────┼── AWS API Gateway (HTTP API)
               │         │
               │    Lambda Authorizer (Session, CSRF, Signed Identity Context)
               │         │
               │      VPC Link
               │         │
               │   internal ALB (Application Load Balancer)
               │         │
               │         ├── identity-service (ECS Fargate :3001)
               │         ├── catalog-service (ECS Fargate :3002)
               │         ├── inventory-service (ECS Fargate :3004, procurement included)
               │         ├── sales-service (ECS Fargate :3005)
               │         ├── payment-service (ECS Fargate :3006)
               │         └── operations-query-service (ECS Fargate :3007)
               │
               └── PostgreSQL 18/PostGIS service databases
                   RabbitMQ, Redis, Mailpit, OpenTelemetry Collector
```

AWS API Gateway owns the public `/api` surface with a Lambda authorizer. Traffic travels through a VPC Link to an internal Application Load Balancer, which routes to ECS Fargate backend services. The AWS configuration in `deploy/aws` is configuration-only and no AWS resources were deployed. AWS does not use the local gateway. Local Compose retains an Nginx reverse proxy for development. Business services own their write models and migrations. The operations query service consumes events and never reads another service database.

## Workspace boundaries

- `apps/identity-service` owns accounts, sessions, verification tokens, OIDC, and access data.
- `apps/catalog-service` owns sites, PostGIS coordinates, storage locations, products, suppliers, units, prices, and availability projections.
- `apps/inventory-service` owns batches, quality, balances, ledger entries, FEFO reservations, transfers, returns, replenishment, stocktakes, purchase orders, and goods receipts.
- `apps/sales-service` owns carts, orders, delivery addresses, prescriptions, counter transactions, delivery snapshots, and sales outbox events.
- `apps/payment-service` owns invoices, attempts, transactions, refunds, QR instructions, SePay verification, and reconciliation.
- `apps/operations-query-service` owns event-fed dashboard, finance, reporting, and audit projections. A dashboard read is site-bound where the service behind it is: it asks `catalog-service` for storage locations and filters the site list it already holds to the reader's scope, `inventory-service` for balances, transfers, stocktakes, adjustments, and goods receipts, and `sales-service` for prescriptions, forwarding that scope as `x-actor-site-ids`. `finance_entries` and `report_rows` record no site, so finance and report reads answer network-wide figures; only the live inventory totals inside a finance summary follow the reader's sites.
- Edge ingress and routing are handled by AWS API Gateway (HTTP API), Lambda Authorizer, VPC Link, and an internal ALB (configuration-only in `deploy/aws`, no resources deployed). API Gateway handles CORS and throttling. The authorizer handles session verification, role and site authorization, CSRF validation, and HMAC-signed internal identity context.

Shared packages contain only technical infrastructure and versioned transport contracts. Apps never import another app.

## Consistency model

- Each service commits its own database transaction.
- Domain events use outbox rows and RabbitMQ delivery.
- Consumers use idempotent inbox or projection keys.
- Reservations, payment confirmation, and fulfillment use explicit commands and compensation paths.
- Browser-supplied prices, distances, route geometry, fees, store ranking, and user identity are not authoritative.
- Delivery checkout recalculates the selected store route and snapshots the provider address, note, distance, duration, fee, and GeoJSON.

## Security model

- Identity uses opaque, revocable session cookies.
- Lambda Authorizer validates sessions against `identity-service` to derive actor identity.
- Employee route groups require an employee account.
- Lambda Authorizer forwards a short-lived HMAC-signed internal identity context (`x-internal-identity-context`, `x-actor-id`, `x-actor-type`, `x-request-id`) to backend services via API Gateway integration mapping.
- Mutating browser requests require a CSRF token, except external SePay webhooks.
- SePay webhooks pass through API Gateway preserving raw request bytes and verify HMAC in `payment-service`.
- Production requires API Gateway throttling, configured internal signing secrets, and service-side verification of signed identity context.

## Delivery architecture

Customers select a retail store and a destination marker. Two providers do two jobs. `sales-service` names the marker with Vietmap reverse geocoding, because Vietmap keeps Vietnamese house numbers that OpenStreetMap-based sources drop, then calls the OpenRouteService `driving-car` Matrix and Directions APIs for the route and returns a LineString. The same service proxies Vietmap address search and place resolution (`GET /delivery/addresses/search`, `POST /delivery/addresses/resolve`, `POST /delivery/reverse-geocode`) so the metered `VIETMAP_API_KEY` never reaches the browser; only the separate `VITE_VIETMAP_TILEMAP_KEY` ships in the web bundle to draw map tiles. Redis caches namespaced results. Cache failure does not become the source of truth, and provider timeout or quota failures produce a controlled upstream error. Pickup always has a zero delivery fee.

Delivery fees come from the driving distance of the route and four required settings. A route shorter than `DELIVERY_FREE_DISTANCE_METERS` (2 km) is free. From there the fee is `DELIVERY_FEE_BASE` (5,000 VND) plus `DELIVERY_FEE_PER_KILOMETER` (2,000 VND) for every full kilometer beyond the free distance, so 2 to 2.99 km costs 5,000 VND and 3 km costs 7,000 VND. Only routes shorter than `DELIVERY_MAX_DISTANCE_METERS` (10 km) are delivered: a route of 10 km or more makes `POST /delivery/calculate` and `POST /orders` answer `422` with code `delivery_out_of_range`, `distanceMeters`, and `maxDistanceMeters`, and the checkout asks the shopper to pick a closer store or pick up in store.

## Prescription intake architecture

A customer uploads a photo of a printed prescription (`customer-web` page `/gui-don-thuoc`). The browser first looks for a QR in the photo with jsQR and, when it finds one, sends only the decoded text to `sales-service`; otherwise it downscales the photo and uploads it. `sales-service` reads a photo with one Gemini vision call that returns schema-constrained JSON, validates the answer with the zod contract in `src/contracts/prescription-intake.ts`, and asks `catalog-service` (`POST /products/match`) for the closest products to every line, handing over each line's name, ingredients, strength, dosage form, and printed unit. A separate OCR step is not used: the hard part is telling medicine lines from headers, dosing text, and stamps, which a multimodal model does in the same pass that reads the text.

Matching is deterministic and runs in PostgreSQL. `pg_trgm` and `unaccent` score the prescribed name against the product name and the prescribed ingredients against the generic name and active ingredient, so a missing accent or a typo still matches. A product must hold every prescribed ingredient, a one-letter word such as the `C` in "Vitamin C" must appear in the product name, and strengths, dosage forms, and compositions are compared apart. Dosage forms are compared by group, because how a medicine is taken matters more than what it is called: a film-coated tablet stands in for a plain one and an oral powder for a suspension, while "Bột pha tiêm" is an injection and never stands in for an oral form. A line printing no form is read from its dispensing unit, "Viên" being a tablet and "Gói" a sachet, while "Ống" and "Chai" are too ambiguous to say anything. A product listing more ingredients than the line prescribes is never offered as the same active ingredient, because paracetamol with caffeine is not paracetamol. Each suggestion reports `strengthMatch`, `dosageFormMatch`, and `ingredientsMatch`, and each is `null` when either side states no value, so a missing one is never reported as a mismatch. Candidates are ranked by the better of their name and ingredient scores, nudged up for an agreeing strength or form and down for a differing one, and a product known to differ from the line in strength, dosage form, or composition comes after every product that differs in nothing, so the exact tablet precedes another strength of the same drug. The model proposes lines and the database decides products; the model never picks a product or a price. The page shows the printed line next to each suggestion, because a wrong guess about a medicine must never be silent.

A matched suggestion is not always available: the chosen store may stock nothing that fills a line as written. The page then offers "Nhờ dược sĩ tìm giúp", which files the whole read prescription as a consultation through `POST /prescriptions/consultations` in `sales-service`, carrying every line with a `needsHelp` flag, the chosen store, and an optional note, and honouring an `Idempotency-Key` so a retried form is not filed twice. A consultation cannot be a `prescriptions` row, because such a row names a product, unit, site, and storage location and reserves stock, and a question has none of those; it is its own aggregate in its own table, `prescription_consultations`, added by a `sales-service` migration. `GET /prescriptions/consultations` lists the queue newest first, narrowed by `status` and `siteId` for staff and forced to the caller's own rows for a customer, and `POST /prescriptions/consultations/:id/answer` takes a pharmacist's written reply, moving the row from `Open` to `Answered` and refusing a second answer with `409`. Every write appends its outbox event in the same transaction, `sales.prescription-consultation.requested.v1` on filing and `sales.prescription-consultation.answered.v1` on the answer. Staff work the queue in staff-web (prescriptions > "Tư vấn đơn thuốc") and customers read the replies in their account under "Đơn thuốc"; at the edge a signed-in customer may `GET` and `POST` `/api/prescriptions/consultations`, the list read being filtered to their own records, while answering stays a Pharmacist action.

Each AI feature has its own settings, made of a provider, model, base URL and API key. The owning service keeps them. `sales-service` holds the photo reading settings, `chatbot-service` holds the consultation assistant's and the question screening's, and `catalog-service` holds the semantic product search's. A Platform Admin sets them in staff-web under **AI integrations**. A service seals the key with AES-256-GCM under `SECRETS_ENCRYPTION_KEY`, binds it to its purpose so a sealed value cannot be reused for another feature, and stores the settings in its own `ai_credentials` table. Saved settings always win, as a whole. The `AI_<FEATURE>_PROVIDER`, `_MODEL`, `_BASE_URL` and `_API_KEY` group in `.env` serves that feature only while nothing is saved, and production leaves the group unset. No API returns the key. Only its last four characters come back. A service reads the settings at most once a minute, so a replacement applies without a restart. Photos and extractions are not stored or logged, but they still leave the system for the provider. They contain a patient's name, diagnosis, and medicines. The page therefore shows a disclosure and requires an explicit consent checkbox before any photo is uploaded, while QR intake stays on the device and needs none. A production rollout still needs the cross-border transfer impact assessment that Law 91/2025/QH15 on Personal Data Protection requires. Photo reading is rate limited per account in Redis (5 per minute, 30 per day) so that a registered account cannot run up the metered provider bill, and a Redis outage stops photo reading rather than lifting the limit. With no settings from either source, photo reading answers 503 and does not use up the shopper's allowance, and QR intake keeps working.

## Shopping assistant architecture

The shopping assistant in `chatbot-service` answers with tool calling. The model decides when to search the catalog and when to read a product's details, through `search_products` and `get_product_details`. Nothing from the catalog goes into the prompt before the model runs. `catalog-service` stays the only owner of products and prices. `chatbot-service` reads them through `GET /products`, `GET /products/:id`, and `GET /pricing/active`. A question makes at most three model calls: one that may request tools, one after the tool results, and a last call with tools disabled that must answer in text. The saved history is replayed in full and only grows, so the start of the prompt stays the same from one question to the next. The chat model has two adapters, `gemini` and `openai-compatible`, and the saved provider picks one. `openai-compatible` speaks the chat completions API with tool calling, at `POST {baseUrl}/chat/completions`, so its base URL carries the version path. Prescription photo reading in `sales-service` and semantic product search in `catalog-service` stay Gemini only.

Before the chat model runs, `chatbot-service` sends each question to the TypeSafe Jev API. This is the intent gate. One Jev request classifies the question's intent as product search, product detail, order help, greeting, or out of scope. It also scores the chance of a medical emergency and the chance of an attempt to override the assistant's instructions. The code decides from those scores. A greeting, an out of scope question, an emergency, or an injection attempt gets a fixed Vietnamese reply and no model call. A low confidence on a greeting or out of scope intent lets the question through to the model. The exchange is saved either way, so it counts toward the session and the rate limits. For an injection attempt the saved question is a fixed placeholder, so the attack text is not replayed to the model in later turns. The thresholds are untuned starting values in `intent-policy.ts`.

Each Jev attempt has its own 4 second timeout. A network error, a timeout, HTTP 408, 429, or a 5xx is retried, up to three attempts in total, with a random wait before each retry that is capped at 2 seconds. Other statuses and an unreadable answer fail at once. When Jev still fails, the question gets a 503 and nothing is saved, and the model is not called.

With no Jev settings from either source, the gate is off and every question goes to the chat model. Jev is one layer only. `SYSTEM_RULES` stays the second layer.

## Deployment

Docker Compose provides the local topology. AWS ECS Fargate deployment configuration with AWS API Gateway, VPC Link, internal ALB, and Lambda Authorizer is defined in `deploy/aws` (configuration-only; no AWS resources were deployed). Images and platform dependencies use pinned digests. GitHub Actions runs Nx affected validation on pull requests. Releases run on demand through a manual workflow that validates the workspace and publishes digest-addressed GHCR application images for the requested version.

See [Baseline.md](Baseline.md) and [Runbooks.md](Runbooks.md) for version constraints, migration, seed, and operational runbook details.

The LikeC4 model of this architecture, with the system context, the containers, the per service views, the sequence diagrams and the two deployment topologies, lives in [docs/diagrams](diagrams/README.md).
