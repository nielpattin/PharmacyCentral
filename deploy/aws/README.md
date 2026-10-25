# AWS Fargate configuration

This directory contains configuration for a future AWS deployment. It is not connected to CI and no AWS resources are created by repository validation.

## Target topology

```text
staff-web/customer-web
        |
        v
AWS API Gateway HTTP API
        |
     VPC Link (managed security group, egress: ALB:80)
        |
internal Application Load Balancer (managed security group, ingress: VPC Link & Lambda:80, egress: Tasks:3001-3009)
        |
ECS Fargate services (managed security group, ingress: ALB & East-West:3001-3009, egress: outbound/NAT)
embedder ECS Fargate task (internal, self-hosted text embeddings; ingress from catalog-service and search-service tasks only, no ALB or API Gateway route)
        |
RDS PostgreSQL, Redis, RabbitMQ, Typesense, and Secrets Manager
```

The backend services use the same immutable image references as the existing container pipeline. The task definition exposes each service's current port and health endpoint. Cloud Map names provide private service-to-service DNS. PostgreSQL, Redis, RabbitMQ, and Typesense are supplied via Secrets Manager ARNs; this first stack does not provision those data services. Production needs a 3-node Typesense cluster or Typesense Cloud. The search index is a derived copy. catalog-service rebuilds it from PostgreSQL, so losing it costs a rebuild and no data.

## Networking and security groups

Terraform manages all security groups and traffic rules:

- **API Gateway VPC Link SG:** Restricts outbound egress to port 80 on the internal Application Load Balancer security group.
- **Internal Application Load Balancer SG:** Allows inbound HTTP on port 80 only from the VPC Link and authorizer Lambda security groups; forwards egress traffic to backend ECS tasks on ports 3001 through 3009.
- **ECS Tasks SG:** Allows inbound traffic on backend service ports 3001 through 3009 from the internal Application Load Balancer and task-to-task east-west traffic for Cloud Map service discovery; maintains outbound egress to `0.0.0.0/0` for third-party external APIs (such as SePay), managed data stores (PostgreSQL, Redis, RabbitMQ, Typesense), and NAT gateways.
- **Authorizer Lambda SG:** Resides in the private VPC subnets with outbound access to reach the internal ALB and AWS APIs via NAT or VPC endpoints.
- **Embedder SG:** Attached to the single embedder task. Its only ingress rule is HTTP on port 80 from the `embedder_client` SG, which Terraform attaches to the `catalog-service` and `search-service` tasks alone, so no other task can call the embedder. Egress is `0.0.0.0/0`, as for the ECS tasks SG, for image pulls, CloudWatch Logs, and Secrets Manager.

## Container images and secrets management

- **Private GHCR Authentication:** Task definitions and the task execution IAM role support an optional Secrets Manager ARN (`repository_credentials_secret_arn`) to authenticate with private container registries (such as GitHub Container Registry).
- **Secrets Manager ARN Maps:** Sensitive connection strings and credentials (`DATABASE_URL`, `RABBITMQ_URL`, `REDIS_URL`, `TYPESENSE_URL`, `TYPESENSE_API_KEY`, `SECRETS_ENCRYPTION_KEY`, `INTERNAL_IDENTITY_SECRET`, `INTERNAL_SERVICE_SECRET`, and `SEPAY_WEBHOOK_SECRET`) are configured as Secrets Manager ARN maps (`shared_secrets` and `service_secrets`) and injected at container launch rather than stored as plaintext in `service_environment`.
- **Task size:** backend services share `task_cpu` (512) and `task_memory` (1024 MiB). `sales-service` takes every order and runs its outbox relay, so `sales_task_cpu` (1024) and `sales_task_memory` (2048 MiB, a valid Fargate pair) override the shared size for it.
- **Database roles:** each `DATABASE_URL` secret should name a role that owns only that service's database and has no `CONNECT` on the others. Terraform does not create the RDS tier; create the roles with the SQL that `deploy/local/postgres/roles.sh` runs.
- **AI provider settings:** Terraform sets the four `AI_EMBEDDING_*` variables on `catalog-service` and `search-service`: provider `openai-compatible`, the internal embedder URL, the model, and the key from `embedder_api_key_secret_arn`. Every other `AI_<FEATURE>_*` variable stays out of Terraform. A Platform Admin sets each feature's provider, model, base URL and API key in staff-web. `chatbot-service`, `sales-service`, and `catalog-service` each keep theirs encrypted in their own database. They need `SECRETS_ENCRYPTION_KEY` (32 random bytes, base64) in `service_secrets`. Give the three services the same secret so that one value protects all three. Replacing it does not re-encrypt what is stored, so the saved keys become unreadable and an admin must enter them again. Production leaves every other `AI_<FEATURE>_*` variable unset, so the admin page is the only place those settings live. A setting saved by an admin still overrides the `AI_EMBEDDING_*` values that Terraform sets.
- **Authorizer Secrets Wiring:** Authorizer secret ARNs (`authorizer_secrets`, such as `INTERNAL_IDENTITY_SECRET` and `INTERNAL_SERVICE_SECRET`) are wired directly into the authorizer Lambda function environment variables and permitted in the authorizer IAM execution policy.
- **Lambda Runtime:** Lambda functions (authorizer and CSRF token generator) use the Node.js 22 runtime (`nodejs22.x`).

