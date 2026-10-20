// Development only. Refuses NODE_ENV=production and any API_BASE_URL that is not a loopback host, so it cannot write
// to a deployed stack.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { datasets, csvRows } from "../apps/staff-web/src/import-datasets.ts";
import { uploadProductImages } from "../apps/catalog-service/scripts/upload-product-images.mjs";

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Set it in your .env file.`);
  return value;
};

if (process.env.NODE_ENV === "production") {
  throw new Error("dev-import-samples is a development tool and refuses to run with NODE_ENV=production.");
}

const baseUrl = new URL(requireEnv("API_BASE_URL"));
if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error(`Refusing to import sample data into ${baseUrl.origin}: only a local gateway is allowed.`);
}
const adminEmail = "admin@pharmacycentral.vn";
const pharmacistEmail = "pharmacist@pharmacycentral.vn";
const demoPassword = requireEnv("DEMO_ACCOUNT_PASSWORD");

const cookieHeader = (cookies) => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");

const request = async (cookies, path, { method = "GET", body, headers = {} } = {}) => {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      Cookie: cookieHeader(cookies),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    const issues = (json?.errors ?? []).map((issue) => `\n  - ${issue.path}: ${issue.message}`).join("");
    const code = json?.code ? ` [${json.code}]` : "";
    throw new Error(
      `${method} ${path} -> ${response.status}${code} ${json?.detail ?? json?.title ?? text.slice(0, 200)}${issues}`,
    );
  }
  return json;
};

// Each account gets its own cookie jar and CSRF token. `headers` gives the current session headers for a request.
const signIn = async ({ email }) => {
  const cookies = new Map();
  const call = (path, options) => request(cookies, path, options);
  try {
    await call("/api/auth/csrf");
    const account = await call("/api/auth/login", { method: "POST", body: { email, password: demoPassword } });
    return {
      id: account.id,
      call,
      get headers() {
        return { Cookie: cookieHeader(cookies), "X-CSRF-TOKEN": cookies.get("pharmacy_csrf") ?? "" };
      },
    };
  } catch (error) {
    throw new Error(
      `Could not sign in as ${email} through ${baseUrl.origin}. Is the gateway reachable (pnpm run infra:up, and ` +
        `host networking on Docker Desktop) and are the services running (pnpm dev)?\n` +
        String(error instanceof Error ? error.message : error),
      { cause: error },
    );
  }
};

// Which service's internal identity context each dataset is imported under.
const audienceByDataset = Object.freeze({
  sites: "catalog-service",
  storageLocations: "catalog-service",
  suppliers: "catalog-service",
  catalog: "catalog-service",
  openingBalances: "inventory-service",
});

// Local search synonym groups. The admin creates them and the pharmacist approves them, as four-eyes review requires.
const searchSynonymGroups = [
  ["tiêu chảy", "đi ngoài", "đi lỏng"],
  ["sổ mũi", "chảy nước mũi"],
  ["hạ sốt", "giảm sốt"],
  ["đau họng", "rát họng"],
  ["đầy hơi", "chướng bụng"],
  ["ợ chua", "ợ nóng"],
];
// Same folding as foldSearchText in apps/catalog-service search-text.ts, so accent variants count as existing.
const foldSearchTerm = (text) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ|Đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
const synonymKey = (terms) => JSON.stringify([...new Set(terms.map(foldSearchTerm))].sort());

const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run this through pnpm: pnpm run dev:data");
const runScript = (name, { show = false } = {}) => {
  // pnpm 12 ships as a native binary. Older installs set npm_execpath to a .js file that node must run.
  const [command, args] = /\.[cm]?js$/.test(pnpm) ? [process.execPath, [pnpm, "run", name]] : [pnpm, ["run", name]];
  const result = spawnSync(command, args, { encoding: "utf8", stdio: show ? "inherit" : "pipe" });
  if (result.status !== 0) {
    throw new Error(`pnpm run ${name} failed (exit ${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
};

console.log("Seeding demo accounts...");
runScript("seed:accounts");
console.log("Uploading product images to SeaweedFS...");
const uploadedImageUrls = new Set(
  (await uploadProductImages(fileURLToPath(new URL("../data/product-images/images", import.meta.url)))).map(
    ({ imageUrl }) => imageUrl,
  ),
);

const admin = await signIn({ email: adminEmail });
const { contexts } = await admin.call("/api/auth/context");

const order = ["sites", "storageLocations", "suppliers", "catalog", "openingBalances"];
for (const id of order) {
  const dataset = datasets[id];
  const file = new URL(`../data/import-samples/${dataset.fileBase}.csv`, import.meta.url);
  const payload = dataset.fromCsv(csvRows(await readFile(file, "utf8")));
  if (id === "openingBalances")
    await waitForSearchIndex(
      admin,
      payload.balances.map((row) => row.productSku),
    );
  if (id === "catalog") {
    const missing = payload.products.filter((row) => row.imageUrl && !uploadedImageUrls.has(row.imageUrl));
    if (missing.length > 0) {
      console.warn(
        `Warning: ${missing.length} product(s) point at an image that was not uploaded: ${missing.map((row) => row.sku).join(", ")}`,
      );
    }
  }
  const result = await admin.call(dataset.endpoint, {
    method: "POST",
    body: payload,
    headers: { ...admin.headers, "x-internal-identity-context": contexts[audienceByDataset[id]] },
  });
  console.log(`${dataset.label}: ${JSON.stringify(result?.summary ?? result)}`);
}
console.log("Granting site access to the staff accounts...");
runScript("seed:accounts", { show: true });
// After the reseed, so the pharmacist's session carries SITE-RTL access when it approves.
console.log("Seeding search synonyms...");
await seedSearchSynonyms(admin);
console.log("Done. Every step is idempotent, so running this again is safe.");

// The search index picks up new products asynchronously, and inventory-service resolves SKUs through it. Stock rows
// for a brand-new SKU therefore wait here.
async function waitForSearchIndex(session, skus) {
  const deadline = Date.now() + 60_000;
  for (const sku of new Set(skus)) {
    for (;;) {
      const rows = await session.call(`/api/products?search=${encodeURIComponent(sku)}&limit=100`);
      if (rows.some((row) => row.sku === sku)) break;
      if (Date.now() > deadline)
        throw new Error(`Product ${sku} is not searchable yet; run the command again in a minute.`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

// Identity contexts expire, so read a fresh catalog-service context for each session before it calls the API.
async function catalogHeaders(session) {
  const { contexts } = await session.call("/api/auth/context");
  return { ...session.headers, "x-internal-identity-context": contexts["catalog-service"] };
}

async function seedSearchSynonyms(admin) {
  const adminHeaders = await catalogHeaders(admin);
  const { items } = await admin.call("/api/products/search-synonyms", { headers: adminHeaders });
  const groupsByKey = new Map();
  for (const group of items) {
    const key = synonymKey(group.terms);
    groupsByKey.set(key, [...(groupsByKey.get(key) ?? []), group]);
  }

  let created = 0;
  let alreadyApproved = 0;
  const toApprove = [];
  for (const terms of searchSynonymGroups) {
    const existing = groupsByKey.get(synonymKey(terms)) ?? [];
    if (existing.some((group) => group.status === "approved")) {
      alreadyApproved += 1;
      continue;
    }
    const submitted = existing.find((group) => group.submittedBy === admin.id);
    if (submitted) {
      toApprove.push(submitted);
      continue;
    }
    if (existing.length > 0) {
      console.warn(`Search synonym "${terms.join(", ")}" is pending from another employee. Approve it in staff-web.`);
      continue;
    }
    const group = await admin.call("/api/products/search-synonyms", {
      method: "POST",
      body: { terms },
      headers: adminHeaders,
    });
    created += 1;
    toApprove.push(group);
  }

  let approved = 0;
  if (toApprove.length > 0) {
    const pharmacist = await signIn({ email: pharmacistEmail });
    const pharmacistHeaders = await catalogHeaders(pharmacist);
    for (const group of toApprove) {
      await pharmacist.call(`/api/products/search-synonyms/${group.id}/approve`, {
        method: "POST",
        body: { version: group.version },
        headers: pharmacistHeaders,
      });
      approved += 1;
    }
  }
  console.log(`search synonyms: created ${created}, approved ${approved}, already approved ${alreadyApproved}`);
}
