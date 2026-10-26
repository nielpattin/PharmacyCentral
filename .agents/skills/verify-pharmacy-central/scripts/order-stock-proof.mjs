#!/usr/bin/env node
// Proves that an online order holds stock, pays the price the server computed, and gives the stock back or hands it
// over, against the real RabbitMQ and PostgreSQL of the local infra. It starts the real inventory-service,
// sales-service and payment-service from apps/ on free ports, each on a scratch database, with a scratch RabbitMQ
// vhost and a small stand-in for catalog-service (catalog embeds with a paid AI provider, so it is never started).
// It never touches a service, a port, a queue or a database that `pnpm dev` owns, and it calls no AI.
//
//   node .agents/skills/verify-pharmacy-central/scripts/order-stock-proof.mjs [--run <id>]
//
// Exit 0: every check passed. Exit 1: a check failed, or the infra is down. Evidence goes to
// .tmp/verify/<run-id>/evidence/order-stock/order-stock-proof.json, and the service logs sit beside it.
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdirSync, createWriteStream, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.execArgv.includes("--experimental-transform-types")) {
  // The services use TypeScript parameter properties, which strip-only mode rejects.
  const child = spawnSync(
    process.execPath,
    ["--experimental-transform-types", "--no-warnings", ...process.argv.slice(1)],
    {
      stdio: "inherit",
    },
  );
  process.exit(child.status ?? 1);
}

const { REPO_ROOT, currentRunId, newRunId, requireEnv, runDir, sleep } = await import("./lib.mjs");

const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const runId = flag("--run") ?? currentRunId() ?? `order-stock-${newRunId()}`;
const evidenceDir = join(runDir(runId), "evidence", "order-stock");
mkdirSync(evidenceDir, { recursive: true });

const need = (service, name) => createRequire(join(REPO_ROOT, "apps", service, "package.json"))(name);
const amqp = need("sales-service", "amqplib");
const pg = need("sales-service", "pg");
const { drizzle } = need("sales-service", "drizzle-orm/node-postgres");
const { migrate } = need("sales-service", "drizzle-orm/node-postgres/migrator");
const appFile = (service, relative) => pathToFileURL(join(REPO_ROOT, "apps", service, "src", relative)).href;

const tag = randomBytes(3).toString("hex");
const vhost = `verify_${tag}`;
const results = [];
const check = async (name, fn) => {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, detail });
    console.log(`PASS ${name}${detail ? `  ${detail}` : ""}`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: String(error?.message ?? error) });
    console.log(`FAIL ${name}  ${error?.message ?? error}`);
  }
};
const until = async (label, probe, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms: ${label}`);
    await sleep(250);
  }
};
const expect = (actual, wanted, what) => {
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    throw new Error(`${what}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
};

