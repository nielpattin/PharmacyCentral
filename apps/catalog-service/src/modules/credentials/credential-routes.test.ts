import express from "express";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Request } from "express";
import { aiProviderCatalog } from "../../contracts/credentials.ts";
import type { AiProviderSettings } from "../../infrastructure/ai-provider-config.ts";
import { SecretBox } from "../../infrastructure/secret-box.ts";
import { createTrustedRequestMiddleware, matchesPathPrefix } from "../../middleware/trusted-request.ts";
import { bearerHeaders, testVerifier } from "../../test-support/access-tokens.ts";
import { createCredentialRouter } from "./credential-routes.ts";
import { AiCredentialVault } from "./ai-credential-vault.ts";
import { createMemoryCredentialStore } from "./memory-credential-store.ts";

const ADMIN = "55555555-5555-4555-8555-555555555555";
const MANAGER = "66666666-6666-4666-8666-666666666666";
const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const PATH = "/products/search-credential";
const SETTINGS: Omit<AiProviderSettings, "apiKey"> = {
  provider: "gemini",
  model: "example-model-1",
  baseUrl: "https://provider.example.test",
};
const ENVIRONMENT: AiProviderSettings = { ...SETTINGS, apiKey: "environment-key-value-ABCD" };
const PROVIDERS = [
  { id: "gemini", ...aiProviderCatalog.gemini },
  { id: "openai-compatible", ...aiProviderCatalog["openai-compatible"] },
];
const PUBLIC_CATALOG_PATHS = [
  "/sites",
  "/storage-locations",
  "/products",
  "/suppliers",
  "/pricing",
  "/stores",
  "/availability",
];

const credentialViewSchema = z.object({
  providers: z.array(z.unknown()),
  current: z.record(z.string(), z.unknown()),
});

const as = async (actorType: "customer" | "employee", actorId: string, roles: string[]) => ({
  "content-type": "application/json",
  ...(await bearerHeaders({ actorType, actorId, roles })),
});

const buildVault = (fallback: AiProviderSettings | undefined): AiCredentialVault =>
  new AiCredentialVault({
    store: createMemoryCredentialStore(),
    sealer: new SecretBox(randomBytes(32).toString("base64")),
    purpose: "embedding",
    fallback,
    cacheMs: 60_000,
  });

