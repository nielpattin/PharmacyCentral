import { spawn } from "node:child_process";

const services = [
  { name: "identity-service", database: "identity_service", password: "IDENTITY_DB_PASSWORD" },
  { name: "catalog-service", database: "catalog_service", password: "CATALOG_DB_PASSWORD" },
  { name: "inventory-service", database: "inventory_service", password: "INVENTORY_DB_PASSWORD" },
  { name: "sales-service", database: "sales_service", password: "SALES_DB_PASSWORD" },
  { name: "payment-service", database: "payment_service", password: "PAYMENT_DB_PASSWORD" },
  { name: "operations-query-service", database: "operations_query_service", password: "OPERATIONS_QUERY_DB_PASSWORD" },
  { name: "chatbot-service", database: "chatbot_service", password: "CHATBOT_DB_PASSWORD" },
];

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

for (const service of services) {
  await new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    // Each service migrates its own database as its own role, so the tables belong to the role that runs the service.
    const password = encodeURIComponent(requireEnv(service.password));
    const databaseUrl = `postgres://${service.database}:${password}@localhost:${requireEnv("POSTGRES_PORT")}/${service.database}`;
    const child = spawn(command, ["--dir", `apps/${service.name}`, "db:migrate"], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`@pharmacy/${service.name} db:migrate failed with ${code}`)),
    );
  });
}