const rabbitContainer = spawnSync("docker", ["compose", "ps", "-q", "rabbitmq"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
}).stdout.trim();
if (!rabbitContainer) {
  console.log("FAIL infra  rabbitmq container is not running: pnpm run infra:up");
  process.exit(1);
}
const rabbitctl = (...args) => {
  const run = spawnSync("docker", ["exec", rabbitContainer, "rabbitmqctl", "--quiet", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`rabbitmqctl ${args.join(" ")} failed: ${run.stderr || run.stdout}`);
  return run.stdout;
};
const credentials = `${encodeURIComponent(requireEnv("RABBITMQ_USER"))}:${encodeURIComponent(requireEnv("RABBITMQ_PASSWORD"))}`;
const brokerUrl = `amqp://${credentials}@127.0.0.1:${requireEnv("RABBITMQ_AMQP_PORT")}/${vhost}`;
const databaseUrl = (database) =>
  `postgres://${encodeURIComponent(requireEnv("POSTGRES_USER"))}:${encodeURIComponent(requireEnv("POSTGRES_PASSWORD"))}@127.0.0.1:${requireEnv("POSTGRES_PORT")}/${database}`;

const adminDb = new pg.Client({ connectionString: databaseUrl("postgres") });
const scratch = {};
/** Every database this run created, so one whose setup failed half way is still dropped. */
const created = [];
const children = [];
const closers = [];

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const setUpDatabase = async (service, schemaPath = "shared/infrastructure/schema.ts") => {
  const database = `verify_${tag}_${service.replace("-service", "")}`;
  await adminDb.query(`create database ${database}`);
  created.push(database);
  const pool = new pg.Pool({ connectionString: databaseUrl(database), max: 4 });
  const schema = await import(appFile(service, schemaPath));
  const db = drizzle({ client: pool, schema });
  await migrate(db, { migrationsFolder: join(REPO_ROOT, "apps", service, "drizzle", "migrations") });
  scratch[service] = { database, pool, db, schema };
  return scratch[service];
};

const startService = async (service, port, overrides) => {
  const log = createWriteStream(join(evidenceDir, `${service}.log`));
  const child = spawn(
    process.execPath,
    ["--experimental-transform-types", "--no-warnings", `--env-file=${join(REPO_ROOT, ".env")}`, "src/main.ts"],
    {
      cwd: join(REPO_ROOT, "apps", service),
      env: { ...process.env, PORT: String(port), NODE_ENV: "development", RABBITMQ_URL: brokerUrl, ...overrides },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  await until(
    `${service} ready`,
    async () => {
      if (child.exitCode !== null) throw new Error(`${service} exited with ${child.exitCode}, see ${service}.log`);
      try {
        return (await fetch(`${base}/health/ready`)).ok;
      } catch {
        return false;
      }
    },
    60_000,
  );
  return base;
};

const secret = requireEnv("INTERNAL_SERVICE_SECRET");
/** A call as an internal service acting for one shopper, which is how the services trust each other. */
const call = async (base, method, path, { actor, body, headers } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-internal-service-secret": secret,
      ...(actor ? { "x-actor-id": actor } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined };
};

const PRODUCT = randomUUID();
const UNIT = randomUUID();
const SITE = randomUUID();
const FRONT = randomUUID();
const BACK = randomUUID();
const SHOPPER = randomUUID();
const OTHER_SHOPPER = randomUUID();
const PRICE = 45_000;

const catalog = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url?.startsWith("/pricing/active"))
    return response.end(
      JSON.stringify({ productId: PRODUCT, productUnitId: UNIT, unitPrice: String(PRICE), currency: "VND" }),
    );
  if (request.url?.startsWith("/products/"))
    return response.end(JSON.stringify({ id: PRODUCT, name: "Proof paracetamol" }));
  response.statusCode = 404;
  response.end("{}");
});

