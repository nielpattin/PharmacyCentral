import { PGlite } from "@electric-sql/pglite";
import express from "express";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../../shared/infrastructure/database.ts";
import * as schema from "../../shared/infrastructure/schema.ts";

import { ActionPlanRepository } from "./action-plan-repository.ts";
import { createActionPlanRouter } from "./action-plan-routes.ts";
import {
  EmployeeDirectoryUnavailableError,
  type ActiveEmployee,
  type EmployeeDirectory,
} from "./identity-employee-client.ts";

const migrationsFolder = fileURLToPath(new URL("../../../drizzle/migrations", import.meta.url));
const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const siteA = idOf(0xa);
const siteB = idOf(0xb);
// Due dates far in the future, so the "today or later" rule never depends on the day the suite runs.
const FUTURE = "2099-06-01";
const LATER = "2099-07-01";

type Actor = { id: string; roles: string; sites?: string };
const actors = {
  admin: { id: idOf(0x1), roles: "Platform Admin" } satisfies Actor,
  manager: { id: idOf(0x2), roles: "Pharmacy Manager", sites: siteA } satisfies Actor,
  ownerOne: { id: idOf(0x3), roles: "Pharmacist", sites: siteA } satisfies Actor,
  ownerTwo: { id: idOf(0x4), roles: "Pharmacist", sites: siteB } satisfies Actor,
  warehouse: { id: idOf(0x5), roles: "Warehouse Staff", sites: siteA } satisfies Actor,
  pharmacistNoSite: { id: idOf(0x6), roles: "Pharmacist" } satisfies Actor,
};

/** The active employees identity-service would answer for. Any other id is not an active employee. */
const employees = new Map<string, ActiveEmployee>([
  [actors.ownerOne.id, { id: actors.ownerOne.id, displayName: "Dược sĩ A", roles: ["Pharmacist"], siteIds: [siteA] }],
  [actors.ownerTwo.id, { id: actors.ownerTwo.id, displayName: "Dược sĩ B", roles: ["Pharmacist"], siteIds: [siteB] }],
  [actors.warehouse.id, { id: actors.warehouse.id, displayName: "Kho", roles: ["Warehouse Staff"], siteIds: [siteA] }],
  [idOf(0x7), { id: idOf(0x7), displayName: "Quản trị", roles: ["Platform Admin"], siteIds: [] }],
]);

let identityDown = false;
const directory: EmployeeDirectory = {
  findActiveEmployee: async (id) => {
    if (identityDown) throw new EmployeeDirectoryUnavailableError();
    return employees.get(id);
  },
};

const client = new PGlite();
const database = drizzle({ client, schema });
const repository = new ActionPlanRepository({ db: database, pool: undefined } as unknown as InventoryDatabase);

let server: Server | undefined;
let url = "";

beforeAll(async () => {
  await migrate(database, { migrationsFolder });
  const app = express();
  app.use(express.json());
  app.use(createActionPlanRouter(repository, { employees: directory }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) =>
    response.status(500).json({ error: String(error) }),
  );
  server = createServer(app);
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) {
    const closed = Promise.withResolvers<void>();
    server.close((error) => (error ? closed.reject(error) : closed.resolve()));
    await closed.promise;
  }
  await client.close();
});

