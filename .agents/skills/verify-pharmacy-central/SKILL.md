---
name: verify-pharmacy-central
description: "Verifies Pharmacy Central end to end in the local stack, in one of two modes the user picks each session: dev mode (infra in Docker, apps on the host, started by the skill) or container mode (everything in Docker, only checked). Drives customer-web (http://customer.pharmacy.localhost) or staff-web (http://staff.pharmacy.localhost) with the browser tool's default browser at 1920x1080, signed in from saved role state files, and keeps the evidence. Proves event delivery between services (outbox publishers, RabbitMQ consumers, dead-letter queues) with an isolated helper that needs no browser and no running service. Use when asked to verify, prove, smoke test, or reproduce behavior in the shop or the staff portal, or after changing sign-in, storefront search, cart, checkout, the shopping assistant, an outbox publisher, an event consumer, a queue, or the RabbitMQ configuration."
---

# Verify Pharmacy Central

Drives the real local stack the way a shopper or an employee does, then records proof. Platform: Windows 11, Git Bash, Node 24, pnpm. Run every command from the repo root (the directory that holds `AGENTS.md`).

Surfaces, through the named URLs that `pnpm run urls:up` registers (portless, plain HTTP on port 80): `customer-web`, the shopper SPA, at `http://customer.pharmacy.localhost` (port 5301); `staff-web`, the staff portal, at `http://staff.pharmacy.localhost` (port 5302); and the gateway for API calls at `http://api.pharmacy.localhost` (port 8080).

Both webs call `/api/...` through the gateway (`gateway-dev` in dev mode, `gateway` in container mode). Browser tests never use `localhost` for the web apps, because they then share one cookie jar. Node scripts may keep `http://localhost:<port>`.

Feature map: [features/README.md](features/README.md). Open the feature file that matches the request and follow its steps.

## Choose the mode

Ask the user which mode to use at the start of every session, and keep it until they change it. Never assume it (AGENTS.md, Change workflow). A running `pnpm dev` stack holds the same host ports: ask the user to stop their own stack, and never stop it from here.

|           | Dev mode                                                                          | Container mode                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What runs | Infra in Docker. Six services and both webs on the host, started by `launch.mjs`. | Everything in Docker, built from the images, closest to AWS.                                                                                                 |
| Setup     | `pnpm run infra:up`, `pnpm run db:migrate`, `pnpm run urls:up` (once per session) | `pnpm run stack:up` (stops gateway-dev, rebuilds, waits until healthy), `pnpm run db:migrate` when migrations changed, `pnpm run urls:up` (once per session) |
| Apps      | The skill starts the Nx targets the feature needs                                 | The skill never starts, stops, or rebuilds anything. It checks and drives.                                                                                   |
| Doctor    | `doctor.mjs --mode dev`                                                           | `doctor.mjs --mode container`                                                                                                                                |

## Rules

- AI gate: `catalog-service`, `chatbot-service`, and `sales-service` call paid AI providers. Start them only with the user's explicit approval for that run. `launch.mjs` refuses `catalog-service` and `chatbot-service` without `--ai-approved`. The proof helpers start neither. UI-only chatbot checks may stub `/api/chatbot/*`; label them `ui-only-stub`.
- Never kill by process name. Kill only PIDs a dev-mode run recorded, with their trees. Never drive a port the run did not start: a foreign listener makes the doctor and `launch.mjs` refuse.
- Container mode: if the Docker engine stops answering or a container is unhealthy, report it as an infrastructure issue. Do not restart Docker Desktop from here.
- Never print or commit `.env` values or state-file cookie values. Read `DEMO_ACCOUNT_PASSWORD` inside the eval cell only.
- Browser: use the browser tool's default browser only. Never pass `app.path`, and never launch Edge or Chrome.

## Launch (dev mode only)

Start only the targets the feature needs. The `--need` names are the directory names under `apps/`:

```bash
node .agents/skills/verify-pharmacy-central/scripts/launch.mjs --need identity-service,staff-web
```