## ECS database migration workflow

Backend services maintain Drizzle migrations under `apps/<service>/drizzle/migrations`. Procurement tables now belong to the `inventory` database. If an environment already has a separate procurement database, copy its purchase-order and goods-receipt data into the inventory database before deleting that database. This repository has no deployed AWS environment. To prevent race conditions and schema corruption during horizontal autoscaling and deployments:

- **Long-Running Service CMD Override:** The long-running Node service task definitions override the container command with `["node", "dist/main.js"]`. `search-service` is a Go binary: its task definition keeps the image's own entrypoint and user, it has no migration task, and its ECS health is the ALB target group check on `/healthz`. Multiple replicas will never execute concurrent migrations when starting or scaling up.
- **One-Shot Migration Task Definitions:** Each Node backend service that owns a database has a dedicated migration task definition (`${environment_name}-${service}-migration`) configured with the exact same immutable container image, environment variables, Secrets Manager ARNs (`DATABASE_URL`, etc.), VPC network configuration, and CloudWatch log groups, but overriding the entry command to `["node", "dist/migrate.js"]`. `search-service` reads only Typesense and `ops-console-service` has no database, so neither has a migration task definition.
- **Infrastructure Phasing via `services_enabled`:** The `services_enabled` variable (boolean, defaults to `false`) gates the creation of long-running ECS services and Application Auto Scaling policies. This allows provisioning VPC resources, ALBs, Cloud Map namespaces, IAM roles, log groups, and task definitions before starting backend services.

## Self-hosted product search embedder

The embedder is a separate ECS Fargate service, not a backend service. It has no database, no migration task, no ALB target group, no API Gateway route, and no autoscaling:

- **Image:** `deploy/embedder/Dockerfile` builds on the pinned text-embeddings-inference CPU image and bakes in `intfloat/multilingual-e5-small` at a pinned revision. Fargate has no persistent volume, so the task never downloads the model. Pass the image as `embedder_image` with its `@sha256:` digest.
- **Sizing:** `embedder_task_cpu` (default 2048) and `embedder_task_memory` (default 4096 MiB) form a valid Fargate pair. The task runs one replica and deploys with the new task started before the old one stops.
- **API key:** `embedder_api_key_secret_arn` is a Secrets Manager ARN. The task reads it as `API_KEY`, and catalog-service and search-service read the same secret as `AI_EMBEDDING_API_KEY`. No value appears in Terraform.
- **Health:** the container health check calls `/health` on port 80 and has a 300 second start period for the model load.

The operating steps (building and pushing the image, creating the secret, checking the health endpoint, and the fallback to keyword search) are in `docs/Runbooks.md`, section "Self-hosted product search embeddings", subsection "On AWS".

## OpenTelemetry collector and metrics

Every service requires `OTEL_EXPORTER_OTLP_ENDPOINT`. `telemetry.tf` creates what it points at:

- **Collector:** one ECS Fargate task (`otel-collector`, 0.5 vCPU, 1 GiB) running the pinned image `otel_collector_image` (an `@sha256` reference). Its config is `deploy/aws/otel/collector.yaml`, passed in `AOT_CONFIG_CONTENT`. It listens on OTLP/HTTP 4318 and is reachable through Cloud Map as `otel-collector.<environment>.pharmacy.internal`. Set `OTEL_EXPORTER_OTLP_ENDPOINT` of the services to `http://otel-collector.<environment>.pharmacy.internal:4318`. Only the backend task security group may reach it.
- **Metrics:** remote write with SigV4 to the Amazon Managed Prometheus workspace created in the same file. **Traces:** X-Ray. **Logs:** the CloudWatch log group `/otel/<environment>/logs`.
- One task means telemetry is lost while it restarts; the services keep running.
- **System page on AWS:** the System page reads health, queues and the search index itself. Traces, logs and the RED charts are in Grafana, and this stack has no Grafana data source for X-Ray or CloudWatch Logs unless one is added there.
- **Open limit:** nothing reads the workspace yet. `ops-console-service` cannot query it without a SigV4 proxy, and no Managed Grafana is provisioned. Cost of the workspace was not estimated.
- Tested: `terraform validate`, and the collector config started in the pinned image (v0.158.0) with a read-only root filesystem, answering OTLP POST with 200 and `/healthcheck` with 200. Not tested: a real `apply`, so the writes to AMP, X-Ray and CloudWatch are unverified.

