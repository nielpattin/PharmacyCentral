# 0006. Low-cost AWS demo deployment

- **Status:** Accepted (owner answered the open questions on 2026-10-26)
- **Author:** @nielpattin
- **Date:** 2026-10-26

## Summary

`deploy/aws` defines the ECS Fargate, ALB and API Gateway tiers, but nothing around them, and it has never been applied. This design adds what a first `terraform apply` needs in `us-east-1`: a VPC, the data stores, container images, the two web apps, and a demo-sized configuration. The aim is a demo that runs, not a production environment. Every service in `apps/` is affected only through environment variables; no application code changes except as listed under Open questions.

## Motivation

- [deploy/aws/README.md](../../deploy/aws/README.md) says the stack "does not provision" PostgreSQL, Redis, RabbitMQ or Typesense, and its last line of testing is "Not tested: a real apply".
- The account (`539792719878`, `us-east-1`) has one default VPC with public subnets only, no NAT, and no ECS, RDS or EC2 resources. The Fargate On-Demand quota is 6 vCPU.
- `terraform.tfvars.example` lists only service URLs. The services fail fast on missing variables (AGENTS.md), so most would stop at startup. For example `catalog-service` requires the S3 media settings (`AWS_ENDPOINT_URL_S3`, `MEDIA_BUCKET`, and the rest) for product media, `identity-service` requires `PUBLIC_APP_URL` and the mail settings, `sales-service` requires the delivery and map settings, and `payment-service` requires `PHARMACY_PAYMENT_SEPAY_*`.
- The defaults (`desired_count = 2`, 512 CPU / 1024 MiB per service, a 2 vCPU embedder, an OpenTelemetry collector with Managed Prometheus) cost far more than a demo needs.
- Staff-web and customer-web have no hosting in Terraform; their `nginx-entrypoint.sh` proxies `/api` to `API_BASE_URL`.

## Goals

- `terraform apply` from a clean account produces a working stack: sign in as the admin and create the sites, sign in as a Pharmacy Manager to import the master data, place an order, see it in staff-web.
- A monthly cost of about 335 USD with services running, about 126 USD with `services_enabled = false` between demos (see Cost).
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

A new VPC `10.20.0.0/16` with two public and two private subnets in two AZs, an internet gateway and **one** NAT gateway. The existing variables `vpc_id`, `private_subnet_ids`, `api_gateway_subnet_ids` are replaced by references to these resources (clean cutover: no input variables for networking remain). The default VPC is not touched. Private subnets let tasks keep `assignPublicIp = DISABLED` as `main.tf` already sets; the single NAT also serves image pulls.

### Data tier (`data.tf`)

| Need | Choice | Why |
| --- | --- | --- |
| PostgreSQL | RDS `db.t4g.micro`, engine 18.x, 20 GiB gp3, single AZ, one instance, seven databases | The local stack uses PostgreSQL 18 with PostGIS; RDS 18 supports PostGIS. Measured memory use of every service is under 30 percent of its task, and the staging stack has almost no traffic |
| Roles | One-shot ECS task from the `postgres:18` image that runs `deploy/local/postgres/roles.sh` logic against RDS | RDS is private; the task runs inside the VPC. Same SQL as local |
| Redis | ElastiCache `cache.t4g.micro`, one node | Used by identity-service and sales-service |
| RabbitMQ | One Fargate task (`rabbitmq:4.3.5-management`, 256 CPU / 512 MiB), Cloud Map name `rabbitmq`, ephemeral storage | Amazon MQ offers RabbitMQ 4 only from `mq.m7g.medium`, about 100 USD a month, about eleven times the cost of the Fargate task that replaces it. The services declare their queues on connect; a restart loses only events that were queued and not yet consumed |
| Typesense | One Fargate task (`typesense/typesense` pinned by digest, 256 CPU / 512 MiB), Cloud Map name `typesense`, empty task volume at `/data` | The index is a derived copy; catalog-service rebuilds it (README). Not HA, by design |
| Product media | S3 bucket + IAM user key for catalog-service | `catalog-service` talks S3 with `forcePathStyle` and static keys (`product-media-store.ts`), so `AWS_ENDPOINT_URL_S3 = https://s3.us-east-1.amazonaws.com` works unchanged |

Connection strings and keys are written by Terraform as SSM SecureString parameters, which cost nothing. Terraform generates 29 of them from the resources' own outputs (`random_password` for database and broker passwords): 11 shared (broker, Redis, Typesense, internal service secret, encryption key and the embedder key), 9 for the `ops` task (the admin password and connection, and the seven database passwords), 7 `DATABASE_URL`, and the 2 catalog media keys. The operator supplies the rest through `demo.auto.tfvars.json`, which `tools/aws-env.mjs` fills from the root `.env`: the two `ops` seed passwords, the third-party API keys, and the identity-service access token signing values (`ACCESS_TOKEN_PRIVATE_KEY`, `ACCESS_TOKEN_PUBLIC_JWK`, `ACCESS_TOKEN_KEY_ID`, generated once by `pnpm run auth:keygen`). With the three `ACCESS_TOKEN_*` values and the six API-key and webhook secrets the file holds today, that is 40 parameters in all. No Secrets Manager secret exists.

