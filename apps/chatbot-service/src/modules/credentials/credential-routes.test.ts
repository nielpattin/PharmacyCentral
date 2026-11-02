import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Express } from "express";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { aiProviderCatalog, chatModelProviders, intentGateProviders } from "../../contracts/credentials.ts";
import { createApp } from "../../app.ts";
import type { AiProviderSettings } from "../../infrastructure/ai-provider-config.ts";
import { SecretBox } from "../../infrastructure/secret-box.ts";
import { bearerHeaders, testVerifier } from "../../test-support/access-tokens.ts";
import { AiCredentialVault } from "./ai-credential-vault.ts";
import { createMemoryCredentialStore } from "./memory-credential-store.ts";

const ADMIN = "55555555-5555-4555-8555-555555555555";
const MANAGER = "66666666-6666-4666-8666-666666666666";
const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const PATH = "/chatbot/credential";
const GATE_PATH = "/chatbot/intent-gate-credential";
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
const GATE_SETTINGS: Omit<AiProviderSettings, "apiKey"> = {
  provider: "typesafe",
  model: "jev-latest",
  baseUrl: "https://api.typesafe.ai",
};
const GATE_PROVIDERS = [{ id: "typesafe", ...aiProviderCatalog.typesafe }];

const credentialViewSchema = z.object({
  providers: z.array(z.unknown()),
  current: z.record(z.string(), z.unknown()),
});

const as = async (actorType: "customer" | "employee", actorId: string, roles: string[]) => ({
  "content-type": "application/json",
  ...(await bearerHeaders({ actorType, actorId, roles })),
});

const startServer = async (app: Express): Promise<{ server: Server; baseUrl: string }> => {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
};

const buildApp = (fallback: AiProviderSettings | undefined) => {
  const vault = new AiCredentialVault({
    store: createMemoryCredentialStore(),
    sealer: new SecretBox(randomBytes(32).toString("base64")),
    purpose: "chatbot",
    fallback,
    cacheMs: 60_000,
  });
  const gateVault = new AiCredentialVault({
    store: createMemoryCredentialStore(),
    sealer: new SecretBox(randomBytes(32).toString("base64")),
    purpose: "intent-gate",
    fallback: undefined,
    cacheMs: 60_000,
  });
  const app = createApp({
    verifier: testVerifier,
    deps: {
      model: { complete: async () => ({ text: "ok", usage: undefined, modelCalls: 1 }) },
      products: { search: async () => [], details: async () => undefined },
      store: {} as never,
      reportUsage: () => undefined,
      gate: { check: async () => ({ intent: "greeting", intentConfidence: null, emergency: 0, injection: 0 }) },
      reportGate: () => undefined,
    },
    credentials: [
      { path: PATH, providers: chatModelProviders, vault },
      {
        path: GATE_PATH,
        providers: intentGateProviders,
        vault: gateVault,
      },
    ],
    logger: pino({ level: "silent" }),
  });
  return { vault, gateVault, app };
};

describe("chatbot credential routes", () => {
  const { vault, app } = buildApp(undefined);
  let baseUrl = "";
  let server: Server;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer(app));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("refuses everyone but a Platform Admin", async () => {
    const attempts = await Promise.all([
      as("customer", CUSTOMER, []),
      as("employee", MANAGER, ["Pharmacy Manager"]),
      as("employee", MANAGER, []),
    ]);

    for (const headers of attempts) {
      const read = await fetch(`${baseUrl}${PATH}`, { headers });
      const write = await fetch(`${baseUrl}${PATH}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...SETTINGS, apiKey: "AIzaSyExampleKey1234" }),
      });
      const remove = await fetch(`${baseUrl}${PATH}`, { method: "DELETE", headers });
      expect([read.status, write.status, remove.status]).toEqual([403, 403, 403]);
    }
    expect(await vault.status()).toEqual({ configured: false });
  });

  it("refuses a request that carries no verified context", async () => {
    const response = await fetch(`${baseUrl}${PATH}`);

    expect(response.status).toBe(401);
  });

  it("lists the providers and reports no settings before an admin saves any", async () => {
    const headers = await as("employee", ADMIN, ["Platform Admin"]);

    const response = await fetch(`${baseUrl}${PATH}`, { headers });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: PROVIDERS, current: { configured: false } });
  });

  it("lets a Platform Admin set, read and clear the settings without ever returning the key", async () => {
    const headers = await as("employee", ADMIN, ["Platform Admin"]);

    const set = await fetch(`${baseUrl}${PATH}`, {
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

    const read = await (await fetch(`${baseUrl}${PATH}`, { headers })).text();
    expect(credentialViewSchema.parse(JSON.parse(read)).current).toMatchObject({
      configured: true,
      source: "stored",
      last4: "1234",
    });
    expect(read).not.toContain("AIzaSyExampleKey");

    const cleared = await fetch(`${baseUrl}${PATH}`, { method: "DELETE", headers });
    expect(cleared.status).toBe(204);
    expect(await vault.current()).toBeUndefined();
  });

  it("keeps the saved key when a PUT omits it for the same provider", async () => {
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    await fetch(`${baseUrl}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, apiKey: "AIzaSyExampleKey1234" }),
    });

    const response = await fetch(`${baseUrl}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, model: "example-model-2" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ current: { model: "example-model-2", last4: "1234" } });
    expect(await vault.current()).toEqual({ ...SETTINGS, model: "example-model-2", apiKey: "AIzaSyExampleKey1234" });
  });

  it("answers 400 api_key_required when a PUT omits the key and nothing is saved", async () => {
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    await fetch(`${baseUrl}${PATH}`, { method: "DELETE", headers });

    const response = await fetch(`${baseUrl}${PATH}`, {
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
  });

  it("rejects a body that is incomplete, has a short key, or uses a non-https base URL", async () => {
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
      const response = await fetch(`${baseUrl}${PATH}`, { method: "PUT", headers, body: JSON.stringify(body) });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({
        type: "https://api.pharmacycentral.local/problems/invalid-request",
        status: 400,
        code: "invalid_request",
      });
    }
  });

  it("refuses typesafe, which only the intent gate uses, and saves nothing", async () => {
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    await fetch(`${baseUrl}${PATH}`, { method: "DELETE", headers });

    const response = await fetch(`${baseUrl}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...GATE_SETTINGS, apiKey: "jev-example-key-1234" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
    expect(await vault.status()).toEqual({ configured: false });
  });
});