- `--need` takes `identity-service`, `catalog-service`, `inventory-service`, `sales-service`, `payment-service`, `operations-query-service`, `chatbot-service`, `customer-web`, `staff-web`. `--ai-approved` is required for `catalog-service` and `chatbot-service`, and omitted otherwise.
- Launch runs Nx under `node` directly (`NX_DAEMON=false`). A `pnpm` or `cmd` shim as the root exits early and orphans its tree. Nx loads `apps/<svc>-service/.env.dev`, so each service gets its own port.
- Launch refuses a needed port that already has a listener. Readiness: a service answers `GET /health/ready` with its own name, a web app answers `GET /` with the `root` div, and identity returns a token from `GET /api/auth/csrf` through the gateway. Wait is up to 240 seconds. On timeout it cleans up the run and exits `1`.
- Output lines: `START`, `WAIT`, `READY`, `URL`, `PIDS`, `STOP`. The run id is in `.tmp/verify/current`; `--run <id>` selects another run.

From an empty database: `pnpm run infra:up`, `pnpm run db:migrate`, then `launch.mjs`. `pnpm run dev:data` needs the services it calls running, catalog-service included, so it needs `--ai-approved`. Not proven on this machine.

## Online order stock and invoice pricing

Changed how an order holds, hands over or releases stock, the expiry sweep, or how payment-service prices an invoice? Run the helper. It starts the real inventory, sales and payment services on free ports with scratch databases and a scratch RabbitMQ vhost, answers catalog with a small stand-in (no `--ai-approved`, no AI call), and never touches the ports of a running stack:

```bash
node .agents/skills/verify-pharmacy-central/scripts/order-stock-proof.mjs
```

It walks one order through hold, refusal for lack of stock, a server-priced invoice, payment over the broker, the hand over, a refund, and expiry. Exit `0` prints `RESULT all 7/7 checks passed`. Evidence and the three service logs are in `.tmp/verify/<run-id>/evidence/order-stock/`. Report its `PASS` and `FAIL` lines.

## Events and messaging

Changed an outbox publisher, an event consumer, a queue, an exchange, or the `RABBITMQ_URL` handling? Run the helper. It needs only the infra containers, starts no service, uses a scratch RabbitMQ vhost and scratch databases, calls no AI, and removes what it made:

```bash
node .agents/skills/verify-pharmacy-central/scripts/messaging-proof.mjs
```

The checks, the evidence, and the gotchas are in [features/event-delivery.md](features/event-delivery.md). Exit `0` prints `RESULT all 15/15 checks passed`. Report the helper's `PASS` and `FAIL` lines. Do not report messaging as verified from unit tests alone.

## Doctor

Read-only. Run it before every drive and whenever anything looks off. `--mode` is required: without it the doctor exits `2` with a usage message, so ask the user.

```bash
node .agents/skills/verify-pharmacy-central/scripts/doctor.mjs --mode dev --need identity-service,staff-web --role staff-admin --email admin@pharmacycentral.vn
node .agents/skills/verify-pharmacy-central/scripts/doctor.mjs --mode container --role staff-admin --email admin@pharmacycentral.vn
```

