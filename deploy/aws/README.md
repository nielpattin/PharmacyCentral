# AWS Fargate deployment

Terraform for a short-lived staging stack in one region (`aws_region`, default `us-east-1`). It is not connected to CI. Design and decisions: `docs/design/0006-aws-demo-deployment.md`; diagram: `docs/diagrams/aws-architecture.drawio`.

## Topology

```text
browser ── https://shop.<domain>  ─┐
        └─ https://staff.<domain> ─┴─> public ALB (host rules) ──> customer-web, staff-web (nginx, Fargate)
                                                                                    │ /api/...
                                                                                    v
                                   API Gateway HTTP API (forwards Authorization)
                                                                  |
                                                       VPC Link ──> internal ALB (path rules)
                                                                  |
                                       ECS Fargate services (Cloud Map: <environment>.pharmacy.internal)
                                                                  |
                         RDS PostgreSQL, ElastiCache Redis, RabbitMQ task, Typesense task, S3 media bucket
```

- The two web apps have separate hostnames so their `localStorage` tokens never meet (each origin has its own). One public ALB serves both through host rules; TLS ends there with an ACM certificate, and port 80 redirects to 443.
- The web containers proxy `/api` to API Gateway. API Gateway forwards the `Authorization` header untouched and overwrites only the path and `x-request-id`. Each service verifies the bearer access token against the JWKS of identity-service (`IDENTITY_JWKS_URL`).
- The SePay webhook (`POST /api/payments/sepay/webhook`) has its own route that forwards only the path and `x-request-id`. payment-service ignores the identity headers on it.
- RabbitMQ is a Fargate task (`rabbitmq.<environment>.pharmacy.internal`) with its queues on ephemeral task storage, because Amazon MQ has no RabbitMQ 4 broker below `mq.m7g.medium` (about 100 USD a month). A restart loses only events that were queued and not yet consumed.
- Typesense is a Fargate task with an empty task volume at `/data`. The index is a derived copy that catalog-service rebuilds from PostgreSQL.
- `embedder_enabled` and `otel_collector_enabled` default to `false`. Search then uses keyword matching, and the System page shows no metrics.
- Task sizes (`variables.tf`, sized to the 6 vCPU Fargate quota): backend, migration and ops tasks run `task_cpu` 512 / `task_memory` 2048 MiB (0.5 vCPU, 2 GB); customer-web and staff-web run `web_task_cpu` 256 / `web_task_memory` 512 MiB; RabbitMQ runs 256 / 512 and Typesense 256 / 512, all valid Fargate pairs. The embedder keeps its own 2048 / 4096 (`embedder_task_cpu`, `embedder_task_memory`); it is off by default and would add 2 vCPU when on.
- Desired counts (autoscaling off, the default): every ECS service runs 1 task. `desired_count` (1) applies to all of them, and `service_desired_count` is an optional per-service override (empty by default). The count applies on every apply because the ECS services set `desired_count` from these variables.
- Why autoscaling is off: the stack must stay within the 6 vCPU quota, and scale-out would add 0.5 vCPU per backend task. `autoscaling.tf` keeps the ECS Application Auto Scaling target tracking code (average CPU `autoscale_cpu_target_percent` and memory `autoscale_memory_target_percent`, between `autoscale_min_capacity` and `autoscale_max_capacity`). Set `autoscaling_enabled = true` only with a quota that covers the maximum. While it is on, the ECS service leaves `desired_count` unset and the scalable target owns the count.
- vCPU budget at the fixed counts: 9 backend x 0.5 = 4.5, 2 web x 0.25 = 0.5, RabbitMQ 0.25, Typesense 0.25. Total long-running 5.5 vCPU of the 6 vCPU On-Demand Fargate quota (`L-3032A538`). That leaves 0.5 vCPU, enough for one one-shot migration or ops task (0.5 vCPU) at a time. Run the migration and ops tasks one at a time.
- Rolling deploys stop before they start: `deployment_minimum_healthy_percent` 0 and `deployment_maximum_percent` 100 on every ECS service, so a deploy never runs more tasks than desired and stays within the quota. The cost is a brief outage per service while its single old task stops and the new task becomes healthy. Expect it on each release.
- A quota increase request (24 vCPU, id `b83f3c4366164a97a770b833bd25372bgmHz9ka3`) was filed and is PENDING. This stack does not rely on it; it is sized for 6 vCPU.
- `grafana_enabled` (default `true`) runs Grafana on Fargate at `grafana.<domain_name>` (0.25 vCPU, 1 GB) behind the web ALB. It reads CloudWatch with its task role and opens on the dashboard `Pharmacy Central - AWS` (API Gateway, load balancers, ECS, RDS, ElastiCache). Sign in as `admin`; the password is the SSM parameter `/<environment>/grafana/admin-password`. It leaves 0.25 vCPU of the 6 vCPU quota, so set `grafana_enabled = false` before a migration or `ops` task that needs 0.5 vCPU.
- RabbitMQ and Typesense are sized for the demo load. Container Insights is off, and logs are kept `log_retention_in_days` (7) days. RDS is `db.t4g.micro`.

