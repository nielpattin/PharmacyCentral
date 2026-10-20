import { randomBytes } from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ReplaceCredentialRequest } from "../../contracts/credentials.ts";
import { SecretBox } from "../../infrastructure/secret-box.ts";
import { createLogger } from "../../logger.ts";
import { createTrustedRequestMiddleware, signInternalIdentityContext } from "../../middleware/trusted-request.ts";
import type { AiProviderSettings } from "../../infrastructure/ai-provider-config.ts";
import { ConfiguredPrescriptionReader } from "../prescriptions/infrastructure/configured-prescription-reader.ts";
import { GeminiPrescriptionReader } from "../prescriptions/infrastructure/gemini-prescription-reader.ts";
import { PrescriptionReaderError } from "../prescriptions/domain/prescription-reader.ts";
import { createErrorHandler } from "../../shared/presentation/error-handler.ts";
import { createAdapterSource } from "./ai-adapters.ts";
import { AiCredentialVault } from "./ai-credential-vault.ts";
import { createCredentialRouter } from "./credential-routes.ts";
import { createMemoryCredentialStore } from "./memory-credential-store.ts";

const httpFetch = globalThis.fetch.bind(globalThis);
const SECRET = "test-internal-identity-secret";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const MANAGER = "66666666-6666-4666-8666-666666666666";
const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const PATH = "/prescriptions/intake-credential";
const ENVIRONMENT: AiProviderSettings = {
  provider: "gemini",
  model: "environment-model",
  baseUrl: "https://environment.example.test",
  apiKey: "AIzaEnvironmentKey9999",
};
const SAVED_BODY = {
  provider: "gemini",
  model: "gemini-test-model",
  baseUrl: "https://generativelanguage.example.test",
  apiKey: "AIzaSyExampleKey1234",
} satisfies ReplaceCredentialRequest;

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
      audience: "sales-service",
    },
    SECRET,
  );
};

const as = (actorType: "customer" | "employee", actorId: string, roles: string[]) => ({
  "content-type": "application/json",
  "x-internal-identity-context": signedHeader(actorType, actorId, roles),
});

const buildVault = (overrides: { purpose?: string; fallback?: AiProviderSettings } = {}): AiCredentialVault =>
  new AiCredentialVault({
    store: createMemoryCredentialStore(),
    sealer: new SecretBox(randomBytes(32).toString("base64")),
    purpose: overrides.purpose ?? "prescription-reader",
    fallback: overrides.fallback,
    cacheMs: 60_000,
  });