- Container mode: every container in `docker compose ps --format json` is healthy, `GET /healthz` on `GATEWAY_PORT` answers, and both named URLs answer (otherwise run `pnpm run urls:up`).
- Dev mode (`--need` applies here only): `gateway-dev` and the identity database answer, each service port is `free`, `ours` (its listeners descend from the run's `pids.json`), or `foreign`, each health route answers, and `gateway -> identity` answers.
- Both modes: `--email` prints the account's role type, whether it is active, and `activeSessions`. `--role` checks that `~/.omp/browser-profiles/<role>.json` exists and is valid JSON. It never prints cookie values.
- Exit `0` prints `RESULT ready`; exit `1` prints `RESULT not ready` with the failing lines. A `FAIL` on a dev port that is not running means launch it. A `foreign` listener means stop, and ask the user to stop their own stack.

## Drive

Harness: the `browser` global in the `eval` tool, language `js`. Read `xd://eval/browser` before first use. Every tab opens with `browser.open({ name, url, viewport: { width: 1920, height: 1080 }, app: { tern: false, relay: false }, timeout: 90 })`, as the snippet does.
A signed-in role is a state file, `~/.omp/browser-profiles/<role>.json`. It holds session cookies: never print or commit it. Restore it with `tab.loadState(path)` on a fresh tab, then `tab.goto(url)`, and confirm `GET /api/auth/me` returns the expected email before trusting the screen. When the state is missing or stale (a reseed or a password change), the snippet signs in on a clean tab and calls `tab.saveState(path)`.

| Role               | Account                                    | App          |
| ------------------ | ------------------------------------------ | ------------ |
| `customer`         | khachhang@pharmacycentral.vn               | customer-web |
| `staff-admin`      | admin@pharmacycentral.vn                   | staff-web    |
| `staff-manager`    | manager@pharmacycentral.vn (`SITE-RTL`)    | staff-web    |
| `staff-pharmacist` | pharmacist@pharmacycentral.vn (`SITE-RTL`) | staff-web    |
| `staff-warehouse`  | warehouse@pharmacycentral.vn (`SITE-WH`)   | staff-web    |

One browser holds one session per host: one customer and one staff account at once, never two staff accounts. Clear cookies and close the tab after each drive.

Staff portal handles: form `form.login-card` (`input[type=email]`, `input[type=password]`, `button[type=submit]`); signed-in marker `details.profile-menu` with `.profile-copy strong` holding the email; sign-out `details.profile-menu summary`, then `role/button[name="Đăng xuất"]` or `Sign out`. The portal defaults to Vietnamese. Dashboard tiles read `0` when `operations-query-service` is stopped; a zero is not data. Steps and side effects: [features/staff-sign-in.md](features/staff-sign-in.md).

Drive snippet for the `eval` tool (`js`), run from the repo root. For a customer drive, change `role`, `email`, `url`, and the handles from [features/customer-sign-in-account.md](features/customer-sign-in-account.md).

```js
const { readFileSync, writeFileSync, mkdirSync, existsSync } = await import("node:fs");
const { join, dirname } = await import("node:path");
const { homedir } = await import("node:os");
const root = process.cwd(); // run from the repo root
const mode = "container"; // "dev" or "container", as the user chose
const featureId = "staff-sign-in",
  role = "staff-admin",
  email = "admin@pharmacycentral.vn";
const url = "http://staff.pharmacy.localhost/";
const t = new Date(),
  p = (n) => String(n).padStart(2, "0");
const stamp = `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
const runId = mode === "dev" ? readFileSync(join(root, ".tmp/verify/current"), "utf8").trim() : `container-${stamp}`;
const evidence = join(root, ".tmp/verify", runId, "evidence", featureId);
mkdirSync(evidence, { recursive: true });
const statePath = join(homedir(), ".omp", "browser-profiles", `${role}.json`);
const write = (file, value) =>
  writeFileSync(join(evidence, file), typeof value === "string" ? value : JSON.stringify(value, null, 2));
const tab = await browser.open({
  name: `${featureId}-proof`,
  url,
  viewport: { width: 1920, height: 1080 },
  app: { tern: false, relay: false },
  timeout: 90,
});
let result;
try {
  await tab.clearCookies();
  if (existsSync(statePath)) await tab.loadState(statePath);
  await tab.goto(url);
  await tab.waitForSelector("form.login-card, details.profile-menu", { timeout: 60000 });
  let branch = "already-signed-in";
  if ((await tab.count("form.login-card")) > 0) {
    const password = readFileSync(join(root, ".env"), "utf8")
      .match(/^DEMO_ACCOUNT_PASSWORD=(.*)$/m)?.[1]
      ?.trim();
    if (!password) throw new Error("DEMO_ACCOUNT_PASSWORD is not set in .env");
    await tab.clearCookies();
    await tab.goto(url);
    await tab.waitForSelector("form.login-card", { timeout: 60000 });
    await tab.fill("form.login-card input[type=email]", email);
    await tab.fill("form.login-card input[type=password]", password);
    await tab.click("form.login-card button[type=submit]");
    await tab.waitForSelector("details.profile-menu", { timeout: 60000 });
    mkdirSync(dirname(statePath), { recursive: true });
    await tab.saveState(statePath);
    branch = "sign-in-form";
  }
  // The default browser reports devicePixelRatio 1.25 here, which makes screenshots 2400x1350. Pin it.
  await tab.run(async ({ page }) => {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await new Promise((done) => setTimeout(done, 300));
  });
  const [w, h, dpr] = await tab.evaluate("[window.innerWidth, window.innerHeight, window.devicePixelRatio]");
  if (w !== 1920 || h !== 1080 || dpr !== 1) throw new Error(`viewport is ${w}x${h} @${dpr}, need 1920x1080 @1`);
  const me = await tab.evaluate(
    "(async () => { const r = await fetch('/api/auth/me', { credentials: 'include' }); return { status: r.status, body: r.ok ? await r.json() : null }; })()",
  );
  if (me.status !== 200 || me.body?.email !== email)
    throw new Error(`/api/auth/me gave ${me.status}, email ${me.body?.email}`);
  const displayed = (await tab.text("details.profile-menu .profile-copy strong")).trim();
  if (displayed !== email) throw new Error(`profile shows ${displayed}`);
  const shot = join(evidence, "signed-in.png");
  await tab.run(
    async ({ page }, path) => {
      await page.screenshot({ path });
    },
    { args: [shot] },
  );
  const bytes = readFileSync(shot);
  if (bytes.toString("ascii", 1, 4) !== "PNG") throw new Error("screenshot is not a PNG");
  const size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (size.width !== 1920 || size.height !== 1080)
    throw new Error(`screenshot is ${size.width}x${size.height}, need 1920x1080`);
  write("signed-in.aria.txt", await tab.ariaSnapshot());
  write("url.txt", await tab.url());
  write("api-auth-me.json", me);
  write("meta.json", {
    featureId,
    mode,
    role,
    entryPoint: url,
    branch,
    displayedEmail: displayed,
    runId,
    screenshot: size,
  });
  result = { runId, branch, displayed, screenshot: size };
} finally {
  await tab.clearCookies();
  await tab.close();
}
result;
```

## Evidence

Store everything under `.tmp/verify/<run-id>/evidence/<feature-id>/`. Dev mode uses the run id in `.tmp/verify/current`; container mode uses the `container-<YYYYMMDD-HHMMSS>` that the snippet creates. Each artifact records the feature id and the entry point. The snippet writes `signed-in.png` (1920x1080, PNG header checked, email visible), `signed-in.aria.txt`, `url.txt`, `api-auth-me.json` (the read-only second view), and `meta.json` (mode, role, branch `sign-in-form` or `already-signed-in`, displayed email, screenshot size).
Add the doctor output from before and after the drive when the feature proves a side effect. For sign-in, `activeSessions` rises by one when the form was used. A run that found a live session did not create one, and its evidence says so.

Proof standards: exercise the real user path through the UI and the gateway, never an internal setter or test-only endpoint. Capture the action and the state after it. Verify side effects beside what is visible. Mocks are allowed only at a production boundary that already isolates the external system; the chatbot stub is the only one here, labeled `ui-only-stub`.

## Cleanup

- Container mode: browser cleanup only. The snippet's `finally` clears the cookies and closes the tab. Stop no container and no app.
- Dev mode: after the drive, run `node .agents/skills/verify-pharmacy-central/scripts/stop.mjs`. It reads `.tmp/verify/current`, tree-kills the run's recorded roots and listeners, and writes `cleanup.json`. Exit `0` means no listener is left from the run; exit `1` means the output names something to look at. Recorded PIDs die only when their start time still matches the record. Foreign listeners are left alone.
- Cleanup never removes evidence or logs. Kept: `run.json`, `pids.json`, `logs/`, `evidence/`, `cleanup.json`. Removed: the run's scratch state.

## Helpers

- `scripts/lib.mjs`: shared checks, port ownership, run records, tree kill. Imported by the others; not run directly.
- `scripts/doctor.mjs --mode dev|container [--need <names>] [--run <id>] [--role <role>] [--email <address>]`: read-only readiness check.
- `scripts/launch.mjs --need <names> [--run <id>] [--ai-approved]`: dev mode only. Starts the Nx targets and records PIDs.
- `scripts/stop.mjs [--run <id>]`: dev mode only. Stops exactly the run's recorded processes; keeps evidence.
- `scripts/order-stock-proof.mjs [--run <id>]`: order stock and invoice pricing proof.
- `scripts/messaging-proof.mjs [--run <id>]`: event delivery proof. It re-runs itself with `--experimental-transform-types` and cleans up after itself.

## Status

- `messaging-proof.mjs` and `order-stock-proof.mjs` do not depend on the mode and use no browser. Their behaviour is unchanged. Every browser drive must be re-proven under the rules in this file (default browser, state files, named URLs, mode); none has been proven under them yet.
- Not yet proven on this machine: a launch from an empty database, storefront search, cart and checkout, the shopping assistant, and the browser path of an event.
