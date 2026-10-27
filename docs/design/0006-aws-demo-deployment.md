# 0006. Low-cost AWS demo deployment

- **Status:** Accepted (owner answered the open questions on 2026-10-26)
- **Author:** @nielpattin
- **Date:** 2026-10-26

## Summary

`deploy/aws` defines the ECS Fargate, ALB, API Gateway and Lambda authorizer tiers, but nothing around them, and it has never been applied. This design adds what a first `terraform apply` needs in `us-east-1`: a VPC, the data stores, container images, the two web apps, and a demo-sized configuration. The aim is a demo that runs, not a production environment. Every service in `apps/` is affected only through environment variables; no application code changes except as listed under Open questions.

## Motivation

- [deploy/aws/README.md](../../deploy/aws/README.md) says the stack "does not provision" PostgreSQL, Redis, RabbitMQ or Typesense, and its last line of testing is "Not tested: a real apply".
- The account (`539792719878`, `us-east-1`) has one default VPC with public subnets only, no NAT, and no ECS, RDS or EC2 resources. The Fargate On-Demand quota is 6 vCPU.
- `terraform.tfvars.example` lists only service URLs. The services fail fast on missing variables (AGENTS.md), so most would stop at startup. For example `catalog-service` requires `SEAWEEDFS_*` for product media, `identity-service` requires `PUBLIC_APP_URL` and the mail settings, `sales-service` requires the delivery and map settings, and `payment-service` requires `PHARMACY_PAYMENT_SEPAY_*`.
- The defaults (`desired_count = 2`, 512 CPU / 1024 MiB per service, a 2 vCPU embedder, an OpenTelemetry collector with Managed Prometheus) cost far more than a demo needs.
- Staff-web and customer-web have no hosting in Terraform; their `nginx-entrypoint.sh` proxies `/api` to `API_BASE_URL`.

## Goals

- `terraform apply` from a clean account produces a working stack: sign in as the admin, import the sample data, place an order, see it in staff-web.
- A monthly cost of about 235 USD with services running, about 136 USD with `services_enabled = false` between demos (see Cost).
- Everything is in `deploy/aws` and reproducible; no console clicks except the first admin sign-in.

## Non-goals

- High availability, multi-AZ databases, autoscaling beyond one task, a custom domain, WAF, backups beyond RDS defaults.
- CI/CD. Images are built and pushed from a developer machine.
- Observability on AWS (collector, Managed Prometheus, X-Ray). The System page shows health and queues without it.
- Self-hosted embeddings. Catalog search falls back to keyword search (runbook, "Self-hosted product search embeddings").

## Proposed design

Diagram: [aws-architecture.drawio](../diagrams/aws-architecture.drawio) (open in draw.io).

All new resources go in new files next to `main.tf`; `main.tf` changes only to make existing pieces optional or configurable.

### Network (`network.tf`)

A new VPC `10.20.0.0/16` with two public and two private subnets in two AZs, an internet gateway and **one** NAT gateway. The existing variables `vpc_id`, `private_subnet_ids`, `api_gateway_subnet_ids` are replaced by references to these resources (clean cutover: no input variables for networking remain). The default VPC is not touched. Private subnets let tasks keep `assignPublicIp = DISABLED` as `main.tf` already sets; the single NAT also serves the authorizer Lambda and image pulls.

### Data tier (`data.tf`)

| Need | Choice | Why |
| --- | --- | --- |
| PostgreSQL | RDS `db.t4g.micro`, engine 18.x, 20 GiB gp3, single AZ, one instance, seven databases | The local stack uses PostgreSQL 18 with PostGIS; RDS 18 supports PostGIS. Measured memory use of every service is under 30 percent of its task, and the staging stack has almost no traffic |
| Roles | One-shot ECS task from the `postgres:18` image that runs `deploy/local/postgres/roles.sh` logic against RDS | RDS is private; the task runs inside the VPC. Same SQL as local |
| Redis | ElastiCache `cache.t4g.micro`, one node | Used by identity-service and sales-service |
| RabbitMQ | One Fargate task (`rabbitmq:4.3.5-management`, 512 CPU / 1024 MiB), Cloud Map name `rabbitmq`, ephemeral storage | Amazon MQ offers RabbitMQ 4 only from `mq.m7g.medium`, about 100 USD a month, which costs more than every Fargate task together. The services declare their queues on connect; a restart loses only events that were queued and not yet consumed |
| Typesense | One Fargate task (`typesense/typesense` pinned by digest, 256 CPU / 512 MiB), Cloud Map name `typesense`, empty task volume at `/data` | The index is a derived copy; catalog-service rebuilds it (README). Not HA, by design |
| Product media | S3 bucket + IAM user key for catalog-service | `catalog-service` talks S3 with `forcePathStyle` and static keys (`product-media-store.ts`), so `SEAWEEDFS_ENDPOINT = https://s3.us-east-1.amazonaws.com` works unchanged |

