import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { datasets, csvRows } from "../apps/staff-web/src/import-datasets.ts";

const baseUrl = "https://staff.nielpat.cloud";

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const adminPassword = requireEnv("ADMIN_PASSWORD");
const demoPassword = requireEnv("DEMO_ACCOUNT_PASSWORD");

async function makeSession(email, password) {
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  const { token: csrfToken } = await csrfRes.json();
  const csrfCookie = csrfRes.headers.getSetCookie();

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      Cookie: csrfCookie.join("; "),
    },
    body: JSON.stringify({ email, password }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed for ${email}: ${loginRes.status} ${await loginRes.text()}`);
  }

  const allCookies = [...csrfCookie, ...loginRes.headers.getSetCookie()];

  return {
    async post(path, body) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          Cookie: allCookies.join("; "),
        },
        body: JSON.stringify(body),
      });
      return res;
    },
  };
}

const SAMPLE_DATA_DAY = "2026-10-29";
const DAY_MS = 86_400_000;
const isoDay = (millis) => new Date(millis).toISOString().slice(0, 10);
const inDays = (days) => isoDay(Date.now() + days * DAY_MS);
const shiftToToday = (isoDate) =>
  isoDate ? isoDay(Date.parse(isoDate) + (Date.parse(inDays(0)) - Date.parse(SAMPLE_DATA_DAY))) : isoDate;

async function main() {
  console.log("Signing in as Pharmacy Manager...");
  const manager = await makeSession("manager@pharmacycentral.vn", demoPassword);

  console.log("Importing storage locations...");
  const slPayload = datasets.storageLocations.fromCsv(
    csvRows(await readFile("data/import-samples/storage-locations.csv", "utf8")),
  );
  const slRes = await manager.post("/api/products/imports", slPayload);
  console.log("Storage locations status:", slRes.status, await slRes.text());

  console.log("Importing suppliers...");
  const supPayload = datasets.suppliers.fromCsv(csvRows(await readFile("data/import-samples/suppliers.csv", "utf8")));
  const supRes = await manager.post("/api/products/imports", supPayload);
  console.log("Suppliers status:", supRes.status, await supRes.text());

  console.log("Importing products with S3 URLs...");
  const prodPayload = datasets.catalog.fromCsv(csvRows(await readFile("tmp/aws-demo/products.csv", "utf8")));
  const prodRes = await manager.post("/api/products/imports", prodPayload);
  console.log("Products status:", prodRes.status, await prodRes.text());

  console.log("Signing in as Warehouse Staff...");
  const warehouse = await makeSession("warehouse@pharmacycentral.vn", demoPassword);

  console.log("Importing opening balances...");
  const obPayload = datasets.openingBalances.fromCsv(
    csvRows(await readFile("data/import-samples/opening-balances.csv", "utf8")),
  );
  for (const row of obPayload.balances) {
    row.expiryDate = shiftToToday(row.expiryDate);
    if (row.manufacturedDate) row.manufacturedDate = [shiftToToday(row.manufacturedDate), inDays(-30)].sort()[0];
  }
  const obRes = await warehouse.post("/api/inventory/imports/opening-balances", obPayload);
  console.log("Opening balances status:", obRes.status, await obRes.text());

  console.log("All master data imported successfully to AWS!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
