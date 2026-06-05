# Pharmacy Central

## Prerequisites

Install the .NET SDK from winget:

```bash
winget install Microsoft.DotNet.SDK.10
```

Install the .NET Aspire CLI:

```bash
dotnet tool install -g Aspire.Cli
```

This project also uses a Vite frontend, so make sure Node.js is installed:

```bash
winget install OpenJS.NodeJS.LTS
```

Restart your terminal after installing tools so `dotnet`, `aspire`, and `node` are available on your PATH.

## Run the project

Trust the local development certificate for HTTPS:
```bash
dotnet dev-certs https --trust
```

From the repository root, restore dependencies and start the Aspire AppHost:


```bash
dotnet restore
aspire run
```

Aspire starts the backend server and the Vite frontend together.

## Test the frontend from the Aspire dashboard

1. After `aspire run` starts, open the Aspire dashboard URL printed in the terminal.
2. In the dashboard, go to the **Resources** page.
3. Find the `frontend` resource.
4. Open the endpoint shown for `frontend`. Eg: `http://app.pharmacy.localhost:63995/`
5. The PharmacyCentral frontend should load in your browser.

The AppHost configures the frontend host as:

```text
app.pharmacy.dev.localhost
```

## Guides

- [User Guide](docs/UserGuide.md)
- [API Guide](docs/ApiGuide.md)
- [Demo Script](docs/DemoScript.md)
- [Runbooks](docs/Runbooks.md)
- [Deployment Package](docs/Deployment.md)

## Local deployment package

> This package is for local validation and handoff only. It does not push images or deploy to any external environment.

Build the local production-like container package:

```bash
docker compose --env-file deploy/pharmacycentral.env.example build
```

Run it locally:

```bash
docker compose --env-file deploy/pharmacycentral.env.example up
```

Check health:

```bash
curl http://localhost:8080/health
```

See [`docs/Deployment.md`](docs/Deployment.md) for the full local packaging notes, HTTPS guidance, and CI behavior.
