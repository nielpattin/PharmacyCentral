// Smoke test for the edge identity contract (RFC 0003), run against the gateway the browser uses.
//
//   node --env-file=.env tools/edge-identity-smoke.mjs
//
// API_BASE_URL and COOKIE_SECURE come from the environment and have no defaults: an unset value stops the script
// rather than testing the wrong origin or expecting the wrong cookie flags. Every check prints PASS or FAIL, and the
// process exits non-zero when any check fails.
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

const cookieSecureValue = process.env.COOKIE_SECURE;
if (!cookieSecureValue) {
  fail("Missing required environment variable: COOKIE_SECURE. Set it to true or false in .env.");
}
if (cookieSecureValue !== "true" && cookieSecureValue !== "false") {
  fail(`Invalid COOKIE_SECURE: expected "true" or "false", got "${cookieSecureValue}".`);
}
const expectSecure = cookieSecureValue === "true";

const cookieName = "pharmacy_guest_cart";
const base = apiBaseUrl.replace(/\/$/, "");

const send = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
  return { status: response.status, headers: response.headers, body: await response.text() };
};

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

// The guest cart request is shared by the cookie checks, so it is sent once.
let guestCartRequest;
const guestCart = () => {
  guestCartRequest ??= send("/api/carts", { headers: { "x-actor-id": randomUUID() } });
  return guestCartRequest;
};

const guestCookie = async () => {
  const response = await guestCart();
  return response.headers.getSetCookie().find((value) => value.startsWith(`${cookieName}=`));
};

const cookieAttributes = (setCookie) =>
  setCookie
    .split(";")
    .slice(1)
    .map((part) => part.trim().toLowerCase());

const checks = [
  [
    "GET /api/carts with a client X-Actor-Id answers 200",
    async () => {
      const response = await guestCart();
      expect(response.status === 200, `status ${response.status}`);
    },
  ],
  [
    "GET /api/carts sets the pharmacy_guest_cart cookie",
    async () => {
      const setCookie = await guestCookie();
      expect(setCookie !== undefined, "no pharmacy_guest_cart Set-Cookie header");
      expect(setCookie.split(";")[0].length > `${cookieName}=`.length, "pharmacy_guest_cart has an empty value");
    },
  ],
  [
    "pharmacy_guest_cart is HttpOnly and SameSite=Lax",
    async () => {
      const setCookie = await guestCookie();
      expect(setCookie !== undefined, "no pharmacy_guest_cart Set-Cookie header");
      const attributes = cookieAttributes(setCookie);
      expect(attributes.includes("httponly"), "HttpOnly is missing");
      expect(attributes.includes("samesite=lax"), "SameSite=Lax is missing");
    },
  ],
  [
    `pharmacy_guest_cart Secure flag matches COOKIE_SECURE=${cookieSecureValue}`,
    async () => {
      const setCookie = await guestCookie();
      expect(setCookie !== undefined, "no pharmacy_guest_cart Set-Cookie header");
      const hasSecure = cookieAttributes(setCookie).includes("secure");
      expect(hasSecure === expectSecure, `Secure is ${hasSecure ? "present" : "absent"}`);
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