describe("chatbot credential routes with an openai-compatible provider", () => {
  const { vault, app } = buildApp(undefined);
  let baseUrl = "";
  let server: Server;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer(app));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("accepts an openai-compatible setting with a versioned https base URL and never returns the key", async () => {
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    const settings = {
      provider: "openai-compatible",
      model: "example-model",
      baseUrl: "https://llm.example.com/v1",
    };

    const response = await fetch(`${baseUrl}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...settings, apiKey: "example-key-1234" }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("example-key-1234");
    expect(await vault.current()).toEqual({ ...settings, apiKey: "example-key-1234" });

    await fetch(`${baseUrl}${PATH}`, { method: "DELETE", headers });
  });
});

describe("intent gate credential routes", () => {
  const { vault, gateVault, app } = buildApp(undefined);
  let baseUrl = "";
  let server: Server;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer(app));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("refuses everyone but a Platform Admin", async () => {
    const attempts = await Promise.all([
      as("customer", CUSTOMER, []),
      as("employee", MANAGER, ["Pharmacy Manager"]),
      as("employee", MANAGER, []),
    ]);

    for (const headers of attempts) {
      const read = await fetch(`${baseUrl}${GATE_PATH}`, { headers });
      const write = await fetch(`${baseUrl}${GATE_PATH}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...GATE_SETTINGS, apiKey: "jev-example-key-1234" }),
      });
      const remove = await fetch(`${baseUrl}${GATE_PATH}`, { method: "DELETE", headers });
      expect([read.status, write.status, remove.status]).toEqual([403, 403, 403]);
    }
    expect(await gateVault.status()).toEqual({ configured: false });
  });

  it("lists only the intent gate provider and reports no settings before an admin saves any", async () => {
    const headers = await as("employee", ADMIN, ["Platform Admin"]);

    const response = await fetch(`${baseUrl}${GATE_PATH}`, { headers });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: GATE_PROVIDERS, current: { configured: false } });
  });

  it("saves a typesafe setting and never returns the key", async () => {
    const headers = await as("employee", ADMIN, ["Platform Admin"]);

    const response = await fetch(`${baseUrl}${GATE_PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...GATE_SETTINGS, apiKey: "jev-example-key-1234" }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("jev-example-key-1234");
    expect(await gateVault.current()).toEqual({ ...GATE_SETTINGS, apiKey: "jev-example-key-1234" });
    expect(await vault.status()).toEqual({ configured: false });
  });

  it("refuses gemini, which only the chat model uses, and saves nothing", async () => {
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    await fetch(`${baseUrl}${GATE_PATH}`, { method: "DELETE", headers });

    const response = await fetch(`${baseUrl}${GATE_PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, apiKey: "AIzaSyExampleKey1234" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
    expect(await gateVault.status()).toEqual({ configured: false });
  });

  it("refuses openai-compatible, which only the chat model uses, and saves nothing", async () => {
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    await fetch(`${baseUrl}${GATE_PATH}`, { method: "DELETE", headers });

    const response = await fetch(`${baseUrl}${GATE_PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        provider: "openai-compatible",
        model: "example-model",
        baseUrl: "https://llm.example.com/v1",
        apiKey: "example-key-1234",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
    expect(await gateVault.status()).toEqual({ configured: false });
  });
});

describe("chatbot credential routes with environment settings", () => {
  const { vault, app } = buildApp(ENVIRONMENT);
  let baseUrl = "";
  let server: Server;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer(app));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("reports the environment settings again once the saved ones are deleted", async () => {
    const headers = await as("employee", ADMIN, ["Platform Admin"]);
    await fetch(`${baseUrl}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SETTINGS, model: "saved-model", apiKey: "AIzaSyExampleKey1234" }),
    });

    const cleared = await fetch(`${baseUrl}${PATH}`, { method: "DELETE", headers });
    expect(cleared.status).toBe(204);

    const read = await fetch(`${baseUrl}${PATH}`, { headers });
    expect(await read.json()).toEqual({
      providers: PROVIDERS,
      current: { configured: true, source: "environment", ...SETTINGS, last4: "ABCD" },
    });
    expect(await vault.current()).toEqual(ENVIRONMENT);
  });
});