### Images (`registry.tf`)

One ECR repository per service plus `ops`, none for the embedder, with immutable tags. `tools/aws-push-images.mjs <tag>` builds the images from the existing Dockerfiles for `linux/amd64` and pushes them as `<tag>`; the `image_tag` variable selects them. Tags are `staging-<git short SHA>`, and a tag is never reused. GHCR credentials are not needed.

### Web (`web.tf`)

One public ALB with a host rule per app, each rule in front of one Fargate task that runs the existing web image (nginx proxies `/api` to the API Gateway URL). Two hostnames keep the staff and customer cookies apart (AGENTS.md: the apps must not share a host): `shop.<domain_name>` and `staff.<domain_name>`. CloudFront was dropped because the account could not create distributions without an AWS Support verification. One ACM certificate covers both hosts; the DNS stays in Cloudflare (DNS only) and Terraform manages it with the Cloudflare provider: the certificate validation records and the two CNAMEs to the ALB are created by the same apply and removed by a destroy, so no record points at an ALB that is gone. The token needs DNS Write on that one zone only. HTTPS is terminated at the ALB, port 80 redirects to 443, and `COOKIE_SECURE` is true. `PUBLIC_APP_URL` comes from the hostname. Product images are read straight from a public `product-images/*` prefix of the media bucket.

### Demo sizing (`variables.tf`, `main.tf`)

- `task_cpu = 512`, `task_memory = 2048` for each of the nine backend services and for the migration and `ops` tasks; `web_task_cpu = 256`, `web_task_memory = 512` for the two web tasks; RabbitMQ and Typesense at 256 / 512. `desired_count = 1`, `autoscaling_enabled = false` (no scaling policies or alarms), Container Insights off, log retention 7 days. Nine backend tasks plus four small tasks use 5.5 of the 6 vCPU Fargate quota, and a migration or `ops` task adds 0.5 vCPU while it runs.
- `embedder_*` and the OpenTelemetry collector (`telemetry.tf`) become optional (`count` on a boolean, default `false`). When the embedder is off, the four `AI_EMBEDDING_*` variables are not set on `catalog-service` and `search-service` (the group is all-or-none, AGENTS.md). Their `OTEL_EXPORTER_OTLP_ENDPOINT` is required by the services, so it points at a no-op address supplied through `service_environment`; see Open questions.
- Service-specific variables the code requires (identity, sales, payment, chatbot, ops-console) get a documented block in `terraform.tfvars.example`, filled by `tools/aws-env.mjs` from `.env.example` names so that the list cannot drift from the code.

### Data and first admin

The demo seed (`pnpm run seed:demo`) refuses non-loopback `API_BASE_URL`, so the demo loads AWS another way. An `ops` one-shot task (the `postgres` client, `roles.sh` and the identity seeds in one image) creates the database roles and runs the default seed (A: the one admin, `ADMIN_PASSWORD`). The sample sites come first, created through the API (Platform Admin creates them one at a time, or a Pharmacy Manager imports `sites.csv`); then the same task runs `seed-demo.mjs` (B, accounts only, `DEMO_ACCOUNT_PASSWORD`) so staff get site access. The other CSVs from `data/import-samples/` are imported through the API by the role that owns each: a Pharmacy Manager for the storage locations, the suppliers and the products, Warehouse Staff for the opening balances. `tools/aws-upload-media.mjs` uploads the images to the media bucket under the same content-hash keys the CSV expects.

### Security

- Terraform runs as an IAM user (profile `pharmacy`) with a long-lived key, because an apply that creates RDS outlives a one-hour `aws login` session. Delete the key and the user when the stack is destroyed.
- Security groups follow the README: only the ALB reaches tasks, only tasks reach RDS, Redis, MQ and Typesense. None of the data stores has a public address.
- State is local in `deploy/aws/terraform.tfstate`, which is git-ignored; it contains the generated secrets. A remote S3 backend is out of scope.
- Authentication and trusted headers follow [ADR 0006](../adr/0006-jwt-access-tokens-verified-by-every-service.md): API Gateway forwards `Authorization` untouched and every service verifies the access token.

### Cost (us-east-1, 730 h/month, list prices, approximate)