Security groups: the VPC Link reaches only the internal ALB; the internal ALB accepts the VPC Link and forwards to the task ports 3001-3010; tasks accept the ALB and each other (Cloud Map) and reach the internet through NAT.

## Images and secrets

- `registry.tf` creates one ECR repository per service plus `ops`, with immutable tags. A tag can never be pushed twice. GitHub Actions builds and pushes the images when a version tag is pushed (`git tag vX.Y.Z && git push origin vX.Y.Z`), and `cloud:deploy` deploys the latest version tag without building anything on this machine.
- `node tools/aws-push-images.mjs <tag>` builds the backend images for `linux/amd64` and the `ops` image, then pushes them. Set the same tag with `-var image_tag=<tag>`.
- `node tools/aws-env.mjs [tag]` writes `demo.auto.tfvars.json` (git-ignored, holds secrets) from the root `.env`: service settings, map keys, delivery and SePay values.
- Terraform generates the database, broker and internal secrets and stores them as SSM SecureString parameters. `ACCESS_TOKEN_PRIVATE_KEY`, `ACCESS_TOKEN_PUBLIC_JWK` and `ACCESS_TOKEN_KEY_ID` (the identity-service signing key) travel the same way through `demo.auto.tfvars.json`: run `pnpm run auth:keygen` once, put the three lines it prints in the root `.env`, then run `node tools/aws-env.mjs`. Every other service except search-service gets `IDENTITY_JWKS_URL` from Terraform and fetches the public key from identity-service. Task definitions read them as ECS secrets; the execution role is limited to those ARNs.
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

A release with a new tag repeats the push, a `plan` review, the migration tasks for services whose schema changed, and the apply with `services_enabled=true`. The ECS deployment stops the old task before starting the new one (stop-before-start, see Task sizes), so each service is briefly down during a release.

## Loading data

`pnpm run cloud:seed` (`tools/aws-seed.mjs`) loads the whole demo dataset into the stack, after the default seed (A) and with the services running. It is `tools/seed-demo.mjs` pointed at the deployed stack (`DEMO_SEED_TARGET=cloud`):

- The API calls go to `https://staff.<domain>/api`, the path the browser uses. The passwords and the SePay secret come from the root `.env`, the values the stack was deployed with.
- `tools/aws-upload-media.mjs` puts `data/product-images/images` in the media bucket and writes `tmp/aws-demo/products.csv` with the image URLs moved to the public media base URL. The seed imports that copy.
- RDS is private, so the demo accounts (`ops` task, `node /ops/seed-demo.mjs`) and the SQL that backdates the sales history (`tools/lib/aws-ops.mjs`) run in the one-shot `ops` task, sized 0.25 vCPU so it fits next to the running stack in the 6 vCPU quota. The SQL goes through a short-lived presigned URL on the media bucket, and its output comes back from CloudWatch Logs.
- It is safe to run again: every step is idempotent, and a history that exists is left as it is. To start from empty data, `terraform destroy` the database or recreate the databases with the `ops` task, then seed again.

`pnpm run cloud:deploy:fresh` runs it as its last step.

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
```

`terraform destroy -var domain_name=<domain> -var image_tag=<tag>` removes everything, ECR repositories included. Delete the DNS records afterwards. NAT, RDS, ElastiCache, the ALBs and the Fargate tasks bill while the stack runs; see the cost table in the design.

## Idle mode (cut cost, keep data, resume later)

Full destroy loses the RDS data. For a pause, keep the cheap, stateful pieces and remove only the hourly billers.

Keep (free or nearly free when idle): VPC, subnets, security groups, DB subnet group, RDS instance (stopped), ECR, SSM, S3, IAM, log groups.

Remove (cannot be paused): NAT gateway and EIP, both ALBs, ElastiCache (cache only, no durable data), the ECS services (desired count 0 or destroy).

Pause:

```bash
aws rds stop-db-instance --db-instance-identifier pharmacy-central-staging
terraform destroy -target=aws_lb.internal -target=aws_lb.web -target=aws_elasticache_cluster.this \
  -target=aws_nat_gateway.this -target=aws_eip.nat   # plus -var flags as in Release workflow
```

Resume:

```bash
aws rds start-db-instance --db-instance-identifier pharmacy-central-staging
aws rds wait db-instance-available --db-instance-identifier pharmacy-central-staging
export CLOUDFLARE_API_TOKEN=...   # DNS records are recreated by apply
terraform apply -var domain_name=<domain> -var image_tag=<tag> -var cloudflare_zone_id=<zone id>
```

Notes:

- `terraform apply` skips what still exists in state and creates only what is missing (ALBs, NAT, ElastiCache, ECS services, DNS). It never starts a stopped RDS: start it yourself first, or the ECS tasks cannot reach the database.
- RDS cannot stay stopped past 7 days; AWS starts it again automatically and bills the instance hours. Stop it again, or destroy it.
- A stopped RDS still bills storage and backups.
- ElastiCache and ALB have no stop state, so they are destroyed and recreated.
- Run `terraform apply` with the same variables as the original apply, or the plan will replace resources.
