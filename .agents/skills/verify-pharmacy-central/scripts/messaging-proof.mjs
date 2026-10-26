#!/usr/bin/env node
// Proves event delivery between the services against the real RabbitMQ and PostgreSQL of the local infra, using the
// real outbox publishers and event consumers from apps/. Everything runs in a scratch RabbitMQ vhost and three scratch
// databases, so it never touches a service, a port, a queue or a database that `pnpm dev` owns, and it calls no AI.
//
//   node .agents/skills/verify-pharmacy-central/scripts/messaging-proof.mjs [--run <id>]
//
// Exit 0: every check passed. Exit 1: a check failed, or the infra is down. Evidence goes to
// .tmp/verify/<run-id>/evidence/event-delivery/messaging-proof.json.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const runId = flag("--run") ?? currentRunId() ?? `messaging-${newRunId()}`;
const evidenceDir = join(runDir(runId), "evidence", "event-delivery");
mkdirSync(evidenceDir, { recursive: true });

const need = (service, name) => createRequire(join(REPO_ROOT, "apps", service, "package.json"))(name);
const amqp = need("sales-service", "amqplib");
const pg = need("sales-service", "pg");
const { drizzle } = need("sales-service", "drizzle-orm/node-postgres");
const { migrate } = need("sales-service", "drizzle-orm/node-postgres/migrator");
const app = (service, relative) => pathToFileURL(join(REPO_ROOT, "apps", service, "src", relative)).href;

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
    await sleep(200);
  }
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

const withChannel = async (fn) => {
  const connection = await amqp.connect(brokerUrl);
  try {
    return await fn(await connection.createChannel());
  } finally {
    await connection.close();
  }
};
const publish = (messages) =>
  withChannel(async (channel) => {
    for (const [key, body] of messages)
      channel.publish("pharmacy.events", key, Buffer.from(body), { persistent: true });
    await channel.checkExchange("pharmacy.events");
  });
const depth = (queue) => withChannel(async (channel) => (await channel.checkQueue(queue)).messageCount);
const drain = (queue) =>
  withChannel(async (channel) => {
    const messages = [];
    for (let next = await channel.get(queue, { noAck: true }); next; next = await channel.get(queue, { noAck: true }))
      messages.push(JSON.parse(next.content.toString()));
    return messages;
  });
const bindProofQueue = (queue, key) =>
  withChannel(async (channel) => {
    await channel.assertExchange("pharmacy.events", "topic", { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, "pharmacy.events", key);
  });

const adminDb = new pg.Client({
  host: "127.0.0.1",
  port: Number(requireEnv("POSTGRES_PORT")),
  user: requireEnv("POSTGRES_USER"),
  password: requireEnv("POSTGRES_PASSWORD"),
  database: "postgres",
});
const scratch = {};
/** Every database this run created, so one whose setup failed half way is still dropped. */
const created = [];
const closers = [];

const setUpDatabase = async (service, schemaPath) => {
  const database = `verify_${tag}_${service.replace("-service", "").replaceAll("-", "_")}`;
  await adminDb.query(`create database ${database}`);
  created.push(database);
  const pool = new pg.Pool({
    host: "127.0.0.1",
    port: Number(requireEnv("POSTGRES_PORT")),
    user: requireEnv("POSTGRES_USER"),
    password: requireEnv("POSTGRES_PASSWORD"),
    database,
    max: 6,
  });
  const schema = await import(app(service, schemaPath));
  const db = drizzle({ client: pool, schema });
  await migrate(db, { migrationsFolder: join(REPO_ROOT, "apps", service, "drizzle", "migrations") });
  scratch[service] = { database, pool, db, schema };
  return scratch[service];
};
const silentLogger = async (service) => (await import(app(service, "logger.ts"))).createLogger({ level: "silent" });

const relayCase = async ({ service, schemaPath, modulePath, className, eventType, queue, row }) => {
  const { db, pool, schema } = await setUpDatabase(service, schemaPath);
  await bindProofQueue(queue, eventType);
  const Relay = (await import(app(service, modulePath)))[className];
  const insert = async (count, from) => {
    const rows = [];
    for (let n = from; n < from + count; n += 1)
      rows.push(...(await db.insert(schema.outboxMessages).values(row(n)).returning()));
    return rows;
  };
  const pending = async () =>
    (await pool.query("select count(*)::int as n from outbox_messages where published_at is null")).rows[0].n;
  const relay = new Relay({ db, pool }, await silentLogger(service), brokerUrl);
  closers.push(() => relay.close());
  return { Relay, db, pool, insert, pending, relay, queue, service, logger: await silentLogger(service) };
};

const inventoryRow = (n) => ({
  eventType: "inventory.availability.changed.v1",
  schemaVersion: "1",
  payload: JSON.stringify({ productId: `p${n}`, siteId: "s", inStock: true }),
  occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, n)),
});
const plainRow = (eventType) => (n) => ({
  eventType,
  schemaVersion: "1",
  payload: JSON.stringify({ n }),
  occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, n)),
});
const aggregateRow = (eventType) => (n) => ({
  eventType,
  aggregateId: crypto.randomUUID(),
  payload: JSON.stringify({ orderId: `order-${n}` }),
  occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, n)),
});