const startApp = async (vault: AiCredentialVault, extra?: (app: express.Express) => void) => {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(createTrustedRequestMiddleware({ identitySecret: SECRET, expectedAudience: "sales-service" }));
  app.use(createCredentialRouter({ vault, identitySecret: SECRET, audience: "sales-service" }));
  extra?.(app);
  app.use(createErrorHandler(createLogger({ level: "silent" })));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

describe("sales credential routes", () => {
  const vault = buildVault();
  let baseUrl = "";
  let server: Server;

  beforeAll(async () => {
    const started = await startApp(vault);
    server = started.server;
    baseUrl = started.url;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("refuses everyone but a Platform Admin", async () => {
    const attempts = [
      as("customer", CUSTOMER, []),
      as("employee", MANAGER, ["Pharmacy Manager"]),
      as("employee", MANAGER, []),
    ];

    for (const headers of attempts) {
      const read = await httpFetch(`${baseUrl}${PATH}`, { headers });
      const write = await httpFetch(`${baseUrl}${PATH}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ apiKey: "AIzaSyExampleKey1234" }),
      });
      const remove = await httpFetch(`${baseUrl}${PATH}`, { method: "DELETE", headers });
      expect([read.status, write.status, remove.status]).toEqual([403, 403, 403]);
    }
    expect(await vault.status()).toEqual({ configured: false });
  });

  it("refuses a request that carries no verified context", async () => {
    const response = await httpFetch(`${baseUrl}${PATH}`);

    expect(response.status).toBe(401);
  });

  it("lets a Platform Admin set, read and clear the key without ever returning it", async () => {
    const headers = as("employee", ADMIN, ["Platform Admin"]);

    const empty = await httpFetch(`${baseUrl}${PATH}`, { headers });
    expect(await empty.json()).toMatchObject({ current: { configured: false } });

    const set = await httpFetch(`${baseUrl}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SAVED_BODY, apiKey: "  AIzaSyExampleKey1234  " }),
    });
    const setBody = await set.text();
    expect(set.status).toBe(200);
    expect(JSON.parse(setBody)).toMatchObject({
      current: {
        configured: true,
        source: "stored",
        provider: "gemini",
        model: "gemini-test-model",
        baseUrl: "https://generativelanguage.example.test",
        last4: "1234",
        updatedBy: ADMIN,
        environmentFallback: false,
      },
    });
    expect(setBody).not.toContain("AIzaSyExampleKey");
    expect(await vault.current()).toEqual({ ...SAVED_BODY, apiKey: "AIzaSyExampleKey1234" });

    const read = await (await httpFetch(`${baseUrl}${PATH}`, { headers })).text();
    expect(JSON.parse(read)).toMatchObject({ current: { configured: true, last4: "1234" } });
    expect(read).not.toContain("AIzaSyExampleKey");

    const cleared = await httpFetch(`${baseUrl}${PATH}`, { method: "DELETE", headers });
    expect(cleared.status).toBe(204);
    expect(await vault.current()).toBeUndefined();
  });

  it("rejects a key that is missing or too short", async () => {
    const headers = as("employee", ADMIN, ["Platform Admin"]);

    for (const body of [
      {},
      { ...SAVED_BODY, apiKey: "short" },
      { ...SAVED_BODY, apiKey: "   " },
      { ...SAVED_BODY, apiKey: 12345678 },
    ]) {
      const response = await httpFetch(`${baseUrl}${PATH}`, { method: "PUT", headers, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
    }
  });

  it("lists the supported providers with their catalog entries in the view", async () => {
    const response = await httpFetch(`${baseUrl}${PATH}`, { headers: as("employee", ADMIN, ["Platform Admin"]) });

    expect(await response.json()).toMatchObject({
      providers: [
        { id: "gemini", label: "Google Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com" },
      ],
    });
  });

  it("rejects a provider it does not know, a model that is blank and a base URL that is not https", async () => {
    const headers = as("employee", ADMIN, ["Platform Admin"]);

    for (const body of [
      { ...SAVED_BODY, provider: "openai" },
      { ...SAVED_BODY, model: "   " },
      { ...SAVED_BODY, baseUrl: "http://generativelanguage.example.test" },
    ]) {
      const response = await httpFetch(`${baseUrl}${PATH}`, { method: "PUT", headers, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        type: "https://api.pharmacycentral.local/problems/invalid-request",
        code: "invalid_request",
      });
    }
    expect(await vault.status()).toEqual({ configured: false });
  });

  it("asks for an API key when none is saved for the provider, and keeps the saved key when the provider is unchanged", async () => {
    const headers = as("employee", ADMIN, ["Platform Admin"]);
    const withoutKey = await httpFetch(`${baseUrl}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SAVED_BODY, apiKey: undefined }),
    });
    expect(withoutKey.status).toBe(400);
    expect(await withoutKey.json()).toMatchObject({
      type: "https://api.pharmacycentral.local/problems/api-key-required",
      code: "api_key_required",
    });

    await httpFetch(`${baseUrl}${PATH}`, { method: "PUT", headers, body: JSON.stringify(SAVED_BODY) });
    const renamed = await httpFetch(`${baseUrl}${PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...SAVED_BODY, model: "gemini-other-model", apiKey: undefined }),
    });

    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ current: { model: "gemini-other-model", last4: "1234" } });
    expect(await vault.current()).toEqual({ ...SAVED_BODY, model: "gemini-other-model" });
  });

  it("answers with the environment settings once the saved row is deleted", async () => {
    const environmentVault = buildVault({ fallback: ENVIRONMENT });
    const started = await startApp(environmentVault);
    const headers = as("employee", ADMIN, ["Platform Admin"]);
    try {
      await httpFetch(`${started.url}${PATH}`, { method: "PUT", headers, body: JSON.stringify(SAVED_BODY) });
      expect(await environmentVault.current()).toMatchObject({ model: "gemini-test-model" });

      const cleared = await httpFetch(`${started.url}${PATH}`, { method: "DELETE", headers });
      expect(cleared.status).toBe(204);

      expect(await environmentVault.current()).toEqual(ENVIRONMENT);
      expect(await (await httpFetch(`${started.url}${PATH}`, { headers })).json()).toMatchObject({
        current: { configured: true, source: "environment", model: "environment-model", last4: "9999" },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        started.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
describe("credential route to prescription reader", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  let server: Server;
  let baseUrl = "";
  let vault: AiCredentialVault;
  let geminiCalls: Array<{ key: string | undefined }> = [];

  beforeAll(async () => {
    vault = buildVault();
    const reader = new ConfiguredPrescriptionReader(
      createAdapterSource(() => vault.current(), {
        gemini: (settings) => new GeminiPrescriptionReader(settings),
      }),
    );
    const started = await startApp(vault, (app) => {
      app.post(
        "/prescriptions/intake/image",
        express.raw({ type: "image/jpeg" }),
        async (request, response, next): Promise<void> => {
          try {
            if (!(await reader.isAvailable())) {
              response.status(503).json({ code: "reader_unavailable" });
              return;
            }
            response.json(await reader.read(request.body as Buffer, "image/jpeg"));
          } catch (error) {
            next(error);
          }
        },
      );
    });
    server = started.server;
    baseUrl = started.url;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    geminiCalls = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const postImage = () =>
    httpFetch(`${baseUrl}/prescriptions/intake/image`, {
      method: "POST",
      headers: {
        "content-type": "image/jpeg",
        "x-internal-identity-context": signedHeader("customer", CUSTOMER, []),
      },
      body: jpeg,
    });

  it("answers 503 until an admin stores a key, then serves the next photo with it", async () => {
    expect(await (await postImage()).json()).toMatchObject({ code: "reader_unavailable" });

    const forbidden = await httpFetch(`${baseUrl}${PATH}`, {
      method: "PUT",
      headers: as("employee", MANAGER, ["Pharmacy Manager"]),
      body: JSON.stringify({ apiKey: "AIzaSyExampleKey1234" }),
    });
    expect(forbidden.status).toBe(403);

    const stored = await httpFetch(`${baseUrl}${PATH}`, {
      method: "PUT",
      headers: as("employee", ADMIN, ["Platform Admin"]),
      body: JSON.stringify(SAVED_BODY),
    });
    expect(stored.status).toBe(200);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (input.toString().startsWith(SAVED_BODY.baseUrl)) {
          const headers = init?.headers as Record<string, string> | undefined;
          geminiCalls.push({ key: headers === undefined ? undefined : headers["x-goog-api-key"] });
          return Response.json({
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        isPrescription: true,
                        code: null,
                        patientName: null,
                        facilityName: null,
                        doctorName: null,
                        diagnosis: null,
                        issuedOn: null,
                        lines: [],
                      }),
                    },
                  ],
                },
              },
            ],
          });
        }
        return httpFetch(input, init);
      }),
    );

    const photo = await postImage();
    expect(photo.status).toBe(200);
    expect(geminiCalls).toEqual([{ key: "AIzaSyExampleKey1234" }]);
  });

  it("answers 503 and never calls Gemini when the stored key cannot be opened", async () => {
    const store = createMemoryCredentialStore();
    const writer = new AiCredentialVault({
      store,
      sealer: new SecretBox(randomBytes(32).toString("base64")),
      purpose: "prescription-reader",
      fallback: undefined,
      cacheMs: 60_000,
    });
    await writer.replace({ ...SAVED_BODY, apiKey: "some-other-node-key" }, ADMIN);
    const foreign = new AiCredentialVault({
      store,
      sealer: new SecretBox(randomBytes(32).toString("base64")),
      purpose: "prescription-reader",
      fallback: undefined,
      cacheMs: 60_000,
    });
    const reader = new ConfiguredPrescriptionReader(async () => {
      throw new Error("store is down");
    });
    const readerBehindVault = new ConfiguredPrescriptionReader(
      createAdapterSource(() => foreign.current(), {
        gemini: (settings) => new GeminiPrescriptionReader(settings),
      }),
    );

    const failed = await reader.read(jpeg, "image/jpeg").catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(PrescriptionReaderError);
    expect(await reader.isAvailable()).toBe(false);
    expect(await readerBehindVault.isAvailable()).toBe(false);
  });
});
