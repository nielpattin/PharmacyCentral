// Smoke test for the edge identity contract (RFC 0003), run against the gateway the browser uses.
//
//   node --env-file=.env tools/edge-identity-smoke.mjs
//
// API_BASE_URL comes from the environment and has no default: an unset value stops the script rather than testing the
// wrong origin. Every check prints PASS or FAIL, and the process exits non-zero when any check fails.
//
// The 401 check describes the local gateway. On AWS the authorizer refuses the merge call for its missing CSRF token
// before it reaches sales-service.
import { randomUUID } from "node:crypto";

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const apiBaseUrl = process.env.API_BASE_URL;
if (!apiBaseUrl) {
  fail("Missing required environment variable: API_BASE_URL. Set it in .env (node --env-file=.env ...).");
}

const base = apiBaseUrl.replace(/\/$/, "");

const send = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
  return { status: response.status, headers: response.headers, body: await response.text() };
};

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const checks = [
  [
    "GET /api/carts with a client X-Actor-Id and no identity context answers 401 trusted_request_required",
    async () => {
      const response = await send("/api/carts", { headers: { "x-actor-id": randomUUID() } });
      expect(response.status === 401, `status ${response.status}`);
      expect(response.body.includes("trusted_request_required"), "response body lacks trusted_request_required");
    },
  ],
  [
    "GET /api/carts with no identity context sets no cookie",
    async () => {
      const response = await send("/api/carts", { headers: { "x-actor-id": randomUUID() } });
      expect(response.headers.getSetCookie().length === 0, "a Set-Cookie header was sent");
    },
  ],
  [
    "POST /api/carts/merge without a trusted context answers 401 trusted_request_required",
    async () => {
      const response = await send("/api/carts/merge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-id": randomUUID(),
          "x-actor-type": "customer",
        },
        body: "{}",
      });
      expect(response.status === 401, `status ${response.status}`);
      expect(response.body.includes("trusted_request_required"), "response body lacks trusted_request_required");
    },
  ],
];

let passed = 0;
for (const [name, run] of checks) {
  try {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

console.log(`${passed}/${checks.length} checks passed against ${base}`);
process.exit(passed === checks.length ? 0 : 1);
