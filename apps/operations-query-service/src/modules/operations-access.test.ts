import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { dashboardActionFamilies } from "./operations-access.ts";
import { createOperationsRouter } from "./operations-routes.ts";
import type { OperationsRepository } from "./operations-repository.ts";

describe("dashboard role gates", () => {
  const reads: string[] = [];
  const dashboardOptions: unknown[] = [];
  const repository = {
    dashboard: (_identity: unknown, _siteIds: unknown, options: unknown) => {
      reads.push("dashboard");
      dashboardOptions.push(options);
      return Promise.resolve({});
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
    dashboardOptions.length = 0;
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

    it("hands the repository the action families the caller's roles may read", async () => {
      await get(path, "Warehouse Staff");
      await get(path, "Pharmacy Manager");
      await get(path, "Platform Admin,Warehouse Staff");
      expect(dashboardOptions).toStrictEqual([
        { actionFamilies: ["inventory", "procurement"] },
        { actionFamilies: undefined },
        { actionFamilies: undefined },
      ]);
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
});

describe("dashboard recent-activity families", () => {
  it("lets Platform Admin and Pharmacy Manager read every family", () => {
    expect(dashboardActionFamilies(["Platform Admin"])).toBeUndefined();
    expect(dashboardActionFamilies(["Pharmacy Manager"])).toBeUndefined();
  });

  it("limits Warehouse Staff to the stock and purchasing families", () => {
    expect(dashboardActionFamilies(["Warehouse Staff"])).toStrictEqual(["inventory", "procurement"]);
  });

  it("gives an account with several roles what its widest role may read", () => {
    expect(dashboardActionFamilies(["Warehouse Staff", "Pharmacy Manager"])).toBeUndefined();
    expect(dashboardActionFamilies(["Warehouse Staff", "Platform Admin"])).toBeUndefined();
    expect(dashboardActionFamilies(["Warehouse Staff", "Pharmacist"])).toStrictEqual(["inventory", "procurement"]);
  });

  it("gives a role set with no dashboard role nothing", () => {
    expect(dashboardActionFamilies(["Pharmacist"])).toStrictEqual([]);
    expect(dashboardActionFamilies([])).toStrictEqual([]);
  });
});
