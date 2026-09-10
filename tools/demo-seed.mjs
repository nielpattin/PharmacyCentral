import { spawn } from "node:child_process";

const packages = [
  "@pharmacy/identity-service",
  "@pharmacy/catalog-service",
  "@pharmacy/inventory-service",
  "@pharmacy/sales-service",
  "@pharmacy/payment-service",
  "@pharmacy/operations-query-service",
];

const dryRun = process.argv.includes("--dry-run");
for (const packageName of packages) {
  if (dryRun) {
    console.log(`seed ${packageName}`);
    continue;
  }
  await new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(command, ["--filter", packageName, "seed"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${packageName} seed failed with ${code}`)),
    );
  });
}
