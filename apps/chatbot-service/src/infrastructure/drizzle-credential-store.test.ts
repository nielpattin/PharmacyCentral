import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ChatDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { DrizzleCredentialStore } from "./drizzle-credential-store.ts";

const ADMIN = "77777777-7777-4777-8777-777777777777";

const credential = (ciphertext: string, last4: string) => ({
  provider: "gemini" as const,
  model: "example-model-1",
  baseUrl: "https://provider.example.test",
  ciphertext,
  last4,
  updatedBy: ADMIN,
  updatedAt: new Date("2026-10-19T08:00:00.000Z"),
});

describe("DrizzleCredentialStore", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const store = new DrizzleCredentialStore({ db, pool: undefined } as unknown as ChatDatabase);

  beforeAll(async () => {
    const migration = new URL("../../drizzle/migrations/0001_ai_credentials.sql", import.meta.url);
    await client.exec(await readFile(migration, "utf8"));
  });

  beforeEach(async () => {
    await client.exec("DELETE FROM ai_credentials");
  });

  afterAll(async () => {
    await client.close();
  });

  it("finds nothing before a key is saved", async () => {
    expect(await store.find("chatbot")).toBeUndefined();
  });

  it("returns what it saved", async () => {
    await store.save("chatbot", credential("v1.sealed-one", "1234"));

    expect(await store.find("chatbot")).toEqual(credential("v1.sealed-one", "1234"));
  });

  it("returns the provider, model and base URL together with the sealed key", async () => {
    await store.save("chatbot", { ...credential("v1.sealed-one", "1234"), model: "example-model-2" });

    expect(await store.find("chatbot")).toMatchObject({
      provider: "gemini",
      model: "example-model-2",
      baseUrl: "https://provider.example.test",
    });
  });

  it("names the purpose when a row holds a provider this build does not know", async () => {
    await client.query(
      "INSERT INTO ai_credentials (purpose, provider, model, base_url, ciphertext, last4, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      ["chatbot", "openai", "gpt-5", "https://api.openai.com", "v1.sealed", "1234", ADMIN, "2026-10-19T08:00:00.000Z"],
    );

    await expect(store.find("chatbot")).rejects.toThrow(/"chatbot".*"openai"/);
  });

  it("replaces the stored key instead of adding a second row", async () => {
    await store.save("chatbot", credential("v1.sealed-one", "1234"));
    await store.save("chatbot", credential("v1.sealed-two", "5678"));

    expect(await store.find("chatbot")).toMatchObject({ ciphertext: "v1.sealed-two", last4: "5678" });
    const rows = await client.query("SELECT count(*)::int AS total FROM ai_credentials");
    expect(rows.rows).toEqual([{ total: 1 }]);
  });

  it("keeps purposes apart and removes only the one asked for", async () => {
    await store.save("chatbot", credential("v1.sealed-chat", "1234"));
    await store.save("embedding", credential("v1.sealed-embed", "5678"));

    await store.remove("chatbot");

    expect(await store.find("chatbot")).toBeUndefined();
    expect(await store.find("embedding")).toMatchObject({ ciphertext: "v1.sealed-embed" });
  });
});