Connection strings and keys are written by Terraform as SSM SecureString parameters, which cost nothing; only the two internal secrets that the authorizer Lambda reads stay in Secrets Manager. They are written from the resources' own outputs (`random_password` for database and broker passwords), so no secret value is typed in a tfvars file. `shared_secrets` and `service_secrets` are built from those secrets.

### Images (`registry.tf`)

One ECR repository per service plus `ops`, none for the embedder, with immutable tags. `tools/aws-push-images.mjs <tag>` builds the images from the existing Dockerfiles for `linux/amd64` and pushes them as `<tag>`; the `image_tag` variable selects them. Tags are `staging-<git short SHA>`, and a tag is never reused. GHCR credentials are not needed.

### Web (`web.tf`)

One public ALB with a host rule per app, each rule in front of one Fargate task that runs the existing web image (nginx proxies `/api` to the API Gateway URL). Two hostnames keep the staff and customer cookies apart (AGENTS.md: the apps must not share a host): `shop.<domain_name>` and `staff.<domain_name>`. CloudFront was dropped because the account could not create distributions without an AWS Support verification. One ACM certificate covers both hosts; the DNS stays at the owner's provider (Cloudflare, DNS only), so the certificate validation records and the two CNAMEs to the ALB are added by hand from the `certificate_validation_records` and `site_cnames` outputs. HTTPS is terminated at the ALB, port 80 redirects to 443, and `COOKIE_SECURE` is true. `PUBLIC_APP_URL` comes from the hostname. Product images are read straight from a public `product-images/*` prefix of the media bucket.

### Demo sizing (`variables.tf`, `main.tf`)

- `task_cpu = 256`, `task_memory = 512` for every service, `desired_count = 1`, no autoscaling, Container Insights off, log retention 7 days. Peak memory of every service stayed under 30 percent of 512 MiB and sales-service under 10 percent, so sales-service no longer has a larger size. A migration task adds 0.25 vCPU while it runs.
- `embedder_*` and the OpenTelemetry collector (`telemetry.tf`) become optional (`count` on a boolean, default `false`). When the embedder is off, the four `AI_EMBEDDING_*` variables are not set on `catalog-service` and `search-service` (the group is all-or-none, AGENTS.md). Their `OTEL_EXPORTER_OTLP_ENDPOINT` is required by the services, so it points at a no-op address supplied through `service_environment`; see Open questions.
- Service-specific variables the code requires (identity, sales, payment, chatbot, ops-console) get a documented block in `terraform.tfvars.example`, filled by `tools/aws-env.mjs` from `.env.example` names so that the list cannot drift from the code.

### Data and first admin

`pnpm run dev:data` refuses non-loopback `API_BASE_URL`. The demo uses the seeded test accounts instead: an `ops` one-shot task (the `postgres` client, `roles.sh` and `apps/identity-service/seed.mjs` in one image) creates the database roles and runs the seed, once before and once after the sample sites are imported so staff get site access. The CSVs from `data/import-samples/` are imported through the API as the seeded admin. `tools/aws-upload-media.mjs` uploads the images to the media bucket under the same content-hash keys the CSV expects.

### Security

- Terraform runs as an IAM user (profile `pharmacy`) with a long-lived key, because an apply that creates RDS outlives a one-hour `aws login` session. Delete the key and the user when the stack is destroyed.
- Security groups follow the README: only the ALB reaches tasks, only tasks reach RDS, Redis, MQ and Typesense. None of the data stores has a public address.
- State is local in `deploy/aws/terraform.tfstate`, which is git-ignored; it contains the generated secrets. A remote S3 backend is out of scope.
- CSRF and trusted headers are unchanged ([ADR 0006](../adr/0006-edge-identity-context.md)).

### Cost (us-east-1, 730 h/month, list prices, approximate)

