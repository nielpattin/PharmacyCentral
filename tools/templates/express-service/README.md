# Express service template

Copy this directory when creating a new backend application under `apps/`.

The template keeps the composition root small:

- `src/main.ts` initializes telemetry before importing the Express app and owns graceful shutdown.
- `src/app.ts` creates the Express instance, registers parsers and health routes, and installs the final problem-details handler.
- Feature modules own routes, application use cases, domain rules, and infrastructure adapters.
- The service does not import another application. Use a contract package and an HTTP or RabbitMQ adapter for cross-service communication.

Replace `@pharmacy/service-template` in `package.template.json` with the service package name and add the app to the workspace project graph.
