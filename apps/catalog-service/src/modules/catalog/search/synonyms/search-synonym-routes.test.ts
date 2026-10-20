import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import express from "express";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { CatalogDatabase } from "../../../../shared/infrastructure/database.ts";
import * as schema from "../../../../shared/infrastructure/schema.ts";
import {
  createTrustedRequestMiddleware,
  matchesPathPrefix,
  signInternalIdentityContext,
} from "../../../../middleware/trusted-request.ts";
import type { SynonymSetItem } from "../product-search-index.ts";
import { DrizzleSearchSynonymStore } from "./infrastructure/drizzle-search-synonym-store.ts";
import { createSearchSynonymRouter } from "./search-synonym-routes.ts";
import { SearchSynonymService } from "./search-synonym-service.ts";

const SECRET = "test-internal-identity-secret";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const MANAGER = "66666666-6666-4666-8666-666666666666";
const PHARMACIST = "99999999-9999-4999-8999-999999999999";
const WAREHOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const BASE = "/products/search-synonyms";
const PUBLIC_CATALOG_PATHS = [
  "/sites",
  "/storage-locations",
  "/products",
  "/suppliers",
  "/pricing",
  "/stores",
  "/availability",
];

const signedHeader = (actorType: "customer" | "employee", actorId: string, roles: string[]): string => {
  const now = Date.now();
  return signInternalIdentityContext(
    {
      version: "v1",
      requestId: "request-1",
      correlationId: "correlation-1",
      actorId,
      actorType,
      roles,
      siteIds: [],
      issuedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 300_000).toISOString(),
      audience: "catalog-service",
    },
    SECRET,
  );
};

const identity = {
  customer: { actorType: "customer" as const, actorId: CUSTOMER, roles: [] },
  warehouse: { actorType: "employee" as const, actorId: WAREHOUSE, roles: ["Warehouse Staff"] },
  admin: { actorType: "employee" as const, actorId: ADMIN, roles: ["Platform Admin"] },
  manager: { actorType: "employee" as const, actorId: MANAGER, roles: ["Pharmacy Manager"] },
  pharmacist: { actorType: "employee" as const, actorId: PHARMACIST, roles: ["Pharmacist"] },
};
type Actor = keyof typeof identity;

const groupRefSchema = z.object({ id: z.string(), version: z.number().int() });

