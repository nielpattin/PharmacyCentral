// Creates and approves the demo search synonym groups on the deployed stack, through the public API. The manager
// proposes and the pharmacist approves, as four-eyes review requires. Safe to run again: a group that already exists
// is skipped. Usage: node --env-file=.env tools/aws-seed-synonyms.mjs   (target: CHAOS_BASE_URL, default staff site)
import { searchSynonymGroups } from "./lib/demo-synonyms.mjs";

const baseUrl = process.env.CHAOS_BASE_URL ?? "https://staff.nielpat.cloud";
const password = process.env.DEMO_ACCOUNT_PASSWORD;
if (!password) throw new Error("DEMO_ACCOUNT_PASSWORD is required");

const fold = (text) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ|Đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
const keyOf = (terms) => JSON.stringify([...new Set(terms.map(fold))].sort());

async function signIn(email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Sign-in failed for ${email}: ${response.status}`);
  const { id, accessToken } = await response.json();
  return {
    id,
    async call(path, body) {
      const result = await fetch(`${baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!result.ok) throw new Error(`${path} answered ${result.status}: ${await result.text()}`);
      return result.json();
    },
  };
}

const manager = await signIn("manager@pharmacycentral.vn");
const { items } = await manager.call("/api/products/search-synonyms");
const existing = new Map();
for (const group of items) existing.set(keyOf(group.terms), [...(existing.get(keyOf(group.terms)) ?? []), group]);

const proposed = [];
let skipped = 0;
for (const terms of searchSynonymGroups) {
  const known = existing.get(keyOf(terms)) ?? [];
  if (known.some((group) => group.status === "approved")) {
    skipped += 1;
    continue;
  }
  proposed.push(
    known.find((group) => group.submittedBy === manager.id) ??
      (await manager.call("/api/products/search-synonyms", { terms })),
  );
}

const pharmacist = await signIn("pharmacist@pharmacycentral.vn");
for (const group of proposed) {
  await pharmacist.call(`/api/products/search-synonyms/${group.id}/approve`, { version: group.version });
}
console.log(`search synonyms: approved ${proposed.length}, already approved ${skipped}`);