## Operational runbook (no-apply guide)

This repository does not configure remote state or live AWS credentials and must not run `terraform apply` during local validation. Use the following runbook when deploying to a live AWS account.

### Step 1: Provision base infrastructure with services disabled

Set `services_enabled = false` (the default) to create networking, IAM roles, load balancers, Cloud Map namespaces, and task definitions without starting the service replicas:

```bash
# Initialize Terraform
terraform init

# Generate plan with services disabled
terraform plan -var="services_enabled=false" -out=tfplan

# Apply base infrastructure
terraform apply tfplan
```

### Step 2: Run one-shot database migrations

Retrieve the cluster name, security groups, and subnets from Terraform outputs, then execute the migration task definitions for each backend service using the AWS CLI:

```bash
CLUSTER_NAME=$(terraform output -raw ecs_cluster_name)
SECURITY_GROUP=$(terraform output -raw ecs_tasks_security_group_id)
SUBNET_1=$(terraform output -json private_subnet_ids | jq -r '.[0]')
SUBNET_2=$(terraform output -json private_subnet_ids | jq -r '.[1]')

SERVICES=(
  "identity-service"
  "catalog-service"
  "inventory-service"
  "sales-service"
  "payment-service"
  "operations-query-service"
  "chatbot-service"
)

for SERVICE in "${SERVICES[@]}"; do
  echo "Starting migration task for ${SERVICE}..."
  TASK_DEF="pharmacy-central-staging-${SERVICE}-migration"

  TASK_ARN=$(aws ecs run-task \
    --cluster "${CLUSTER_NAME}" \
    --task-definition "${TASK_DEF}" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_1},${SUBNET_2}],securityGroups=[${SECURITY_GROUP}],assignPublicIp=DISABLED}" \
    --query "tasks[0].taskArn" \
    --output text)

  echo "Waiting for ${TASK_DEF} (${TASK_ARN}) to complete..."
  aws ecs wait tasks-stopped --cluster "${CLUSTER_NAME}" --tasks "${TASK_ARN}"

  EXIT_CODE=$(aws ecs describe-tasks \
    --cluster "${CLUSTER_NAME}" \
    --tasks "${TASK_ARN}" \
    --query "tasks[0].containers[0].exitCode" \
    --output text)

  if [ "${EXIT_CODE}" != "0" ]; then
    echo "Migration for ${SERVICE} failed with exit code ${EXIT_CODE}."
    aws logs get-log-events \
      --log-group-name "/ecs/pharmacy-central-staging/${SERVICE}" \
      --log-stream-name "migration/${SERVICE}-migration/$(basename ${TASK_ARN})" \
      --limit 50
    exit 1
  fi

  echo "Migration for ${SERVICE} succeeded."
done
```

### Step 3: Enable long-running ECS services and autoscaling

After all database migrations complete successfully, enable the long-running ECS services and autoscaling targets:

```bash
# Generate plan with services enabled
terraform plan -var="services_enabled=true" -out=tfplan

# Apply plan to start ECS services
terraform apply tfplan
```

### Step 4: Subsequent release workflow

When releasing application updates that include schema migrations:

1. Build and push new container images with immutable digest tags (`image@sha256:...`).
2. Update the `images` map in `terraform.tfvars`.
3. Apply Terraform with `services_enabled=true` to register the new task definition revisions.
4. Run the one-shot migration task definition for each updated service using `aws ecs run-task`.
5. Wait for migration tasks to exit with code 0.
6. The ECS service rolling update will deploy the new service task definition revision across replicas without migration race conditions.

## Terraform outputs

The configuration exports the following outputs for deployment and operational orchestration:

| Output | Description |
| --- | --- |
| `api_gateway_url` | Public API endpoint for API Gateway HTTP API. |
| `ecs_cluster_name` | Name of the ECS cluster hosting backend services. |
| `internal_load_balancer_dns_name` | Private ALB DNS name for path-based routing. |
| `ecs_tasks_security_group_id` | Security group ID for ECS Fargate service and migration tasks. |
| `private_subnet_ids` | Private VPC subnets used for task execution. |
| `service_task_definition_arns` | Map of long-running ECS service task definition ARNs. |
| `migration_task_definition_arns` | Map of one-shot migration task definition ARNs. |
| `migration_task_definition_families` | Map of migration task definition family names. |
| `ecs_service_names` | Map of active ECS service names (populated when `services_enabled = true`). |
| `services_enabled` | Current status of the `services_enabled` flag. |
| `service_discovery_namespace` | Cloud Map private DNS namespace (`staging.pharmacy.internal`). |
| `authorizer_lambda_function_name` | Name of the API Gateway request authorizer Lambda. |
| `csrf_lambda_function_name` | Name of the CSRF token generator Lambda. |
| `embedder_service_name` | Name of the embedder ECS service (populated when `services_enabled = true`). |
| `embedder_task_definition_arn` | Task definition ARN of the self-hosted product search embedder. |
| `embedder_internal_url` | Private base URL that catalog-service and search-service call, `http://embedder.<environment>.pharmacy.internal:80/v1`. |
| `embedder_security_group_id` | Security group of the embedder task. |
| `embedder_client_security_group_id` | Security group attached to catalog-service and search-service tasks, the only clients of the embedder. |
| `prometheus_workspace_id` | Amazon Managed Prometheus workspace that receives the metrics. |
| `prometheus_query_endpoint` | Query endpoint of that workspace. Queries need SigV4. |

## Configuration inputs

Copy `terraform.tfvars.example` to a private environment file and replace every placeholder. Do not commit that file. Values include:

- Existing VPC and private subnets (`vpc_id`, `private_subnet_ids`, `api_gateway_subnet_ids`)
- Immutable image digests (`images`)
- Embedder image digest and its API key Secret ARN (`embedder_image`, `embedder_api_key_secret_arn`)
- Optional private repository credentials Secret ARN (`repository_credentials_secret_arn`)
- Private service environment variables (`service_environment`)
- Secrets Manager ARNs (`shared_secrets`, `service_secrets`, `authorizer_secrets`)
- Browser origins and environment name (`allowed_origins`, `environment`)

The authorizer is required. It validates the current session contract, authorizes roles and sites, validates CSRF for browser mutations, and returns these values in its authorizer context:

```text
signedIdentityContext
actorId
actorType
```

The API Gateway integration maps those values to the trusted headers consumed by the services (`x-internal-identity-context`, `x-actor-id`, `x-actor-type`, `x-request-id`) and overwrites client-supplied trusted headers. The authorizer allows public routes while producing a signed system identity context so public services pass their trusted-request guard.

The `ANY /api/{proxy+}` route strips `/api` before sending the request to the internal load balancer. The load balancer routes the remaining path to the service that owns it. The SePay webhook uses a passthrough integration that preserves the raw request body and `x-sepay-signature`.

### Path routing map

The internal ALB sees paths without `/api`. Rules are evaluated by priority, lowest number first:

| Priority | Public path (`/api` + ALB path) | Target |
| --- | --- | --- |
| 10 | `/auth*`, `/admin*`, `/customers*` | identity-service |
| 15 | `GET /products` only (exact path and method; `/api/products` list) | search-service |
| 20 | `/sites*`, `/storage-locations*`, `/products*`, `/suppliers*`, `/pricing*`, `/stores*`, `/availability*` | catalog-service |
| 30 | `/procurement*` | inventory-service |
| 40 | `/inventory*`, `/quality*` | inventory-service |
| 50 | `/carts*`, `/orders*`, `/delivery*`, `/prescriptions*`, `/counter-transactions*` | sales-service |
| 60 | `/payments*` | payment-service |
| 70 | `/operations*`, `/dashboard*`, `/finance*`, `/audit*`, `/reports*` | operations-query-service |
| 80 | `/chatbot*` | chatbot-service |
| 90 | `/system*` | ops-console-service |

The `GET /products` rule matches only the list endpoint. `GET /api/products/{id}`, `POST /api/products`, and every other method on `/api/products*` fall through to the catalog-service rule at priority 20.

## Safe local validation

Terraform is not required by the Node workspace. When Docker or Terraform is available, run these commands:

```bash
docker run --rm -v "${PWD}/deploy/aws:/workspace" -w /workspace hashicorp/terraform:latest init -backend=false
docker run --rm -v "${PWD}/deploy/aws:/workspace" -w /workspace hashicorp/terraform:latest fmt -check
docker run --rm -v "${PWD}/deploy/aws:/workspace" -w /workspace hashicorp/terraform:latest validate
```

Do not run `terraform apply` as part of local validation. This repository does not include a remote state backend or AWS credentials configuration.

## Migration status

The custom Express gateway has been removed. Local web containers require `API_BASE_URL` to point to an available AWS API Gateway endpoint. This repository only defines the AWS resources, so browser API flows remain unavailable until that infrastructure is provisioned outside repository validation.