const call = (method: string, path: string, actor: Actor, body?: unknown) =>
  fetch(`${url}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-actor-id": actor.id,
      "x-actor-roles": actor.roles,
      ...(actor.sites ? { "x-actor-site-ids": actor.sites } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

let sequence = 0;
/** Creates a plan through the route as the manager, unless the test names another actor, site or owner. */
const createPlan = async (overrides: Record<string, unknown> = {}, actor: Actor = actors.manager) => {
  sequence += 1;
  const body = {
    sourceType: "replenishment",
    sourceRef: `replenishment:${siteA}:${idOf(0x800 + sequence)}`,
    title: `Việc ${sequence}`,
    siteId: siteA,
    ownerId: actors.ownerOne.id,
    dueDate: FUTURE,
    ...overrides,
  };
  const response = await call("POST", "/inventory/action-plans", actor, body);
  return { status: response.status, body: (await response.json()) as PlanBody };
};

type PlanBody = {
  id: string;
  sourceType: string;
  title: string;
  ownerId: string;
  siteId: string | null;
  status: string;
  dueDate: string;
  completedAt: string | null;
  createdAt: string;
};

describe("POST /inventory/action-plans", () => {
  it("lets a Pharmacy Manager create a plan for an owner at her site", async () => {
    const { status, body } = await createPlan({ detail: "Đặt bù theo gợi ý", productId: idOf(0x9) });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      sourceType: "replenishment",
      siteId: siteA,
      ownerId: actors.ownerOne.id,
      dueDate: FUTURE,
      status: "open",
      detail: "Đặt bù theo gợi ý",
      productId: idOf(0x9),
      completedAt: null,
      createdBy: actors.manager.id,
    });
  });

  it("refuses a Pharmacist, who may own a plan but not create one", async () => {
    const { status, body } = await createPlan({}, actors.ownerOne);
    expect(status).toBe(403);
    expect(body).toMatchObject({ code: "role_forbidden" });
  });

  it("refuses a plan at a site outside the manager's sites", async () => {
    const { status, body } = await createPlan({ siteId: siteB, ownerId: actors.ownerTwo.id });
    expect(status).toBe(403);
    expect(body).toMatchObject({ code: "site_access_denied" });
  });

  it("refuses a manager a plan with no site, which only a Platform Admin can see", async () => {
    const { status, body } = await createPlan({ siteId: undefined });
    expect(status).toBe(403);
    expect(body).toMatchObject({ code: "site_access_denied" });
  });

  it("answers 422 owner_not_found for an id that is not an active employee", async () => {
    const { status, body } = await createPlan({ ownerId: idOf(0x999) });
    expect(status).toBe(422);
    expect(body).toMatchObject({ code: "owner_not_found" });
  });

  it("answers 422 owner_not_at_site for an owner who does not hold the plan's site", async () => {
    const { status, body } = await createPlan({ ownerId: actors.ownerTwo.id });
    expect(status).toBe(422);
    expect(body).toMatchObject({ code: "owner_not_at_site" });
  });

  it("lets a Platform Admin create a plan with no site, and an owner with the Platform Admin role hold any site", async () => {
    const withoutSite = await createPlan(
      { siteId: undefined, sourceType: "price_warning", sourceRef: "price_warning:p-admin" },
      actors.admin,
    );
    expect(withoutSite.status).toBe(201);
    expect(withoutSite.body.siteId).toBeNull();

    const adminOwner = await createPlan({ ownerId: idOf(0x7) });
    expect(adminOwner.status).toBe(201);
  });

  it("refuses a due date in the past or one the calendar does not have", async () => {
    expect((await createPlan({ dueDate: "2000-01-01" })).status).toBe(400);
    expect((await createPlan({ dueDate: "2099-02-30" })).status).toBe(400);
  });

  it("answers 409 plan_exists with the id of the open plan for the same origin", async () => {
    const sourceRef = `expiry:${siteA}:${idOf(0x777)}`;
    const first = await createPlan({ sourceType: "expiry", sourceRef });
    expect(first.status).toBe(201);
    const second = await createPlan({ sourceType: "expiry", sourceRef });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: "plan_exists", planId: first.body.id });
  });

  it("answers 503 when identity-service cannot confirm the owner", async () => {
    identityDown = true;
    try {
      const { status, body } = await createPlan();
      expect(status).toBe(503);
      expect(body).toMatchObject({ code: "identity_unavailable" });
    } finally {
      identityDown = false;
    }
  });
});

describe("PATCH /inventory/action-plans/:id", () => {
  it("lets the owner move her plan's status, and sets then clears the completion time", async () => {
    const { body: plan } = await createPlan({ sourceRef: `replenishment:${siteA}:${idOf(0x101)}` });
    const started = await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.ownerOne, {
      status: "in_progress",
    });
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ status: "in_progress", completedAt: null });

    const done = await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.ownerOne, { status: "done" });
    const doneBody = (await done.json()) as PlanBody;
    expect(doneBody).toMatchObject({ status: "done" });
    expect(doneBody.completedAt).not.toBeNull();

    const reopened = await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.ownerOne, { status: "open" });
    expect(await reopened.json()).toMatchObject({ status: "open", completedAt: null });
  });

  it("refuses the owner a due date, a title, or a status change together with any other field", async () => {
    const { body: plan } = await createPlan({ sourceRef: `replenishment:${siteA}:${idOf(0x102)}` });
    const dueDate = await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.ownerOne, { dueDate: LATER });
    expect(dueDate.status).toBe(403);
    const title = await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.ownerOne, { title: "Đổi tên" });
    expect(title.status).toBe(403);
    const mixed = await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.ownerOne, {
      status: "done",
      title: "x",
    });
    expect(mixed.status).toBe(403);
  });

  it("refuses an employee who neither owns the plan nor manages it", async () => {
    const { body: plan } = await createPlan({ sourceRef: `replenishment:${siteA}:${idOf(0x103)}` });
    const otherPharmacist = await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.ownerTwo, {
      status: "done",
    });
    expect(otherPharmacist.status).toBe(403);
    const warehouse = await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.warehouse, { status: "done" });
    expect(warehouse.status).toBe(403);
  });

  it("lets a manager change any field of a plan at her site, including the owner and the due date", async () => {
    const { body: plan } = await createPlan({ sourceRef: `replenishment:${siteA}:${idOf(0x104)}` });
    const response = await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.manager, {
      title: "Đổi tên việc",
      detail: null,
      dueDate: LATER,
      ownerId: actors.warehouse.id,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      title: "Đổi tên việc",
      detail: null,
      dueDate: LATER,
      ownerId: actors.warehouse.id,
    });
  });

  it("refuses a manager a plan at another site, and an owner change to someone not at the plan's site", async () => {
    const elsewhere = await createPlan(
      { siteId: siteB, ownerId: actors.ownerTwo.id, sourceRef: `replenishment:${siteB}:${idOf(0x105)}` },
      actors.admin,
    );
    expect(elsewhere.status).toBe(201);
    const outOfScope = await call("PATCH", `/inventory/action-plans/${elsewhere.body.id}`, actors.manager, {
      title: "x",
    });
    expect(outOfScope.status).toBe(403);

    const { body: plan } = await createPlan({ sourceRef: `replenishment:${siteA}:${idOf(0x106)}` });
    const wrongOwner = await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.manager, {
      ownerId: actors.ownerTwo.id,
    });
    expect(wrongOwner.status).toBe(422);
    expect(await wrongOwner.json()).toMatchObject({ code: "owner_not_at_site" });
  });

  it("answers 409 when reopening a done plan whose origin has a live plan now", async () => {
    const sourceRef = `dead_stock:${siteA}:${idOf(0x107)}`;
    const done = await createPlan({ sourceType: "dead_stock", sourceRef });
    await call("PATCH", `/inventory/action-plans/${done.body.id}`, actors.manager, { status: "done" });
    const live = await createPlan({ sourceType: "dead_stock", sourceRef });
    expect(live.status).toBe(201);

    const reopen = await call("PATCH", `/inventory/action-plans/${done.body.id}`, actors.ownerOne, { status: "open" });
    expect(reopen.status).toBe(409);
    expect(await reopen.json()).toMatchObject({ code: "plan_exists", planId: live.body.id });
  });

  it("answers 404 for an unknown plan and 400 for an empty or past change", async () => {
    const missing = await call("PATCH", `/inventory/action-plans/${idOf(0x888)}`, actors.manager, { title: "x" });
    expect(missing.status).toBe(404);

    const { body: plan } = await createPlan({ sourceRef: `replenishment:${siteA}:${idOf(0x108)}` });
    expect((await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.manager, {})).status).toBe(400);
    expect(
      (await call("PATCH", `/inventory/action-plans/${plan.id}`, actors.manager, { dueDate: "2000-01-01" })).status,
    ).toBe(400);
  });
});

describe("GET /inventory/action-plans", () => {
  // One plan per visibility rule, created once the server is up so each assertion can name its own rows.
  type CreatedPlan = { status: number; body: PlanBody };
  type SeededPlans = [CreatedPlan, CreatedPlan, CreatedPlan, CreatedPlan];
  const seedVisibilityPlans = (): Promise<SeededPlans> =>
    Promise.all([
      createPlan({ sourceRef: `replenishment:${siteA}:${idOf(0x201)}`, title: "Lọc quyền A" }),
      createPlan({
        sourceRef: `replenishment:${siteA}:${idOf(0x202)}`,
        title: "Lọc quyền A2",
        ownerId: actors.warehouse.id,
      }),
      createPlan(
        { siteId: siteB, ownerId: actors.ownerTwo.id, sourceRef: `replenishment:${siteB}:${idOf(0x203)}` },
        actors.admin,
      ),
      createPlan(
        {
          siteId: undefined,
          sourceType: "price_warning",
          sourceRef: "price_warning:p-list",
          ownerId: actors.ownerOne.id,
        },
        actors.admin,
      ),
    ]);
  let seeded: SeededPlans;
  beforeAll(async () => {
    seeded = await seedVisibilityPlans();
  });

  const list = async (actor: Actor, query = "") => {
    const response = await call("GET", `/inventory/action-plans${query}`, actor);
    const rows = (await response.json()) as PlanBody[];
    return { status: response.status, headers: response.headers, rows };
  };

  it("shows a manager the plans of her sites, and no other site's or site-less plan", async () => {
    const [own, , other, sitelessPlan] = seeded;
    const { status, rows } = await list(actors.manager);
    expect(status).toBe(200);
    expect(rows.every((row) => row.siteId === siteA)).toBe(true);
    expect(rows.map((row) => row.id)).toContain(own.body.id);
    expect(rows.map((row) => row.id)).not.toContain(other.body.id);
    expect(rows.map((row) => row.id)).not.toContain(sitelessPlan.body.id);
  });

  it("shows a Platform Admin every plan, including the plans with no site", async () => {
    const [, , , sitelessPlan] = seeded;
    const { rows } = await list(actors.admin);
    expect(rows.map((row) => row.id)).toContain(sitelessPlan.body.id);
    expect(rows.some((row) => row.siteId === siteB)).toBe(true);
  });

  it("shows any other employee only the plans she owns", async () => {
    const [ownerPlan, warehousePlan, other] = seeded;
    const { status, rows } = await list(actors.ownerOne);
    expect(status).toBe(200);
    expect(rows.every((row) => row.ownerId === actors.ownerOne.id)).toBe(true);
    expect(rows.map((row) => row.id)).toContain(ownerPlan.body.id);
    expect(rows.map((row) => row.id)).not.toContain(warehousePlan.body.id);
    expect(rows.map((row) => row.id)).not.toContain(other.body.id);

    const warehouse = await list(actors.warehouse);
    expect(warehouse.rows.every((row) => row.ownerId === actors.warehouse.id)).toBe(true);
    expect(warehouse.rows.map((row) => row.id)).toContain(warehousePlan.body.id);
  });

  it("returns an empty page for another owner's plans, and for an employee who owns none", async () => {
    const asOther = await list(actors.ownerOne, `?ownerId=${actors.ownerTwo.id}`);
    expect(asOther.status).toBe(200);
    expect(asOther.rows).toEqual([]);

    const noSite = await call("GET", "/inventory/action-plans", actors.pharmacistNoSite);
    expect(noSite.status).toBe(200);
    expect(await noSite.json()).toEqual([]);
  });

  it("filters by owner, status, source type, site and title text", async () => {
    await createPlan({ sourceType: "expiry", sourceRef: `expiry:${siteA}:${idOf(0x204)}`, title: "Lô sắp hết hạn Q" });

    const byStatus = await list(actors.manager, "?status=open");
    expect(byStatus.rows.every((row) => row.status === "open")).toBe(true);

    const byOwner = await list(actors.manager, `?ownerId=${actors.warehouse.id}`);
    expect(byOwner.rows.length).toBeGreaterThan(0);
    expect(byOwner.rows.every((row) => row.ownerId === actors.warehouse.id)).toBe(true);

    const bySource = await list(actors.manager, "?sourceType=expiry");
    expect(bySource.rows.length).toBeGreaterThan(0);
    expect(bySource.rows.every((row) => row.sourceType === "expiry")).toBe(true);

    const byText = await list(actors.manager, "?q=hết%20hạn%20q");
    expect(byText.rows.map((row) => row.title)).toEqual(["Lô sắp hết hạn Q"]);

    const bySite = await list(actors.admin, `?siteId=${siteB}`);
    expect(bySite.rows.every((row) => row.siteId === siteB)).toBe(true);
  });

  it("treats a blank filter as no filter, and refuses a value the filter does not know", async () => {
    const blank = await list(actors.manager, "?status=&ownerId=&sourceType=");
    expect(blank.status).toBe(200);
    expect(blank.rows.length).toBeGreaterThan(0);

    const unknown = await call("GET", "/inventory/action-plans?status=closed", actors.manager);
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: "invalid_request" });
  });

  it("pages newest first with X-Next-Cursor, and refuses a cursor it did not make", async () => {
    const first = await list(actors.admin, "?limit=2");
    expect(first.rows).toHaveLength(2);
    const next = first.headers.get("x-next-cursor");
    expect(next).toEqual(expect.any(String));

    const second = await list(actors.admin, `?limit=2&cursor=${encodeURIComponent(next ?? "")}`);
    expect(second.rows).toHaveLength(2);
    expect(second.rows.map((row) => row.id)).not.toContain(first.rows[0]?.id);
    const lastOfFirst = first.rows[1];
    const firstOfSecond = second.rows[0];
    expect(
      lastOfFirst && firstOfSecond && Date.parse(lastOfFirst.createdAt) >= Date.parse(firstOfSecond.createdAt),
    ).toBe(true);

    const allOnOnePage = await list(actors.admin, "?limit=500");
    expect(allOnOnePage.headers.get("x-next-cursor")).toBeNull();

    const bad = await call("GET", "/inventory/action-plans?cursor=not-a-cursor", actors.admin);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid_cursor" });
  });
});