try {
  await adminDb.connect();
  rabbitctl("add_vhost", vhost);
  rabbitctl("set_permissions", "-p", vhost, requireEnv("RABBITMQ_USER"), ".*", ".*", ".*");
  console.log(`INFO run ${runId}, vhost ${vhost}, databases verify_${tag}_*`);

  /** The relay of every service that publishes, so the audit check can reuse the ones already running. */
  const relays = {};
  const inventory = await relayCase({
    service: "inventory-service",
    schemaPath: "shared/infrastructure/schema.ts",
    modulePath: "modules/outbox-publisher.ts",
    className: "InventoryOutboxPublisher",
    eventType: "inventory.availability.changed.v1",
    queue: "proof.inventory",
    row: inventoryRow,
  });

  relays["inventory-service"] = inventory;
  await check("inventory relay: rows reach the broker in order and are marked published", async () => {
    const rows = await inventory.insert(3, 1);
    inventory.relay.start();
    await until("3 messages on the queue", async () => (await depth(inventory.queue)) >= 3, 15_000);
    const events = await drain(inventory.queue);
    if (JSON.stringify(events.map((event) => event.eventId)) !== JSON.stringify(rows.map((row) => row.id)))
      throw new Error("event ids or their order differ from the outbox rows");
    await until("every row marked published", async () => (await inventory.pending()) === 0, 5_000);
    return "3 rows -> 3 events, eventId equals the row id";
  });

  await check("inventory relay: rebuilds a dropped broker connection and sends what waited", async () => {
    rabbitctl("close_all_connections", "--vhost", vhost, "verify: connection drop");
    const [row] = await inventory.insert(1, 100);
    await until("the row reaches the queue after the drop", async () => (await depth(inventory.queue)) >= 1, 20_000);
    const [event] = await drain(inventory.queue);
    if (event.eventId !== row.id) throw new Error("a different event arrived");
    await until("row marked published", async () => (await inventory.pending()) === 0, 5_000);
    return "all connections of the vhost closed, then the row arrived";
  });

  await check("inventory relay: two relays on one database publish each row once", async () => {
    const second = new inventory.Relay({ db: inventory.db, pool: inventory.pool }, inventory.logger, brokerUrl);
    closers.push(() => second.close());
    second.start();
    const rows = await inventory.insert(40, 200);
    await until("every row marked published", async () => (await inventory.pending()) === 0, 30_000);
    await sleep(3_000);
    const events = await drain(inventory.queue);
    const ids = events.map((event) => event.eventId);
    if (new Set(ids).size !== ids.length) throw new Error(`${ids.length - new Set(ids).size} duplicate events`);
    if (ids.length !== rows.length) throw new Error(`${ids.length} events for ${rows.length} rows`);
    if (JSON.stringify(ids) !== JSON.stringify(rows.map((row) => row.id)))
      throw new Error("events left the outbox out of order");
    return "40 rows, 2 relays -> 40 events, no duplicate, order kept";
  });

  for (const spec of [
    {
      service: "sales-service",
      schemaPath: "shared/infrastructure/schema.ts",
      modulePath: "modules/outbox-publisher.ts",
      className: "SalesOutboxPublisher",
      eventType: "sales.order.created.v1",
      queue: "proof.sales",
    },
    {
      service: "payment-service",
      schemaPath: "modules/payments/infrastructure/schema.ts",
      modulePath: "modules/outbox-publisher.ts",
      className: "PaymentOutboxPublisher",
      eventType: "payment.invoice.paid.v1",
      queue: "proof.payment",
    },
    {
      service: "catalog-service",
      schemaPath: "shared/infrastructure/schema.ts",
      modulePath: "modules/outbox-publisher.ts",
      className: "CatalogOutboxPublisher",
      eventType: "catalog.audit.v1",
      queue: "proof.catalog",
      rowOf: plainRow,
    },
    {
      service: "identity-service",
      schemaPath: "shared/infrastructure/schema.ts",
      modulePath: "modules/outbox/outbox-publisher.ts",
      className: "IdentityOutboxPublisher",
      eventType: "identity.audit.v1",
      queue: "proof.identity",
      rowOf: plainRow,
    },
  ])
    await check(
      `${spec.service.replace("-service", "")} relay: rows reach the broker in order and are marked published`,
      async () => {
        const relayCaseResult = await relayCase({ ...spec, row: (spec.rowOf ?? aggregateRow)(spec.eventType) });
        relays[spec.service] = relayCaseResult;
        const rows = await relayCaseResult.insert(3, 1);
        relayCaseResult.relay.start();
        await until("3 messages on the queue", async () => (await depth(spec.queue)) >= 3, 15_000);
        const events = await drain(spec.queue);
        if (JSON.stringify(events.map((event) => event.eventId)) !== JSON.stringify(rows.map((row) => row.id)))
          throw new Error("event ids or their order differ from the outbox rows");
        await until("every row marked published", async () => (await relayCaseResult.pending()) === 0, 5_000);
        return "3 rows -> 3 events, eventId equals the row id";
      },
    );

  await check("audit entries: each service's recorder, its relay, and operations-query's audit log", async () => {
    const auditModules = {
      "identity-service": "modules/outbox/audit-recorder.ts",
      "catalog-service": "modules/audit/audit-recorder.ts",
      "inventory-service": "modules/audit/audit-recorder.ts",
    };
    const ops = await setUpDatabase("operations-query-service", "shared/infrastructure/schema.ts");
    const { OperationsRepository } = await import(app("operations-query-service", "modules/operations-repository.ts"));
    const repository = new OperationsRepository({ db: ops.db, pool: ops.pool });
    await bindProofQueue("proof.audit", "*.audit.v1");
    const actor = crypto.randomUUID();
    const entityIds = {};
    for (const [service, module] of Object.entries(auditModules)) {
      const relay = relays[service];
      if (!relay) throw new Error(`no relay was set up for ${service}`);
      const { createAuditRecorder } = await import(app(service, module));
      entityIds[service] = crypto.randomUUID();
      await createAuditRecorder({ db: relay.db, pool: relay.pool }, relay.logger).record({
        action: `${service.replace("-service", "")}.proof.done`,
        entityType: "proof",
        entityId: entityIds[service],
        actorId: actor,
        details: { kept: "yes" },
      });
    }
    await until("three audit events on the queue", async () => (await depth("proof.audit")) >= 3, 20_000);
    const events = await drain("proof.audit");
    for (const event of events) {
      if (event.actorId !== actor)
        throw new Error(`${event.eventType}: the envelope carries actorId ${event.actorId}, expected the actor`);
      await repository.apply(event);
    }
    const { rows } = await ops.pool.query(
      "select action, entity_type, entity_id::text, actor_id::text from audit_events where actor_id = $1 order by action",
      [actor],
    );
    const expected = Object.keys(auditModules)
      .map((service) => `${service.replace("-service", "")}.proof.done`)
      .sort();
    if (JSON.stringify(rows.map((row) => row.action)) !== JSON.stringify(expected))
      throw new Error(
        `audit_events holds ${JSON.stringify(rows.map((row) => row.action))}, expected ${JSON.stringify(expected)}`,
      );
    if (rows.some((row) => row.entity_type !== "proof" || row.actor_id !== actor))
      throw new Error("an entry lost its entity type or actor");
    return "3 services -> 3 outbox rows -> 3 events with the actor on the envelope -> 3 audit_events rows";
  });

  await check("consumers: retry, dead-letter, drop-proof, and reconnect", async () => {
    const applied = { sales: [], catalog: [], ops: [] };
    const tries = { sales: 0, catalog: 0, ops: 0 };
    const stubFor =
      (kind, keyOf) =>
      async (...args) => {
        const key = keyOf(...args);
        if (key === "poison") {
          tries[kind] += 1;
          throw new Error("poison");
        }
        applied[kind].push(key);
      };
    const salesLogger = await silentLogger("sales-service");
    const { SalesPaymentEventConsumer } = await import(app("sales-service", "modules/payment-event-consumer.ts"));
    const { RabbitMqAvailabilityConsumer } = await import(
      app("catalog-service", "modules/availability/infrastructure/rabbitmq-availability-consumer.ts")
    );
    const { RabbitMqEventConsumer } = await import(
      app("operations-query-service", "modules/rabbitmq-event-consumer.ts")
    );
    const consumers = [
      // The stand-in repository answers nothing, so the order stock is never asked to cancel or release.
      new SalesPaymentEventConsumer(
        { applyPaymentStatus: stubFor("sales", (id) => id) },
        { cancelRefunded: async () => undefined },
        salesLogger,
        brokerUrl,
      ),
      new RabbitMqAvailabilityConsumer({ apply: stubFor("catalog", (x) => x.productId) }, salesLogger, brokerUrl),
      new RabbitMqEventConsumer(
        { apply: stubFor("ops", (event) => event.payload.orderId ?? event.payload.productId) },
        salesLogger,
        brokerUrl,
      ),
    ];
    for (const consumer of consumers) {
      closers.push(() => consumer.close());
      consumer.start();
    }
    await until(
      "three consumers attached",
      async () =>
        Number(
          rabbitctl("list_consumers", "-p", vhost)
            .split("\n")
            .filter((line) => line.includes("true")).length,
        ) >= 3,
      15_000,
    );

    const envelope = (eventType, payload, n) =>
      JSON.stringify({
        eventId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        eventType,
        occurredAt: new Date().toISOString(),
        payload,
      });
    await publish([
      ["payment.invoice.paid.v1", envelope("payment.invoice.paid.v1", { orderId: "ok" }, 1)],
      ["payment.invoice.paid.v1", envelope("payment.invoice.paid.v1", { orderId: "poison" }, 2)],
      [
        "inventory.availability.changed.v1",
        envelope("inventory.availability.changed.v1", { productId: "ok", siteId: "s", inStock: true }, 3),
      ],
      [
        "inventory.availability.changed.v1",
        envelope("inventory.availability.changed.v1", { productId: "poison", siteId: "s", inStock: true }, 4),
      ],
      ["inventory.availability.changed.v1", "{not json"],
    ]);
    await until(
      "every failure parked on a dead-letter queue",
      async () => (await depth("operations-query.events.v2.dead")) >= 3,
      45_000,
    );
    const dead = {
      sales: await depth("sales.payment-events.v2.dead"),
      catalog: await depth("catalog.availability.v2.dead"),
      ops: await depth("operations-query.events.v2.dead"),
    };
    const expected = { sales: 1, catalog: 2, ops: 3 };
    if (JSON.stringify(dead) !== JSON.stringify(expected))
      throw new Error(`dead-letter counts ${JSON.stringify(dead)}, expected ${JSON.stringify(expected)}`);
    // The operations consumer binds every routing key, so it sees both poison messages: 2 x 5 attempts.
    if (JSON.stringify(tries) !== JSON.stringify({ sales: 5, catalog: 5, ops: 10 }))
      throw new Error(
        `attempts ${JSON.stringify(tries)}, expected 5 per poison message the consumer receives (sales 5, catalog 5, operations 10)`,
      );
    if (applied.sales.join() !== "ok" || applied.catalog.join() !== "ok" || applied.ops.join() !== "ok,ok")
      throw new Error(`applied ${JSON.stringify(applied)}`);
    for (const queue of ["sales.payment-events.v2", "catalog.availability.v2", "operations-query.events.v2"])
      if ((await depth(queue)) !== 0) throw new Error(`${queue} still holds messages`);

    rabbitctl("close_all_connections", "--vhost", vhost, "verify: connection drop");
    await until(
      "three consumers attached again",
      async () => {
        const attached = rabbitctl("list_consumers", "-p", vhost)
          .split("\n")
          .filter((line) => line.includes("true")).length;
        return attached >= 3;
      },
      40_000,
    );
    await publish([
      ["payment.invoice.paid.v1", envelope("payment.invoice.paid.v1", { orderId: "after-drop" }, 5)],
      [
        "inventory.availability.changed.v1",
        envelope("inventory.availability.changed.v1", { productId: "after-drop", siteId: "s", inStock: false }, 6),
      ],
    ]);
    await until(
      "events applied after the drop",
      async () =>
        applied.sales.includes("after-drop") &&
        applied.catalog.includes("after-drop") &&
        applied.ops.filter((key) => key === "after-drop").length === 2,
      20_000,
    );
    return "5 attempts per poison message, dead queues 1/2/3 (sales/catalog/operations), nothing lost, consumers back after a connection drop";
  });

  const services = [
    ["inventory-service", "INVENTORY_PORT"],
    ["sales-service", "SALES_PORT"],
    ["payment-service", "PAYMENT_PORT"],
    ["operations-query-service", "OPERATIONS_QUERY_PORT"],
    ["catalog-service", "CATALOG_PORT"],
    ["identity-service", "IDENTITY_PORT"],
  ];
  const envWithout = join(evidenceDir, "env-without-rabbitmq.tmp");
  writeFileSync(
    envWithout,
    readFileSync(join(REPO_ROOT, ".env"), "utf8")
      .split(/\r?\n/)
      .filter((line) => !line.startsWith("RABBITMQ_URL="))
      .join("\n"),
  );
  closers.push(() => rmSync(envWithout, { force: true }));
  for (const [service] of services)
    await check(`${service} refuses to start without RABBITMQ_URL`, async () => {
      const env = { ...process.env };
      delete env.RABBITMQ_URL;
      const child = spawn(
        process.execPath,
        [
          "--experimental-transform-types",
          "--no-warnings",
          `--env-file=${envWithout}`,
          `--env-file=.env.dev`,
          "src/main.ts",
        ],
        { cwd: join(REPO_ROOT, "apps", service), env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      const exited = await Promise.race([
        new Promise((done) => child.once("exit", (code) => done(code))),
        sleep(25_000).then(() => "still-running"),
      ]);
      if (exited === "still-running") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        throw new Error("the service kept running without RABBITMQ_URL");
      }
      if (exited === 0 || !output.includes("Missing required environment variable: RABBITMQ_URL"))
        throw new Error(`exit ${exited}, output: ${output.trim().slice(0, 300)}`);
      return `exit ${exited}`;
    });
} finally {
  for (const close of closers.reverse()) await Promise.resolve(close()).catch(() => undefined);
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
    join(evidenceDir, "messaging-proof.json"),
    `${JSON.stringify({ feature: "event-delivery", entryPoint: "scripts/messaging-proof.mjs", runId, vhost, results }, null, 2)}\n`,
  );
  console.log(
    `RESULT ${failed.length === 0 ? "all" : "not all"} ${results.length - failed.length}/${results.length} checks passed`,
  );
  process.exitCode = failed.length === 0 && results.length > 0 ? 0 : 1;
}
