# AWS Fargate deployment

Terraform for a short-lived staging stack in one region (`aws_region`, default `us-east-1`). It is not connected to CI. Design and decisions: `docs/design/0006-aws-demo-deployment.md`; diagram: `docs/diagrams/aws-architecture.drawio`.

## Topology

```text
browser ── https://shop.<domain>  ─┐
        └─ https://staff.<domain> ─┴─> public ALB (host rules) ──> customer-web, staff-web (nginx, Fargate)
                                                                                    │ /api/...
                                                                                    v
                                            API Gateway HTTP API (request authorizer + CSRF Lambdas)
                                                                  |
                                                       VPC Link ──> internal ALB (path rules)
                                                                  |
                                       ECS Fargate services (Cloud Map: <environment>.pharmacy.internal)
                                                                  |
                         RDS PostgreSQL, ElastiCache Redis, RabbitMQ task, Typesense task, S3 media bucket
```

- The two web apps have separate hostnames so their session cookies never meet. One public ALB serves both through host rules; TLS ends there with an ACM certificate, and port 80 redirects to 443. `cookie_secure` (default `true`) sets `COOKIE_SECURE`.
- The web containers proxy `/api` to API Gateway. The authorizer resolves the session, checks roles, sites and CSRF, and signs the identity context that API Gateway writes into `x-internal-identity-context`. The signature is over the context in the services' schema key order, so `lambda/identity.mjs` must keep that order.
- The SePay webhook (`POST /api/payments/sepay/webhook`) has its own route with no authorizer. API Gateway drops empty header overrides, so payment-service strips the identity headers itself.
- RabbitMQ is a Fargate task (`rabbitmq.<environment>.pharmacy.internal`) with its queues on ephemeral task storage, because Amazon MQ has no RabbitMQ 4 broker below `mq.m7g.medium` (about 100 USD a month). A restart loses only events that were queued and not yet consumed.
- Typesense is a Fargate task with an empty task volume at `/data`. The index is a derived copy that catalog-service rebuilds from PostgreSQL.
- `embedder_enabled` and `otel_collector_enabled` default to `false`. Search then uses keyword matching, and the System page shows no metrics.
- Task sizes: every service runs one task of `task_cpu` 256 / `task_memory` 512 MiB, the Fargate minimum (`desired_count`); RabbitMQ has 512 / 1024. There is no autoscaling, Container Insights is off, and logs are kept `log_retention_in_days` (7) days. RDS is `db.t4g.micro`.

Security groups: the VPC Link reaches only the internal ALB; the internal ALB accepts the VPC Link and the authorizer Lambda and forwards to the task ports 3001-3010; tasks accept the ALB and each other (Cloud Map) and reach the internet through NAT.

## Images and secrets

- `registry.tf` creates one ECR repository per service plus `ops`, with immutable tags. A tag can never be pushed twice, so every build needs a new tag; use `staging-<git short SHA>`.
- `node tools/aws-push-images.mjs <tag>` builds the backend images for `linux/amd64` and the `ops` image, then pushes them. Set the same tag with `-var image_tag=<tag>`.
- `node tools/aws-env.mjs [tag]` writes `demo.auto.tfvars.json` (git-ignored, holds secrets) from the root `.env`: service settings, map keys, delivery and SePay values.
- Terraform generates the database, broker and internal secrets and stores them as SSM SecureString parameters, except the two internal secrets the authorizer Lambda reads, which stay in Secrets Manager. Task definitions read them as ECS secrets; the execution role is limited to those ARNs.
- Platform Admin AI settings stay in staff-web. `SECRETS_ENCRYPTION_KEY` is shared by chatbot-service, sales-service and catalog-service.

## Release workflow

Credentials come from an IAM user profile (`AWS_PROFILE`), not a session token: the apply that creates RDS runs for about 15 minutes. DNS is Terraform too: export `CLOUDFLARE_API_TOKEN` (a token with DNS Write on the one zone) before every plan, apply and destroy, and pass `-var cloudflare_zone_id=<zone id>` with the other variables.

```bash
cd deploy/aws
terraform init

# 1. Network, data stores, ECR, ALBs, task definitions; no services yet.
terraform apply -var domain_name=<domain> -var image_tag=<tag>
```

