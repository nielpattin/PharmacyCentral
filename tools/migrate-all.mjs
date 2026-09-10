import { spawn } from "node:child_process";

const packages = [
  "@pharmacy/identity-service",
  "@pharmacy/catalog-service",
  "@pharmacy/inventory-service",
  "@pharmacy/sales-service",
  "@pharmacy/payment-service",
  "@pharmacy/operations-query-service",
];

const dirs = {
  "@pharmacy/identity-service": "apps/identity-service",
  "@pharmacy/catalog-service": "apps/catalog-service",
  "@pharmacy/inventory-service": "apps/inventory-service",
  "@pharmacy/sales-service": "apps/sales-service",
  "@pharmacy/payment-service": "apps/payment-service",
  "@pharmacy/operations-query-service": "apps/operations-query-service",
};

for (const packageName of packages) {
  await new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    // Run from the package directory with DATABASE_URL removed so each
    // drizzle.config.ts falls back to its own database instead of the
    // shared default from the root .env file.
    const childEnv = { ...process.env };
    delete childEnv.DATABASE_URL;
    const child = spawn(command, ["--dir", dirs[packageName], "db:migrate"], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: childEnv,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${packageName} db:migrate failed with ${code}`)),
    );
  });
}