const startServer = async (vault: AiCredentialVault, onSettingsChanged?: () => void): Promise<Server> => {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(
    createTrustedRequestMiddleware({
      verifier: testVerifier,
      isPublic: (request: Request) =>
        ["GET", "HEAD"].includes(request.method) &&
        PUBLIC_CATALOG_PATHS.some((prefix) => matchesPathPrefix(request.path, prefix)),
    }),
  );
  app.use(createCredentialRouter({ vault, verifier: testVerifier, onSettingsChanged }));
  app.use((_request, response) => response.status(404).json({ title: "Not Found", status: 404 }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
};

const addressOf = (server: Server): string => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

describe("catalog credential routes", () => {
  let server: Server | undefined;
  let vault: AiCredentialVault;

  afterEach(async () => {
    if (!server) return;
    server.close();
    await once(server, "close");
    server = undefined;
  });

  const start = async (onSettingsChanged?: () => void): Promise<string> => {
    vault = buildVault(undefined);
    server = await startServer(vault, onSettingsChanged);
    return addressOf(server);
  };

  it("refuses everyone but a Platform Admin", async () => {
    const base = await start();
    const attempts = await Promise.all([
      as("customer", CUSTOMER, []),
      as("employee", MANAGER, ["Pharmacy Manager"]),
      as("employee", MANAGER, []),
    ]);

    for (const headers of attempts) {
      const read = await fetch(`${base}${PATH}`, { headers });
      const write = await fetch(`${base}${PATH}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...SETTINGS, apiKey: "AIzaSyExampleKey1234" }),
      });
      const remove = await fetch(`${base}${PATH}`, { method: "DELETE", headers });
      expect([read.status, write.status, remove.status]).toEqual([403, 403, 403]);
    }
    expect(await vault.status()).toEqual({ configured: false });
  });

  it("refuses a request that carries no verified context even though product reads are public", async () => {
    const base = await start();

    const response = await fetch(`${base}${PATH}`);

    expect(response.status).toBe(403);
  });

  it("lists the providers and reports no settings before an admin saves any", async () => {
    const base = await start();
    const headers = await as("employee", ADMIN, ["Platform Admin"]);

    const response = await fetch(`${base}${PATH}`, { headers });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: PROVIDERS, current: { configured: false } });
  });

  it("lets a Platform Admin set, read and clear the settings without ever returning the key", async () => {
    const base = await start();
    const headers = await as("employee", ADMIN, ["Platform Admin"]);

    const set = await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, apiKey: "  AIzaSyExampleKey1234  " }),
    });
    const setBody = await set.text();
    expect(set.status).toBe(200);
    const view = credentialViewSchema.parse(JSON.parse(setBody));
    const { updatedAt, ...current } = view.current;
    expect(typeof updatedAt).toBe("string");
    expect({ providers: view.providers, current }).toEqual({
      providers: PROVIDERS,
      current: {
        configured: true,
        source: "stored",
        ...SETTINGS,
        last4: "1234",
        updatedBy: ADMIN,
        environmentFallback: false,
      },
    });
    expect(setBody).not.toContain("AIzaSyExampleKey");
    expect(await vault.current()).toEqual({ ...SETTINGS, apiKey: "AIzaSyExampleKey1234" });

    const read = await (await fetch(`${base}${PATH}`, { headers })).text();
    expect(credentialViewSchema.parse(JSON.parse(read)).current).toMatchObject({
      configured: true,
      source: "stored",
      last4: "1234",
    });
    expect(read).not.toContain("AIzaSyExampleKey");

    const cleared = await fetch(`${base}${PATH}`, { method: "DELETE", headers });
    expect(cleared.status).toBe(204);
    expect(await vault.current()).toBeUndefined();
  });

  it("keeps the saved key when a PUT omits it for the same provider", async () => {
    const base = await start();
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, apiKey: "AIzaSyExampleKey1234" }),
    });

    const response = await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, model: "example-model-2" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ current: { model: "example-model-2", last4: "1234" } });
    expect(await vault.current()).toEqual({ ...SETTINGS, model: "example-model-2", apiKey: "AIzaSyExampleKey1234" });
  });

  it("answers 400 api_key_required when a PUT omits the key and nothing is saved, and does not reindex", async () => {
    const reindex = vi.fn();
    const base = await start(reindex);
    const headers = await as("employee", ADMIN, ["Platform Admin"]);

    const response = await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(SETTINGS),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      type: "https://api.pharmacycentral.local/problems/api-key-required",
      status: 400,
      code: "api_key_required",
    });
    expect(await vault.status()).toEqual({ configured: false });
    expect(reindex).not.toHaveBeenCalled();
  });

  it("rejects a body that is incomplete, has a short key, or uses a non-https base URL", async () => {
    const base = await start();
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    const invalid = [
      {},
      { ...SETTINGS, apiKey: "short" },
      { ...SETTINGS, apiKey: "   " },
      { ...SETTINGS, apiKey: 12345678 },
      { apiKey: "AIzaSyExampleKey1234" },
      { ...SETTINGS, provider: "openai", apiKey: "AIzaSyExampleKey1234" },
      { ...SETTINGS, model: "", apiKey: "AIzaSyExampleKey1234" },
      { ...SETTINGS, baseUrl: "http://provider.example.test", apiKey: "AIzaSyExampleKey1234" },
      { ...SETTINGS, baseUrl: "not a url", apiKey: "AIzaSyExampleKey1234" },
    ];

    for (const body of invalid) {
      const response = await fetch(`${base}${PATH}`, { method: "PUT", headers, body: JSON.stringify(body) });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({
        type: "https://api.pharmacycentral.local/problems/invalid-request",
        status: 400,
        code: "invalid_request",
      });
    }
  });

  it("starts exactly one sweep per successful save and never blocks the response on it", async () => {
    const reindex = vi.fn();
    const base = await start(reindex);
    const headers = await as("employee", ADMIN, ["Platform Admin"]);

    const response = await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, apiKey: "AIzaSySecondKey999" }),
    });

    expect(response.status).toBe(200);
    expect(reindex).toHaveBeenCalledTimes(1);
  });

  it("sweeps when a PUT keeps the saved key and only changes the model", async () => {
    const reindex = vi.fn();
    const base = await start(reindex);
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, apiKey: "AIzaSySecondKey999" }),
    });

    const response = await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, model: "example-model-2" }),
    });

    expect(response.status).toBe(200);
    expect(reindex).toHaveBeenCalledTimes(2);
  });

  it("does not fail the PUT when the sweep trigger errors", async () => {
    const reindex = vi.fn(() => {
      throw new Error("reindex blew up");
    });
    const base = await start(reindex);
    const headers = await as("employee", ADMIN, ["Platform Admin"]);

    const response = await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, apiKey: "AIzaSyThirdKey777x" }),
    });

    expect(response.status).toBe(200);
    expect(reindex).toHaveBeenCalledTimes(1);
    expect(await vault.current()).toEqual({ ...SETTINGS, apiKey: "AIzaSyThirdKey777x" });
  });

  it("sweeps exactly once more on a successful DELETE, since the saved model may have been the one in use", async () => {
    const reindex = vi.fn();
    const base = await start(reindex);
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, apiKey: "AIzaSySecondKey999" }),
    });
    expect(reindex).toHaveBeenCalledTimes(1);

    const response = await fetch(`${base}${PATH}`, { method: "DELETE", headers });

    expect(response.status).toBe(204);
    expect(reindex).toHaveBeenCalledTimes(2);
  });

  it("does not sweep for rejected writes or for requests refused as non-admin", async () => {
    const reindex = vi.fn();
    const base = await start(reindex);
    const admin = await as("employee", ADMIN, ["Platform Admin"]);

    const invalid = await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers: admin,
      body: JSON.stringify({ ...SETTINGS, apiKey: "short" }),
    });
    const missingKey = await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers: admin,
      body: JSON.stringify(SETTINGS),
    });
    const customerPut = await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers: await as("customer", CUSTOMER, []),
      body: JSON.stringify({ ...SETTINGS, apiKey: "AIzaSySecondKey999" }),
    });
    const customerDelete = await fetch(`${base}${PATH}`, {
      method: "DELETE",
      headers: await as("customer", CUSTOMER, []),
    });

    expect([invalid.status, missingKey.status, customerPut.status, customerDelete.status]).toEqual([
      400, 400, 403, 403,
    ]);
    expect(await invalid.json()).toMatchObject({ code: "invalid_request" });
    expect(await missingKey.json()).toMatchObject({ code: "api_key_required" });
    expect(reindex).not.toHaveBeenCalled();
  });
});

describe("catalog credential routes with environment settings", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    server.close();
    await once(server, "close");
    server = undefined;
  });

  it("reports the environment settings again once the saved ones are deleted", async () => {
    const vault = buildVault(ENVIRONMENT);
    server = await startServer(vault);
    const base = addressOf(server);
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    await fetch(`${base}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, model: "saved-model", apiKey: "AIzaSyExampleKey1234" }),
    });

    const cleared = await fetch(`${base}${PATH}`, { method: "DELETE", headers });
    expect(cleared.status).toBe(204);

    const read = await fetch(`${base}${PATH}`, { headers });
    expect(await read.json()).toEqual({
      providers: PROVIDERS,
      current: { configured: true, source: "environment", ...SETTINGS, last4: "ABCD" },
    });
    expect(await vault.current()).toEqual(ENVIRONMENT);
  });
});
