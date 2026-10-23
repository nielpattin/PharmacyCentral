# Pharmacy Central, architecture diagrams

The [LikeC4](https://likec4.dev) model of the whole project. It describes the logical architecture
(the people, the services, the data and the third parties) and the two deployment topologies of the
repository (the local Docker Compose stack and the AWS ECS Fargate stack).

## Render the diagrams

The project is self contained, it needs no dependency of the monorepo.

```bash
# live preview on http://localhost:5303
pnpm diagrams:serve

# static site
pnpm dlx likec4@1.60.0 build -o docs/diagrams/dist docs/diagrams

# images
pnpm diagrams:export

# validation
pnpm diagrams:validate

# format the sources
pnpm dlx likec4@1.60.0 format docs/diagrams
```

The live preview port comes from `DIAGRAMS_PORT` in the root `.env`; `pnpm diagrams:serve` stops with an error if it is missing.

The `diagrams:*` scripts run `tools/likec4.mjs`, which wraps the CLI. The wrapper exists because of
two things in 1.60.0:

- The app of 1.60.0 loads an optional AI layout helper when a provider key is in the environment
  (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_HOST`, `MINIMAX_API_KEY`). The
  helper is installed from inside the package folder of the CLI, and the dependency tree of that
  folder holds the private `@likec4/devops` package, so the install fails on a public registry and
  the command stops with `Install package '@tanstack/ai' manually`. The helper is optional, so the
  wrapper removes the provider keys from the environment of the child process. Without the wrapper
  the same thing is done by unsetting the key: `env -u GEMINI_API_KEY pnpm dlx likec4@1.60.0 serve
  docs/diagrams` on Git Bash, `$env:GEMINI_API_KEY = $null` before the command in PowerShell.
- pnpm asks on the console which packages may run their build scripts during the install, which
  blocks a preview that is started without a terminal, so the wrapper allows esbuild up front.
- The PNG export drives a headless browser, so the browser of the Playwright version that ships
  with the CLI has to be present: `pnpm exec playwright install chromium`.

## Layout of the project

| Path | Content |
| --- | --- |
| `likec4.config.json` | The project config, it sets the scope of every file of this folder. |
| `spec.c4` | The vocabulary: element kinds, relationship kinds, tags and deployment node kinds. |
| `model/people.c4` | The five kinds of users. |
| `model/external.c4` | The third parties: Google OIDC, Gemini, OpenAI-compatible, TypeSafe Jev, VietMap, OpenRouteService, Resend, SePay. |
| `model/system.c4` | The system shell: web tier, edge and access control, application services, data tier. |
| `model/services/*.c4` | One file per service, with the modules of the service. |
| `model/relationships-usage.c4` | Who calls what: the path routing map, the service to service calls, the events, the third parties. |
| `model/relationships-internal.c4` | The calls inside a service, and the telemetry edges. |
| `deployment/local.c4` | The Docker Compose topology. |
| `deployment/local-relations.c4`, `deployment/aws-relations.c4` | The edges of the deployments that the logical model does not carry. |
| `deployment/aws.c4` | The AWS ECS Fargate topology of `deploy/aws`. |
| `views/overview.c4` | The system context, the containers, the data ownership, the events, the AI features, the trust boundary. |
| `views/domain.c4` | One diagram per service, with its modules and its dependencies. |
| `views/flows.c4` | The sequence diagrams: checkout, prescription intake, chatbot tool calling, import, read model. |
| `views/deployment.c4` | The two deployment diagrams. |
| `views/observability.c4` | The telemetry: the eight services, the collector, Tempo, Prometheus, Loki and Grafana. |

## The views

| View | What it answers |
| --- | --- |
| `index` | Who uses the system, and which third party it talks to. |
| `containers` | The four tiers, with the path routing map between the web tier and the services. |
| `dataOwnership` | Which service owns which database. |
| `eventFlow` | Who publishes on `pharmacy.events`, and who consumes what. |
| `aiFeatures` | The three AI features, their owner and their provider. |
| `securityModel` | The trust boundary: the session, the roles, the site scope, the CSRF. |
| `identityDetail`, `catalogDetail`, `searchDetail`, `inventoryDetail`, `salesDetail`, `paymentDetail`, `operationsDetail`, `chatbotDetail` | The modules of a service and the services it depends on. |
| `checkoutFlow` | From the cart to the paid invoice. |
| `prescriptionIntake` | From the photo of a prescription to the consultation. |
| `chatbotToolCalling` | The Jev gate and the three model calls of the shopping assistant. |
| `staffDataImport` | The import of the master data and of the opening balances. |
| `operationsReadModel` | How the staff dashboards get their figures. |
| `outboxDelivery` | How a stock change becomes an event: the outbox row, the relay, the durable queue. |
| `traceThroughOutbox` | One trace from the request, through the outbox and the broker, to the consumers and Tempo. |
| `asyncReliability` | What the relay and the consumer do when the broker is down, a payload is bad, or a handler keeps failing. |
| `localCompose` | The local stack: the gateway, the eight services, the infrastructure. |
| `awsEcs` | The production stack: the API Gateway, the authorizer, the ALB, the Fargate tasks. |
| `observability` | The telemetry: the OTLP edges of the services, the collector and its backends, Grafana. |

## Notes on the model

- **The edge is deployment specific.** The logical model goes from the web tier straight to the
  services, because the routing map is the same in both topologies. The Nginx gateway of Compose
  and the API Gateway with the Lambda authorizer of AWS appear in the deployment views.
- **The data tier is owned by the platform.** Every service owns one database and never reads
  another one. `operations-query-service` is the only reader, and it reads through the events and
  through the HTTP API of the owning service.
- **The events are versioned.** The exchange is `pharmacy.events`; a consumer binds its own durable
  queue and stays idempotent through its inbox or projection keys.
- **Publishing goes through a transactional outbox.** `inventory-service`, `sales-service` and
  `payment-service` write the event row in the same transaction as the change, and an outbox
  publisher relays the unpublished rows every second over a confirm channel, and marks a row
  published only after the broker confirmed the message, so delivery is at least once. An advisory
  lock lets one relay per database publish at a time, which keeps the order. Each row also stores
  the `traceparent` of the request that wrote it, so the trace continues across the broker. A consumer
  reads a durable quorum queue one message at a time; a message that keeps failing is retried five times and
  then parked on `<queue>.dead` through the exchange `pharmacy.events.dead`, and a payload that can
  never be applied is parked at once.
- **The browser is never authoritative.** Prices, stock quantities, delivery fees, distances and
  the identity of the caller are recalculated by the service that owns them.
- **The AWS stack is configuration only.** `deploy/aws` defines the resources, but no AWS resource
  has been created, and the data services of that stack are not provisioned by it.