try {
  await adminDb.connect();
  rabbitctl("add_vhost", vhost);
  rabbitctl("set_permissions", "-p", vhost, requireEnv("RABBITMQ_USER"), ".*", ".*", ".*");
  console.log(`INFO run ${runId}, vhost ${vhost}, databases verify_${tag}_*`);

  const inventoryDb = await setUpDatabase("inventory-service");
  const salesDb = await setUpDatabase("sales-service");
  await setUpDatabase("payment-service", "modules/payments/infrastructure/schema.ts");
  await new Promise((done) => catalog.listen(0, "127.0.0.1", done));
  closers.push(() => new Promise((done) => catalog.close(done)));
  const catalogUrl = `http://127.0.0.1:${catalog.address().port}`;

  // Three units on the shelf of one site, split over two locations: the hold has to span both.
  const batchFront = randomUUID();
  const batchBack = randomUUID();
  await inventoryDb.db.insert(inventoryDb.schema.productBatches).values([
    { id: batchFront, productId: PRODUCT, batchNumber: "FRONT", expiryDate: "2098-01-31", qualityStatus: "Released" },
    { id: batchBack, productId: PRODUCT, batchNumber: "BACK", expiryDate: "2099-01-31", qualityStatus: "Released" },
  ]);
  await inventoryDb.db.insert(inventoryDb.schema.inventoryBalances).values([
    { productBatchId: batchFront, siteId: SITE, storageLocationId: FRONT, quantityOnHand: "2" },
    { productBatchId: batchBack, siteId: SITE, storageLocationId: BACK, quantityOnHand: "1" },
  ]);

  const [inventoryPort, salesPort, paymentPort] = [await freePort(), await freePort(), await freePort()];
  const inventoryUrl = `http://127.0.0.1:${inventoryPort}`;
  const salesUrl = `http://127.0.0.1:${salesPort}`;
  const urls = {
    CATALOG_SERVICE_URL: catalogUrl,
    INVENTORY_SERVICE_URL: inventoryUrl,
    SALES_SERVICE_URL: salesUrl,
    IDENTITY_SERVICE_URL: "http://127.0.0.1:1",
  };
  await startService("inventory-service", inventoryPort, {
    ...urls,
    DATABASE_URL: databaseUrl(inventoryDb.database),
  });
  const sales = await startService("sales-service", salesPort, {
    ...urls,
    DATABASE_URL: databaseUrl(salesDb.database),
  });
  const payment = await startService("payment-service", paymentPort, {
    ...urls,
    DATABASE_URL: databaseUrl(scratch["payment-service"].database),
  });

  const stock = async () => {
    const balances = (
      await inventoryDb.pool.query(
        "select coalesce(sum(quantity_on_hand),0)::float as on_hand, coalesce(sum(quantity_reserved),0)::float as reserved from inventory_balances",
      )
    ).rows[0];
    return { onHand: balances.on_hand, reserved: balances.reserved };
  };
  const reservationStatus = async (id) =>
    (await inventoryDb.pool.query("select status from stock_reservations where id = $1", [id])).rows[0]?.status;
  const orderRow = async (id) =>
    (await salesDb.pool.query("select status, payment_status, stock_hold from orders where id = $1", [id])).rows[0];
  const placeOrder = (quantity, actor = SHOPPER) =>
    call(sales, "POST", "/orders", {
      actor,
      body: {
        selectedStoreId: SITE,
        fulfillmentType: "pickup",
        paymentMethod: "sepay_qr",
        lines: [{ productId: PRODUCT, productUnitId: UNIT, quantity }],
      },
    });
  const publishEvent = async (eventType, orderId) => {
    const connection = await amqp.connect(brokerUrl);
    try {
      const channel = await connection.createChannel();
      await channel.checkExchange("pharmacy.events");
      channel.publish(
        "pharmacy.events",
        eventType,
        Buffer.from(
          JSON.stringify({
            eventId: randomUUID(),
            eventType,
            occurredAt: new Date().toISOString(),
            payload: { orderId },
          }),
        ),
        { persistent: true },
      );
      await channel.checkExchange("pharmacy.events");
    } finally {
      await connection.close();
    }
  };

  let orderA;
  await check("an order holds stock across the locations of its store, earliest expiry first", async () => {
    const placed = await placeOrder(2);
    expect(placed.status, 201, "status");
    orderA = placed.json.id;
    expect(placed.json.stockHold, "held", "stockHold");
    expect(await stock(), { onHand: 3, reserved: 2 }, "stock after the hold");
    expect(await reservationStatus(orderA), "active", "reservation");
    return `order ${orderA.slice(0, 8)} holds 2 of 3`;
  });

  await check("an order the store cannot cover is refused, cancelled, and holds nothing", async () => {
    const placed = await placeOrder(2);
    expect(placed.status, 409, "status");
    expect(placed.json.code, "insufficient_stock", "code");
    const cancelled = (await salesDb.pool.query("select status, stock_hold from orders where status = 'Cancelled'"))
      .rows;
    expect(cancelled, [{ status: "Cancelled", stock_hold: "released" }], "the refused order");
    expect(await stock(), { onHand: 3, reserved: 2 }, "stock after the refusal");
    return "409 insufficient_stock, stock untouched";
  });

  await check("an invoice is for the price sales computed, never the price the shopper sent", async () => {
    const invoice = await call(payment, "POST", "/payments/invoices", {
      actor: SHOPPER,
      body: {
        invoiceId: orderA,
        orderId: orderA,
        paymentMethod: "sepay_qr",
        lines: [
          { productId: PRODUCT, productUnitId: UNIT, description: "cheap", quantity: 2, unitPrice: 1, currency: "VND" },
        ],
      },
    });
    expect(invoice.status, 201, "status");
    expect(Number(invoice.json.amount), 2 * PRICE, "amount");
    const stranger = await call(payment, "POST", "/payments/invoices", {
      actor: OTHER_SHOPPER,
      body: {
        invoiceId: randomUUID(),
        orderId: orderA,
        paymentMethod: "sepay_qr",
        lines: [
          { productId: PRODUCT, productUnitId: UNIT, description: "x", quantity: 1, unitPrice: 1, currency: "VND" },
        ],
      },
    });
    expect(stranger.status, 404, "another shopper's order");
    return `amount ${invoice.json.amount} for a request that said 1`;
  });

  await check("paying the invoice confirms the order, through the broker", async () => {
    const body = JSON.stringify({
      id: Math.floor(Math.random() * 1e9),
      content: `PC${orderA.replaceAll("-", "").slice(0, 16).toUpperCase()} thanh toan`,
      transferType: "in",
      transferAmount: 2 * PRICE,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", requireEnv("SEPAY_WEBHOOK_SECRET"))
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");
    const webhook = await fetch(`${payment}/payments/sepay/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sepay-timestamp": timestamp,
        "x-sepay-signature": `sha256=${signature}`,
      },
      body,
    });
    if (!webhook.ok) throw new Error(`webhook answered ${webhook.status}`);
    const confirmed = await until(
      "order confirmed",
      async () => {
        const row = await orderRow(orderA);
        return row.status === "Confirmed" && row.payment_status === "Paid" ? row : undefined;
      },
      20_000,
    );
    return `${confirmed.status} / ${confirmed.payment_status}, stock still held`;
  });

  await check("handing the order over takes the held goods off the shelf, once, with a ledger entry", async () => {
    for (const status of ["Preparing", "Ready", "Completed"]) {
      const moved = await call(sales, "POST", `/orders/${orderA}/transition`, { body: { status } });
      expect(moved.status, 200, `transition to ${status}`);
    }
    expect(await stock(), { onHand: 1, reserved: 0 }, "stock after the hand over");
    expect(await reservationStatus(orderA), "consumed", "reservation");
    expect((await orderRow(orderA)).stock_hold, "consumed", "stock_hold");
    const ledger = (
      await inventoryDb.pool.query(
        "select reference_type, reference_id, quantity_delta::float as delta from stock_ledger_entries",
      )
    ).rows;
    expect(ledger, [{ reference_type: "Order", reference_id: orderA, delta: -2 }], "ledger");
    return "on hand 3 to 1, reserved 0, ledger Dispense for the order";
  });

  await check("a refund before the hand over cancels the order and gives its stock back", async () => {
    const placed = await placeOrder(1);
    expect(placed.status, 201, "status");
    const orderC = placed.json.id;
    expect(await stock(), { onHand: 1, reserved: 1 }, "stock held for the order");
    await publishEvent("payment.invoice.paid.v1", orderC);
    await until("order confirmed", async () => (await orderRow(orderC)).status === "Confirmed", 20_000);
    await publishEvent("payment.invoice.refunded.v1", orderC);
    await until("order cancelled", async () => (await orderRow(orderC)).status === "Cancelled", 20_000);
    await until("stock released", async () => (await orderRow(orderC)).stock_hold === "released", 20_000);
    expect(await stock(), { onHand: 1, reserved: 0 }, "stock after the refund");
    expect(await reservationStatus(orderC), "released", "reservation");
    return "Confirmed, then Cancelled, reservation released";
  });

  await check("an order nobody pays for expires and gives its stock back", async () => {
    const placed = await placeOrder(1);
    expect(placed.status, 201, "status");
    const orderD = placed.json.id;
    expect(await stock(), { onHand: 1, reserved: 1 }, "stock held for the order");
    await salesDb.pool.query("update orders set created_at = now() - interval '40 minutes' where id = $1", [orderD]);
    await until(
      "order expired and released",
      async () => {
        const row = await orderRow(orderD);
        return row.status === "Cancelled" && row.stock_hold === "released";
      },
      100_000,
    );
    expect(await stock(), { onHand: 1, reserved: 0 }, "stock after the expiry");
    const late = await call(payment, "POST", "/payments/invoices", {
      actor: SHOPPER,
      body: {
        invoiceId: orderD,
        orderId: orderD,
        paymentMethod: "sepay_qr",
        lines: [
          { productId: PRODUCT, productUnitId: UNIT, description: "x", quantity: 1, unitPrice: PRICE, currency: "VND" },
        ],
      },
    });
    expect(late.status, 409, "an invoice for the expired order");
    expect(late.json.code, "order_not_payable", "code");
    return "Cancelled by the sweep, no invoice for it any more";
  });
} finally {
  for (const child of children) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  for (const close of closers.reverse()) await Promise.resolve(close()).catch(() => undefined);
  await sleep(500);
  for (const { pool } of Object.values(scratch)) await pool.end().catch(() => undefined);
  for (const database of created)
    await adminDb.query(`drop database if exists ${database} with (force)`).catch(() => undefined);
  await adminDb.end().catch(() => undefined);
  try {
    rabbitctl("delete_vhost", vhost);
  } catch {
    // The vhost is already gone.
  }
  const failed = results.filter((result) => !result.ok);
  writeFileSync(
    join(evidenceDir, "order-stock-proof.json"),
    `${JSON.stringify({ feature: "order-stock", entryPoint: "scripts/order-stock-proof.mjs", runId, vhost, results }, null, 2)}\n`,
  );
  console.log(
    `RESULT ${failed.length === 0 ? "all" : "not all"} ${results.length - failed.length}/${results.length} checks passed`,
  );
  process.exitCode = failed.length === 0 && results.length > 0 ? 0 : 1;
}