describe("catalog search synonym routes", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const store = new DrizzleSearchSynonymStore({ db, pool: undefined } as unknown as CatalogDatabase);
  const syncSynonyms = vi.fn(async (_items: SynonymSetItem[]) => undefined);
  const service = new SearchSynonymService({ store, syncSynonyms, logger: { warn: vi.fn() } });
  let server: Server | undefined;

  beforeAll(async () => {
    process.env.INTERNAL_IDENTITY_SECRET = SECRET;
    const migration = new URL("../../../../../drizzle/migrations/0009_tense_leader.sql", import.meta.url);
    await client.exec(await readFile(migration, "utf8"));
  });

  beforeEach(async () => {
    await client.exec("DELETE FROM search_synonym_groups");
    syncSynonyms.mockClear();
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "1mb" }));
    app.use(
      createTrustedRequestMiddleware({
        expectedAudience: "catalog-service",
        isPublic: (request) =>
          ["GET", "HEAD"].includes(request.method) &&
          PUBLIC_CATALOG_PATHS.some((prefix) => matchesPathPrefix(request.path, prefix)),
      }),
    );
    app.use(createSearchSynonymRouter({ service, identitySecret: SECRET, audience: "catalog-service" }));
    app.use((_request, response) => response.status(404).json({ title: "Not Found", status: 404 }));
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
  });

  afterEach(async () => {
    if (!server) return;
    server.close();
    await once(server, "close");
    server = undefined;
  });

  afterAll(async () => {
    await client.close();
  });

  const base = (): string => {
    const address = server?.address();
    if (!address || typeof address === "string") throw new Error("The test server is not listening.");
    return `http://127.0.0.1:${address.port}`;
  };

  const call = async (
    method: string,
    path: string,
    actor: Actor | "anonymous",
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (actor !== "anonymous") {
      const who = identity[actor];
      headers["x-internal-identity-context"] = signedHeader(who.actorType, who.actorId, who.roles);
    }
    const init: RequestInit =
      body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
    const response = await fetch(`${base()}${path}`, init);
    const text = await response.text();
    return { status: response.status, json: text === "" ? undefined : JSON.parse(text) };
  };

  const createGroup = async (actor: Actor, terms: string[]): Promise<{ id: string; version: number }> => {
    const created = await call("POST", BASE, actor, { terms });
    expect(created.status).toBe(201);
    return groupRefSchema.parse(created.json);
  };

  const EDITORS: Actor[] = ["admin", "manager", "pharmacist"];
  const REFUSED: Actor[] = ["warehouse", "customer"];
  const TERMS = ["tiêu chảy", "đi ngoài"];

  describe("authentication and roles", () => {
    it("answers 401 without an identity context on every route", async () => {
      const id = crypto.randomUUID();
      const attempts = [
        ["GET", BASE],
        ["POST", BASE],
        ["PUT", `${BASE}/${id}`],
        ["POST", `${BASE}/${id}/approve`],
        ["DELETE", `${BASE}/${id}`],
      ] as const;
      for (const [method, path] of attempts) {
        const result = await call(method, path, "anonymous", method === "GET" || method === "DELETE" ? undefined : {});
        expect(result.status).toBe(401);
      }
    });

    it("answers 403 to every route for a warehouse employee or a customer", async () => {
      const id = crypto.randomUUID();
      for (const actor of REFUSED) {
        expect((await call("GET", BASE, actor)).status).toBe(403);
        expect((await call("POST", BASE, actor, { terms: TERMS })).status).toBe(403);
        expect((await call("PUT", `${BASE}/${id}`, actor, { terms: TERMS, version: 1 })).status).toBe(403);
        expect((await call("POST", `${BASE}/${id}/approve`, actor, { version: 1 })).status).toBe(403);
        expect((await call("DELETE", `${BASE}/${id}`, actor)).status).toBe(403);
      }
    });

    it("lets each editor role list, create, edit, approve and delete", async () => {
      for (const editor of EDITORS) {
        expect((await call("GET", BASE, editor)).status).toBe(200);
        const created = await createGroup(editor, TERMS);
        const reviewer = editor === "admin" ? "manager" : "admin";
        const edited = await call("PUT", `${BASE}/${created.id}`, editor, { terms: TERMS, version: 1 });
        expect(edited.status).toBe(200);
        const approved = await call("POST", `${BASE}/${created.id}/approve`, reviewer, {
          version: groupRefSchema.parse(edited.json).version,
        });
        expect(approved.status).toBe(200);
        expect((await call("DELETE", `${BASE}/${created.id}`, editor)).status).toBe(204);
      }
    });
  });

  describe("validation and errors", () => {
    it("answers 400 invalid_request for one term, a 61 character term, and terms that fold to the same text", async () => {
      const long = "a".repeat(61);
      for (const terms of [["một"], [long, "ho"], ["Tiêu chảy", "tieu chay"]]) {
        const result = await call("POST", BASE, "manager", { terms });
        expect(result.status).toBe(400);
        expect(result.json).toMatchObject({ code: "invalid_request", status: 400 });
      }
    });

    it("answers 404 for an unknown or malformed id", async () => {
      const result = await call("PUT", `${BASE}/not-a-uuid`, "manager", { terms: TERMS, version: 1 });
      expect(result.status).toBe(404);
      expect((await call("DELETE", `${BASE}/${crypto.randomUUID()}`, "manager")).status).toBe(404);
    });

    it("answers 409 version_conflict for a stale edit or approval", async () => {
      const created = await createGroup("manager", TERMS);
      const stale = await call("PUT", `${BASE}/${created.id}`, "manager", { terms: TERMS, version: 7 });
      expect(stale.status).toBe(409);
      expect(stale.json).toMatchObject({ code: "version_conflict" });
      const approve = await call("POST", `${BASE}/${created.id}/approve`, "pharmacist", { version: 7 });
      expect(approve.json).toMatchObject({ code: "version_conflict" });
    });

    it("answers 409 self_review_forbidden when the submitter approves", async () => {
      const created = await createGroup("manager", TERMS);

      const result = await call("POST", `${BASE}/${created.id}/approve`, "manager", { version: 1 });

      expect(result.status).toBe(409);
      expect(result.json).toMatchObject({ code: "self_review_forbidden" });
    });

    it("answers 409 already_approved for a second approval", async () => {
      const created = await createGroup("manager", TERMS);
      await call("POST", `${BASE}/${created.id}/approve`, "pharmacist", { version: 1 });

      const result = await call("POST", `${BASE}/${created.id}/approve`, "admin", { version: 2 });

      expect(result.status).toBe(409);
      expect(result.json).toMatchObject({ code: "already_approved" });
    });
  });

  describe("pushing the approved set", () => {
    it("pushes after approving, editing an approved group, and deleting an approved group", async () => {
      const created = await createGroup("manager", TERMS);
      await call("POST", `${BASE}/${created.id}/approve`, "pharmacist", { version: 1 });
      await service.pushesSettled();
      expect(syncSynonyms).toHaveBeenCalledTimes(1);

      // An edit sends the group back to pending, so the set empties and the group is not in live search.
      await call("PUT", `${BASE}/${created.id}`, "manager", { terms: TERMS, version: 2 });
      await service.pushesSettled();
      expect(syncSynonyms).toHaveBeenCalledTimes(2);
      expect(syncSynonyms).toHaveBeenLastCalledWith([]);

      // Only a second approval puts the edited group back in the set. A pending group's delete does not push.
      await call("POST", `${BASE}/${created.id}/approve`, "admin", { version: 3 });
      await service.pushesSettled();
      expect(syncSynonyms).toHaveBeenCalledTimes(3);

      await call("DELETE", `${BASE}/${created.id}`, "manager");
      await service.pushesSettled();
      expect(syncSynonyms).toHaveBeenCalledTimes(4);
      expect(syncSynonyms).toHaveBeenLastCalledWith([]);
    });

    it("does not push after creating or editing a pending group, or deleting one", async () => {
      const created = await createGroup("manager", TERMS);
      await call("PUT", `${BASE}/${created.id}`, "manager", { terms: ["ho", "ho khan"], version: 1 });
      await call("DELETE", `${BASE}/${created.id}`, "manager");
      await service.pushesSettled();

      expect(syncSynonyms).not.toHaveBeenCalled();
    });
  });
});