| Item | Before | After | Why it changed |
| --- | --- | --- | --- |
| Fargate: 14 task-units of 0.25 vCPU / 0.5 GiB | 126 | 126 | sales-service and Typesense shrank by one unit each; RabbitMQ added two |
| NAT gateway | 33 | 33 | Still used by image pulls, the Lambda and outbound APIs |
| Application Load Balancers | 49 | 33 | One public ALB for both web apps instead of two |
| Public IPv4 addresses (ALB 2 each, NAT 1) | 18 | 11 | Two fewer ALB addresses |
| RDS PostgreSQL 20 GiB | 26 | 14 | `db.t4g.small` to `db.t4g.micro` |
| ElastiCache `cache.t4g.micro` | 12 | 12 | |
| RabbitMQ | 100 (Amazon MQ `mq.m7g.medium`) | in Fargate | The 18 USD of Fargate is counted above |
| Container Insights (393 metrics at 0.30) | 118 | 0 | Turned off |
| Secrets Manager (36 secrets at 0.40) | 14 | 1 | 34 moved to SSM parameters |
| Autoscaling alarms (36 at 0.10) | 4 | 0 | Removed; one task per service |
| CloudWatch Logs, S3, API Gateway, Lambda | about 5 | about 5 | Retention 30 to 7 days |
| **Total with services running** | **about 505** | **about 235** | |
| With `services_enabled = false` (RabbitMQ and Typesense keep running) | about 397 | about 136 | |

Not done, with the saving: Fargate Spot for the stateless services (about 70 USD, but a reclaimed task is a one to two minute outage), and replacing the NAT gateway with VPC endpoints or public-subnet tasks (about 25 USD, but it changes the network design). These are list prices, not a quote. The stack has no budget alarm.

## Alternatives considered

- **One EC2 instance running `docker compose`.** About 60 USD a month, 8 USD stopped, about 150 lines of Terraform, and it reuses the stack already tested. Rejected by the owner on 2026-10-26 in favor of the topology the repository already defines.
- **Fargate tasks in public subnets with public IPs instead of NAT.** Saves about 0 USD (a public IPv4 costs 3.65 USD a month per task), and drops the private-subnet model of `main.tf`. Rejected.
- **GHCR instead of ECR.** Needs a registry credential secret and a public or paid image path, and image pulls leave AWS. Rejected.
- **RabbitMQ on Fargate.** Cheaper by a few USD but loses queued events on restart. Rejected.
- **CloudFront and S3 for the web apps.** Cheaper and needs no containers, but the account could not create distributions. Rejected for the demo.

## Rollout and migration

1. Create the IAM user and its access key, and set `AWS_PROFILE`.
2. `terraform apply` with `services_enabled = false`: network, data tier, ECR, S3, web ALB, API Gateway, task definitions. The apply pauses at `aws_acm_certificate_validation` until the DNS records exist, so first run `terraform apply -target=aws_acm_certificate.web`, add the records in Cloudflare, then apply everything.
3. `tools/aws-push-images.mjs <tag>`, then re-apply with `-var image_tag=<tag>` so the task definitions reference it.
4. Run the roles task, then the seven migration tasks (README, step 2).
5. `terraform apply` with `services_enabled = true`.
6. `tools/aws-upload-media.mjs`; import the sample data in staff-web (README, Loading data); run the `ops` seed task again.
7. Teardown: `terraform destroy`. Rollback of a bad release is a previous `image_tag`.

## Testing

- `terraform fmt -check`, `terraform validate`, and `terraform plan` against the real account before any apply (the plan is the review artifact).
- After apply: `GET /api/auth/setup-status` through the customer URL, sign in, create an order, check `/api/system` as Platform Admin, and confirm every ECS service is `RUNNING` with a passing ALB health check.
- `tools/edge-identity-smoke.mjs` against the customer URL.

## Decisions from the owner (2026-10-26)

- The demo runs for 24 hours, then `terraform destroy` (about 8 USD a day).
- No email verification, password reset or Google sign-in. Seeded test accounts only.
- Map keys, delivery settings and SePay settings come from the root `.env`. The owner sets the SePay webhook URL (`POST <customer URL>/api/payments/sepay/webhook`) by hand.
- No OpenTelemetry collector, Managed Prometheus, Grafana or embedder. Services still require `OTEL_EXPORTER_OTLP_ENDPOINT`, `PROMETHEUS_URL` and `GRAFANA_PUBLIC_URL`, so they point at unreachable names: spans and metrics are dropped and the System page shows no metrics.

## Related ADRs

- [0006 Edge identity context](../adr/0006-edge-identity-context.md)
- [0007 Gateway path routing and two topologies](../adr/0007-gateway-path-routing-and-two-topologies.md)
- [0010 Fail-fast environment configuration](../adr/0010-fail-fast-environment-configuration.md)
- An ADR for the demo topology is written once this design is accepted.
