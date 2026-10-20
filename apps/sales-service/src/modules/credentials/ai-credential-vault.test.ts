import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AiProviderSettings } from "../../infrastructure/ai-provider-config.ts";
import { SecretBox } from "../../infrastructure/secret-box.ts";
import type { ReplaceCredentialRequest } from "../../contracts/credentials.ts";
import { AiCredentialVault, ApiKeyRequiredError } from "./ai-credential-vault.ts";
import type { CredentialStore } from "./credential-store.ts";
import { createMemoryCredentialStore } from "./memory-credential-store.ts";

const ADMIN = "44444444-4444-4444-8444-444444444444";
const PURPOSE = "feature";

const SAVED = { provider: "gemini", model: "saved-model", baseUrl: "https://saved.example.test" } as const;
const ENVIRONMENT: AiProviderSettings = {
  provider: "gemini",
  model: "env-model",
  baseUrl: "https://env.example.test",
  apiKey: "environment-key-value-ABCD",
};

const build = (overrides: { masterKey?: string; now?: () => number; fallback?: AiProviderSettings } = {}) => {
  const store = createMemoryCredentialStore();
  const sealer = new SecretBox(overrides.masterKey ?? randomBytes(32).toString("base64"));
  const vault = new AiCredentialVault({
    store,
    sealer,
    purpose: PURPOSE,
    fallback: overrides.fallback,
    cacheMs: 60_000,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  return { store, sealer, vault };
};

const saveRequest = (apiKey: string | undefined, model: string = SAVED.model): ReplaceCredentialRequest => ({
  provider: SAVED.provider,
  model,
  baseUrl: SAVED.baseUrl,
  ...(apiKey === undefined ? {} : { apiKey }),
});

describe("AiCredentialVault", () => {
  it("has no settings until an admin sets them", async () => {
    const { vault } = build();

    expect(await vault.current()).toBeUndefined();
    expect(await vault.status()).toEqual({ configured: false });
  });

  it("returns the settings it was given and exposes only the last four characters of the key", async () => {
    const { vault, store } = build();

    const status = await vault.replace(saveRequest("AIzaSyExampleKey1234"), ADMIN);

    expect(await vault.current()).toEqual({ ...SAVED, apiKey: "AIzaSyExampleKey1234" });
    expect(status).toMatchObject({
      configured: true,
      source: "stored",
      provider: "gemini",
      model: SAVED.model,
      baseUrl: SAVED.baseUrl,
      last4: "1234",
      updatedBy: ADMIN,
    });
    expect(JSON.stringify(status)).not.toContain("AIzaSyExampleKey");
    expect(JSON.stringify([...store.rows.values()])).not.toContain("AIzaSyExampleKey1234");
  });

  it("serves replacement settings at once even while the previous ones are cached", async () => {
    const { vault } = build();
    await vault.replace(saveRequest("first-key-value-0001"), ADMIN);
    expect(await vault.current()).toMatchObject({ apiKey: "first-key-value-0001" });

    await vault.replace(saveRequest("second-key-value-0002", "second-model"), ADMIN);

    expect(await vault.current()).toEqual({ ...SAVED, model: "second-model", apiKey: "second-key-value-0002" });
  });

  it("does not let a read that started before a write refill the cache with the older settings", async () => {
    const memory = createMemoryCredentialStore();
    let holdNextRead = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store: CredentialStore = {
      ...memory,
      find: async (purpose) => {
        if (!holdNextRead) return memory.find(purpose);
        holdNextRead = false;
        const snapshot = await memory.find(purpose);
        await gate;
        return snapshot;
      },
    };
    const vault = new AiCredentialVault({
      store,
      sealer: new SecretBox(randomBytes(32).toString("base64")),
      purpose: PURPOSE,
      fallback: undefined,
      cacheMs: 60_000,
    });
    await vault.replace(saveRequest("first-key-value-0001"), ADMIN);
    holdNextRead = true;
    const inFlight = vault.current();

    await vault.replace(saveRequest("second-key-value-0002", "second-model"), ADMIN);
    release();

    expect(await inFlight).toMatchObject({ apiKey: "first-key-value-0001" });
    expect(await vault.current()).toMatchObject({ model: "second-model", apiKey: "second-key-value-0002" });
  });

  it("does not let a read that started before a clear refill the cache with the cleared settings", async () => {
    const memory = createMemoryCredentialStore();
    let holdNextRead = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store: CredentialStore = {
      ...memory,
      find: async (purpose) => {
        if (!holdNextRead) return memory.find(purpose);
        holdNextRead = false;
        const snapshot = await memory.find(purpose);
        await gate;
        return snapshot;
      },
    };
    const vault = new AiCredentialVault({
      store,
      sealer: new SecretBox(randomBytes(32).toString("base64")),
      purpose: PURPOSE,
      fallback: undefined,
      cacheMs: 60_000,
    });
    await vault.replace(saveRequest("first-key-value-0001"), ADMIN);
    holdNextRead = true;
    const inFlight = vault.current();

    await vault.clear();
    release();

    expect(await inFlight).toMatchObject({ apiKey: "first-key-value-0001" });
    expect(await vault.current()).toBeUndefined();
  });

  it("stops serving settings once they are cleared", async () => {
    const { vault } = build();
    await vault.replace(saveRequest("first-key-value-0001"), ADMIN);
    expect(await vault.current()).toMatchObject({ apiKey: "first-key-value-0001" });

    await vault.clear();

    expect(await vault.current()).toBeUndefined();
    expect(await vault.status()).toEqual({ configured: false });
  });

  it("picks up settings written by another instance once the cache expires", async () => {
    let clock = 0;
    const { vault, store, sealer } = build({ now: () => clock });
    expect(await vault.current()).toBeUndefined();

    store.rows.set(PURPOSE, {
      ...SAVED,
      ciphertext: sealer.seal("key-from-another-node", PURPOSE),
      last4: "node",
      updatedBy: ADMIN,
      updatedAt: new Date(0),
    });
    expect(await vault.current()).toBeUndefined();

    clock = 60_001;
    expect(await vault.current()).toMatchObject({ apiKey: "key-from-another-node" });
  });

  it("fails loudly when the stored key cannot be opened with the current master key", async () => {
    const { store } = build();
    const writer = new AiCredentialVault({
      store,
      sealer: new SecretBox(randomBytes(32).toString("base64")),
      purpose: PURPOSE,
      fallback: undefined,
      cacheMs: 60_000,
    });
    await writer.replace(saveRequest("first-key-value-0001"), ADMIN);
    const reader = new AiCredentialVault({
      store,
      sealer: new SecretBox(randomBytes(32).toString("base64")),
      purpose: PURPOSE,
      fallback: undefined,
      cacheMs: 60_000,
    });

    await expect(reader.current()).rejects.toThrow("cannot be decrypted");
  });

  it("keeps the saved key and its last four characters when the key is omitted", async () => {
    const { vault } = build();
    await vault.replace(saveRequest("first-key-value-0001"), ADMIN);

    const status = await vault.replace(saveRequest(undefined, "renamed-model"), ADMIN);

    expect(status).toMatchObject({ source: "stored", model: "renamed-model", last4: "0001" });
    expect(await vault.current()).toEqual({ ...SAVED, model: "renamed-model", apiKey: "first-key-value-0001" });
  });

  it("refuses an omitted key when nothing is saved yet", async () => {
    const { vault, store } = build();

    await expect(vault.replace(saveRequest(undefined), ADMIN)).rejects.toBeInstanceOf(ApiKeyRequiredError);
    expect(store.rows.size).toBe(0);
  });

  it("refuses an omitted key when only the environment settings exist", async () => {
    const { vault } = build({ fallback: ENVIRONMENT });

    await expect(vault.replace(saveRequest(undefined), ADMIN)).rejects.toBeInstanceOf(ApiKeyRequiredError);
  });
});

describe("AiCredentialVault with the deployment's own settings", () => {
  it("serves the environment settings while none are saved", async () => {
    const { vault } = build({ fallback: ENVIRONMENT });

    expect(await vault.current()).toEqual(ENVIRONMENT);
    expect(await vault.status()).toEqual({
      configured: true,
      source: "environment",
      provider: "gemini",
      model: "env-model",
      baseUrl: "https://env.example.test",
      last4: "ABCD",
    });
  });

  it("serves the saved settings as a whole, ignoring the environment settings", async () => {
    const { vault } = build({ fallback: ENVIRONMENT });

    const status = await vault.replace(saveRequest("saved-key-value-0001"), ADMIN);

    expect(await vault.current()).toEqual({ ...SAVED, apiKey: "saved-key-value-0001" });
    expect(status).toMatchObject({
      configured: true,
      source: "stored",
      model: SAVED.model,
      last4: "0001",
      environmentFallback: true,
    });
  });

  it("switches to saved settings at once, even while the environment settings are cached", async () => {
    const { vault } = build({ fallback: ENVIRONMENT });
    expect(await vault.current()).toEqual(ENVIRONMENT);

    await vault.replace(saveRequest("saved-key-value-0001"), ADMIN);

    expect(await vault.current()).toMatchObject({ model: SAVED.model, apiKey: "saved-key-value-0001" });
  });

  it("returns to the environment settings when the saved ones are removed", async () => {
    const { vault } = build({ fallback: ENVIRONMENT });
    await vault.replace(saveRequest("saved-key-value-0001"), ADMIN);
    expect(await vault.current()).toMatchObject({ apiKey: "saved-key-value-0001" });

    await vault.clear();

    expect(await vault.current()).toEqual(ENVIRONMENT);
    expect(await vault.status()).toMatchObject({ configured: true, source: "environment", model: "env-model" });
  });

  it("says there is nothing to fall back to when only saved settings exist", async () => {
    const { vault } = build();

    const status = await vault.replace(saveRequest("saved-key-value-0001"), ADMIN);

    expect(status).toMatchObject({ source: "stored", environmentFallback: false });
  });
});
