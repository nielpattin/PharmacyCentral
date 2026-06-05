# Deployment package

This repository includes a local production-like deployment package for validation and handoff. It does **not** push images, publish infrastructure, or deploy to any external environment.

## Shape

The package builds one application image:

- Vite builds the React frontend.
- The compiled frontend is copied into `src/Web.Api/wwwroot` during the container build.
- `Web.Api` serves the API under `/api` and serves the frontend static files from the same container.
- PostgreSQL runs as a separate container in `docker-compose.yml`.

This matches the current application shape and avoids claiming cloud infrastructure that is not present in the repo.

## Files

- `Dockerfile` — multi-stage build for frontend + Web.Api runtime image.
- `docker-compose.yml` — local production-like app + PostgreSQL composition.
- `deploy/pharmacycentral.env.example` — non-secret environment template.
- `.github/workflows/build.yml` — CI build/test validation only; no publish or deployment step.

## Local build validation

From the repository root:

```bash
docker compose --env-file deploy/pharmacycentral.env.example build
```

## Local run validation

From the repository root:

```bash
docker compose --env-file deploy/pharmacycentral.env.example up
```

Then check:

```bash
curl http://localhost:8080/health
```

Open the web UI:

```text
http://localhost:8080
```

Stop the local containers:

```bash
docker compose --env-file deploy/pharmacycentral.env.example down
```

To remove the local PostgreSQL volume as well:

```bash
docker compose --env-file deploy/pharmacycentral.env.example down --volumes
```

## HTTPS and antiforgery note

The application requires secure cookie behavior for unsafe requests. For a real environment, run the container behind a TLS-terminating reverse proxy or platform load balancer and expose the application over HTTPS. The compose file is for local package validation, health checks, and handoff, not a complete internet-facing production stack.

## Secrets

Do not commit real secrets. Copy `deploy/pharmacycentral.env.example` to a local untracked file and replace values there.

## Database migrations

`Web.Api` applies EF Core migrations on startup. The app container must have a valid `ConnectionStrings__PharmacyCentral` value before it starts.

## CI behavior

The GitHub Actions workflow validates:

- backend restore/build
- frontend install/lint/type/build
- Docker image build

It does not push images, publish artifacts to a registry, or deploy anywhere.
