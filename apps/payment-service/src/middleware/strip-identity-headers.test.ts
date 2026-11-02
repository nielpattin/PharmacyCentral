import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { stripIdentityHeaders } from "./strip-identity-headers.ts";

const startServer = async (app: express.Express): Promise<{ server: Server; url: string }> => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server failed to bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

describe("stripIdentityHeaders", () => {
  let activeServer: Server | undefined;

  afterEach(async () => {
    if (!activeServer) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    activeServer.close(() => resolve());
    activeServer = undefined;
    await promise;
  });

  it("removes identity headers before the webhook handler runs", async () => {
    const app = express();
    let seen: Record<string, string | undefined> = {};

    app.post(
      "/payments/sepay/webhook",
      stripIdentityHeaders,
      express.raw({ type: "application/json", limit: "1mb" }),
      (req, res) => {
        seen = {
          actorId: req.header("x-actor-id"),
          actorType: req.header("x-actor-type"),
          actorSiteIds: req.header("x-actor-site-ids"),
          sepaySignature: req.header("x-sepay-signature"),
        };
        res.json({ success: true });
      },
    );

    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/payments/sepay/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-actor-id": "00000000-0000-4000-8000-000000000099",
        "x-actor-type": "employee",
        "x-actor-site-ids": "00000000-0000-4000-8000-000000000010",
        "x-sepay-signature": "sig",
      },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(seen).toEqual({
      actorId: undefined,
      actorType: undefined,
      actorSiteIds: undefined,
      sepaySignature: "sig",
    });
  });
});
