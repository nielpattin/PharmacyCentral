import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createOperationsRouter } from "./operations-routes.ts";
import type { OperationsRepository } from "./operations-repository.ts";

describe("dashboard and reports role gates", () => {
  const reads: string[] = [];
  const repository = {
    dashboard: () => {
      reads.push("dashboard");
      return Promise.resolve({});
    },
    report: () => {
      reads.push("report");
      return Promise.resolve({ rows: [], next: undefined });
    },
  } as unknown as OperationsRepository;

  const app = express();
  app.use(createOperationsRouter(repository));
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = app.listen(0, "127.0.0.1");
    const listening = Promise.withResolvers<void>();
    server.once("listening", () => listening.resolve());
    await listening.promise;
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    await closed.promise;
  });

  beforeEach(() => {
    reads.length = 0;
  });

  const get = (path: string, roles: string | undefined, actorType = "employee") =>
    fetch(`${base}${path}`, {
      headers: {
        "X-Actor-Type": actorType,
        ...(roles === undefined ? {} : { "X-Actor-Roles": roles }),
      },
    });

  describe.each(["/dashboard/summary", "/operations/dashboard"])("%s", (path) => {
    it.each(["Platform Admin", "Pharmacy Manager", "Warehouse Staff"])("answers %s", async (role) => {
      const response = await get(path, role);
      expect(response.status).toBe(200);
      expect(reads).toStrictEqual(["dashboard"]);
    });

    it("refuses a Pharmacist before reading anything", async () => {
      const response = await get(path, "Pharmacist");
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "role_forbidden" });
      expect(reads).toStrictEqual([]);
    });

    it("refuses a caller with no employee role header", async () => {
      const response = await get(path, undefined);
      expect(response.status).toBe(403);
      expect(reads).toStrictEqual([]);
    });

    it("refuses a service caller even with a role header", async () => {
      const response = await get(path, "Platform Admin", "system");
      expect(response.status).toBe(403);
      expect(reads).toStrictEqual([]);
    });
  });

  describe("GET /reports", () => {
    it.each(["Platform Admin", "Pharmacy Manager"])("answers %s", async (role) => {
      const response = await get("/reports", role);
      expect(response.status).toBe(200);
      expect(reads).toStrictEqual(["report"]);
    });

    it.each(["Warehouse Staff", "Pharmacist"])("refuses %s before reading anything", async (role) => {
      const response = await get("/reports", role);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "role_forbidden" });
      expect(reads).toStrictEqual([]);
    });
  });
});
