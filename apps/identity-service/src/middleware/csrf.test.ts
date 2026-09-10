import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createCsrfMiddleware } from "./csrf.ts";

const startServer = async (app: express.Express): Promise<{ server: Server; url: string }> => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server failed to bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const buildApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(createCsrfMiddleware());
  app.post("/auth/logout", (_req, res) => res.status(204).end());
  app.post("/auth/login", (_req, res) => res.json({ loggedIn: true }));
  return app;
};

describe("csrf middleware", () => {
  let activeServer: Server | undefined;

  afterEach(
    () =>
      activeServer &&
      new Promise<void>((resolve, reject) => activeServer?.close((error) => (error ? reject(error) : resolve()))),
  );

  it("rejects session-riding mutations without a token", async () => {
    const { server, url } = await startServer(buildApp());
    activeServer = server;
    const response = await fetch(`${url}/auth/logout`, { method: "POST" });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("csrf_mismatch");
  });

  it("accepts mutations when header matches cookie", async () => {
    const { server, url } = await startServer(buildApp());
    activeServer = server;
    const response = await fetch(`${url}/auth/logout`, {
      method: "POST",
      headers: { "X-CSRF-TOKEN": "token-123", Cookie: "pharmacy_csrf=token-123" },
    });
    expect(response.status).toBe(204);
  });

  it("rejects mismatched tokens", async () => {
    const { server, url } = await startServer(buildApp());
    activeServer = server;
    const response = await fetch(`${url}/auth/logout`, {
      method: "POST",
      headers: { "X-CSRF-TOKEN": "token-abc", Cookie: "pharmacy_csrf=token-xyz" },
    });
    expect(response.status).toBe(403);
  });

  it("exempts credential-first routes", async () => {
    const { server, url } = await startServer(buildApp());
    activeServer = server;
    const response = await fetch(`${url}/auth/login`, { method: "POST" });
    expect(response.status).toBe(200);
  });
});
