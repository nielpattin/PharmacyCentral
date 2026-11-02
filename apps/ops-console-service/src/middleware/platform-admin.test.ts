import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { accessToken, testAccessTokenVerifier } from "../test-access-tokens.ts";
import { requirePlatformAdmin } from "./platform-admin.ts";

describe("requirePlatformAdmin", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    server = undefined;
    await closed.promise;
  });

  const call = async (authorization: string | undefined, path = "/system/catalog"): Promise<Response> => {
    const app = express();
    app.use(requirePlatformAdmin({ verifier: testAccessTokenVerifier }));
    app.use((_request, response) => response.json({ ok: true }));
    server = createServer(app);
    const listening = Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", () => listening.resolve());
    await listening.promise;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server failed to bind");
    return fetch(`http://127.0.0.1:${address.port}${path}`, authorization ? { headers: { authorization } } : {});
  };

  it("admits an employee holding the Platform Admin role", async () => {
    expect((await call(await accessToken({ roles: ["Platform Admin"] }))).status).toBe(200);
  });

  it("answers 401 to a missing, malformed or expired token", async () => {
    const expired = await accessToken({ roles: ["Platform Admin"] }, new Date(Date.now() - 2 * 86_400_000));
    expect((await call(undefined)).status).toBe(401);
    expect((await call("Bearer not-a-jwt")).status).toBe(401);
    expect((await call(expired)).status).toBe(401);
  });

  it("refuses other roles, shoppers and tokens that require a password change", async () => {
    const manager = await call(await accessToken({ roles: ["Pharmacy Manager"] }));
    expect(manager.status).toBe(403);
    expect(await manager.json()).toMatchObject({ code: "platform_admin_required" });
    expect((await call(await accessToken({ actorType: "customer", roles: ["Platform Admin"] }))).status).toBe(403);
    const mustChange = await call(await accessToken({ roles: ["Platform Admin"], passwordChangeRequired: true }));
    expect(mustChange.status).toBe(403);
    expect(await mustChange.json()).toMatchObject({ code: "password_change_required" });
  });

  it("leaves the health probes open", async () => {
    expect((await call(undefined, "/health/live")).status).toBe(200);
  });
});
