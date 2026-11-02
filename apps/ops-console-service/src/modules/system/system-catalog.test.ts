import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.ts";
import { routeTableSchema, serviceCatalogSchema } from "../../contracts/system.ts";
import { accessToken, testAccessTokenVerifier } from "../../test-access-tokens.ts";
import type { Probes } from "./probes.ts";

const admin = { authorization: await accessToken({ roles: ["Platform Admin"] }) };

// The catalog and the routes read no probe, so the probes here are never called.
const unusedProbes: Probes = {
  services: [],
  prometheusUrl: "http://prometheus.test",
  rabbitmq: { url: "http://rabbit.test", user: "guest", password: "guest" },
  typesense: { url: "http://typesense.test", apiKey: "key" },
  timeoutMs: 100,
  queryTimeoutMs: 100,
  fetch: (() => Promise.reject(new Error("no probe expected"))) as typeof fetch,
};

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({
    verifier: testAccessTokenVerifier,
    probes: unusedProbes,
    links: [],
    logger: pino({ level: "silent" }),
  });
  const listening = Promise.withResolvers<AddressInfo>();
  server = app.listen(0, "127.0.0.1", () => listening.resolve(server.address() as AddressInfo));
  const { port } = await listening.promise;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
});

describe("GET /system/catalog", () => {
  it("answers the service catalog to a Platform Admin, uncached", async () => {
    const response = await fetch(`${base}/system/catalog`, { headers: admin });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = serviceCatalogSchema.parse(await response.json());
    expect(body.services.map((service) => service.name)).toContain("sales-service");
  });

  it("refuses a request without an access token and a signed-in manager", async () => {
    expect((await fetch(`${base}/system/catalog`)).status).toBe(401);
    const manager = await accessToken({ roles: ["Pharmacy Manager"] });
    const response = await fetch(`${base}/system/catalog`, { headers: { authorization: manager } });
    expect(response.status).toBe(403);
  });
});

describe("GET /system/routes", () => {
  it("answers the route table to a Platform Admin, uncached", async () => {
    const response = await fetch(`${base}/system/routes`, { headers: admin });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = routeTableSchema.parse(await response.json());
    expect(body.routes.length).toBeGreaterThan(0);
  });

  it("refuses a request without an access token and a signed-in manager", async () => {
    expect((await fetch(`${base}/system/routes`)).status).toBe(401);
    const manager = await accessToken({ roles: ["Pharmacy Manager"] });
    const response = await fetch(`${base}/system/routes`, { headers: { authorization: manager } });
    expect(response.status).toBe(403);
  });
});