| Item | Before | After | Why it changed |
| --- | --- | --- | --- |
| Fargate: 9 backend tasks (0.5 vCPU / 2 GiB) and 4 small tasks (0.25 vCPU / 0.5 GiB) | 126 | 227 | 9 x 21.26 + 4 x 9.01; the backend tasks are larger than the first sizing |
| NAT gateway | 33 | 33 | Still used by image pulls and outbound APIs |
| Application Load Balancers | 49 | 33 | One public ALB for both web apps instead of two |
| Public IPv4 addresses (ALB 2 each, NAT 1) | 18 | 11 | Two fewer ALB addresses |
| RDS PostgreSQL 20 GiB | 26 | 14 | `db.t4g.small` to `db.t4g.micro` |
| ElastiCache `cache.t4g.micro` | 12 | 12 | |
| RabbitMQ | 100 (Amazon MQ `mq.m7g.medium`) | in Fargate | The 9 USD of Fargate is counted above |
| Container Insights (393 metrics at 0.30) | 118 | 0 | Turned off |
| Secrets Manager (36 secrets at 0.40) | 14 | 0 | No Secrets Manager secret; 40 SSM parameters, which are free |
| Autoscaling alarms (36 at 0.10) | 4 | 0 | `autoscaling_enabled = false` creates no scaling policy or alarm; with it on, 9 services x 2 policies x 2 alarms is 36 alarms, about 4 |
| CloudWatch Logs, S3, API Gateway | about 5 | about 5 | Retention 30 to 7 days; 15 log groups |
| **Total with services running** | **about 505** | **about 335** | |
| With `services_enabled = false` (RabbitMQ and Typesense keep running) | about 397 | about 126 | Fargate falls to 2 x 9.01 = 18 |

Fargate is priced at 0.04048 USD per vCPU-hour and 0.004445 USD per GiB-hour, which gives 9.01 USD a month for a 0.25 vCPU / 0.5 GiB task and 21.26 USD for a 0.5 vCPU / 2 GiB task over 730 hours; these are the rates behind the 126 USD the earlier 14 small units cost. The other rows use the same basis: ALB 0.0225 USD an hour (two ALBs, the public web ALB and the internal one behind the VPC Link), NAT gateway 0.045 USD an hour, public IPv4 0.005 USD an hour (the web ALB has 2 addresses, the NAT 1), RDS `db.t4g.micro` 0.016 USD an hour plus 20 GiB of gp3 at 0.115 USD, ElastiCache `cache.t4g.micro` 0.016 USD an hour. NAT data processing and API Gateway request charges are not counted beyond the "about 5" row. The 15 log groups are 12 ECS groups (9 backend services, `ops`, RabbitMQ and Typesense), 2 web groups and 1 API Gateway access log; the embedder and the collector add 1 and 2 when enabled.

Not done, with the saving: Fargate Spot for the stateless services (about 150 USD, but a reclaimed task is a one to two minute outage), and replacing the NAT gateway with VPC endpoints or public-subnet tasks (about 25 USD, but it changes the network design). These are list prices, not a quote. The stack has no budget alarm.

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
6. `tools/aws-upload-media.mjs`; create the sites in staff-web as Platform Admin, run the `ops` task with `seed-demo.mjs` for the demo accounts, then import the sample data as the role that owns it: a Pharmacy Manager for the master data and Warehouse Staff for the opening balances (README, Loading data).
7. Teardown: `terraform destroy`. Rollback of a bad release is a previous `image_tag`.

## Testing

- `terraform fmt -check`, `terraform validate`, and `terraform plan` against the real account before any apply (the plan is the review artifact).
- After apply: `GET /api/auth/setup-status` through the customer URL, sign in, create an order, check `/api/system` as Platform Admin, and confirm every ECS service is `RUNNING` with a passing ALB health check.
- `tools/edge-identity-smoke.mjs` against the customer URL.

## Decisions from the owner (2026-10-26)

- The demo runs for 24 hours, then `terraform destroy` (about 11 USD a day).
- No email verification, password reset or Google sign-in. The default admin and, when loaded, the demo accounts only.
- Map keys, delivery settings and SePay settings come from the root `.env`. The owner sets the SePay webhook URL (`POST <customer URL>/api/payments/sepay/webhook`) by hand.
- No OpenTelemetry collector, Managed Prometheus, Grafana or embedder. Services still require `OTEL_EXPORTER_OTLP_ENDPOINT`, `PROMETHEUS_URL` and `GRAFANA_PUBLIC_URL`, so they point at unreachable names: spans and metrics are dropped and the System page shows no metrics.

## Related ADRs

- [0006 JWT access tokens verified by every service](../adr/0006-jwt-access-tokens-verified-by-every-service.md)
- [0007 Gateway path routing and two topologies](../adr/0007-gateway-path-routing-and-two-topologies.md)
- [0010 Fail-fast environment configuration](../adr/0010-fail-fast-environment-configuration.md)
- An ADR for the demo topology is written once this design is accepted.