2. The same apply creates the DNS records in Cloudflare, DNS only: the ACM validation records and the `shop.` and `staff.` CNAMEs to the web ALB. A record that already exists is taken over, and a destroy removes them. Each new ALB has a new name, so the CNAMEs follow it on every apply. The apply waits for the certificate.
3. Push the images (`node tools/aws-push-images.mjs <tag>`), then run the one-shot tasks in the cluster (`ecs_cluster_name`, `private_subnet_ids`, `ecs_tasks_security_group_id`):
   - the `ops` task (`ops_task_definition`) creates the databases and roles (`ops/001-create-databases.sql`, `ops/roles.sh`);
   - each task in `migration_task_definitions` runs `node dist/migrate.js` and must exit 0;
   - the `ops` task with the command `node /ops/seed.mjs` runs the default seed (A): the one Platform Admin, with `ADMIN_PASSWORD`.
4. Start the services:

```bash
terraform apply -var domain_name=<domain> -var image_tag=<tag> -var services_enabled=true
```

A release with a new tag repeats the push, a `plan` review, the migration tasks for services whose schema changed, and the apply with `services_enabled=true`. The ECS rolling deployment starts the new tasks before stopping the old ones.

## Loading data

The demo seed (B, `pnpm run seed:demo`) refuses a non-loopback `API_BASE_URL`, so it cannot load AWS. Use these steps, after the default seed (A):

1. `node tools/aws-upload-media.mjs` (no `--env-file`: `.env` holds the local Floci dummy keys, and the script refuses to run with `AWS_ENDPOINT_URL_S3` set) uploads `data/product-images/images` to the media bucket under `product-images/<SKU>/<sha256>.<ext>` and writes `tmp/aws-demo/products.csv` with the image URLs moved to the public media base URL.
2. In staff-web, Data import: sites, storage locations, suppliers, `tmp/aws-demo/products.csv` (not the original), then the opening balances once the products are searchable.
3. Run the `ops` task with the command `node /ops/seed-demo.mjs` (needs `DEMO_ACCOUNT_PASSWORD`): it creates the demo staff and shopper accounts with their site access, so the sites must be imported first. Then add and approve the search synonym groups.

## Outputs

| Output | Use |
| --- | --- |
| `web` | `customer_url`, `staff_url`, `media_bucket`, `media_base_url` |
| `api_gateway_url` | API Gateway endpoint behind both web apps |
| `ecr_repository_urls` | ECR repository per service and `ops` |
| `ecs_cluster_name`, `private_subnet_ids`, `ecs_tasks_security_group_id` | inputs for one-shot tasks |
| `ops_task_definition`, `migration_task_definitions` | one-shot task definitions |

## Path routing map

The internal ALB sees paths without `/api`. Rules are evaluated by priority, lowest first. An ALB rule takes at most five path values, so the catalog paths use two rules.

| Priority | Path | Target |
| --- | --- | --- |
| 10 | `/auth*`, `/admin*`, `/customers*` | identity-service |
| 15 | `GET /products` (exact) | search-service |
| 20 | `/sites*`, `/storage-locations*`, `/products*`, `/suppliers*`, `/pricing*` | catalog-service |
| 25 | `/stores*`, `/availability*` | catalog-service |
| 30, 40 | `/procurement*`, `/inventory*` | inventory-service |
| 50 | `/carts*`, `/orders*`, `/delivery*`, `/prescriptions*`, `/counter-transactions*` | sales-service |
| 60 | `/payments*` | payment-service |
| 70 | `/operations*`, `/dashboard*`, `/finance*`, `/audit*`, `/reports*` | operations-query-service |
| 80 | `/chatbot*` | chatbot-service |
| 90 | `/system*` | ops-console-service |

## Validation and teardown

```bash
terraform fmt -check -recursive
terraform validate
node --test lambda/tests/*.test.mjs
```

`terraform destroy -var domain_name=<domain> -var image_tag=<tag>` removes everything, ECR repositories included. Delete the DNS records afterwards. NAT, RDS, ElastiCache, the ALBs and the Fargate tasks bill while the stack runs; see the cost table in the design.
