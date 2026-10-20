import { describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS, type TextEmbedder } from "./text-embedder.ts";

import { embedSearchQuery } from "./hybrid-search.ts";

const vector = (): number[] => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1 / EMBEDDING_DIMENSIONS);

const embedder = (overrides: Partial<TextEmbedder>): TextEmbedder => ({
  model: "test-embedding-model",
  embedDocuments: async () => [],
  embedQuery: async () => vector(),
  ...overrides,
});

describe("embedSearchQuery", () => {
  it("answers keyword-only without a warning while no provider settings are configured", async () => {
    const warn = vi.fn<(error: unknown) => void>();

    const embedding = await embedSearchQuery(async () => undefined, "viên hạ sốt", warn);

    expect(embedding).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns the query embedding from the embedder the source resolved", async () => {
    const embedQuery = vi.fn<() => Promise<number[]>>(async () => vector());
    const resolved = embedder({ embedQuery });
    const source = vi.fn(async () => resolved);

    expect(await embedSearchQuery(source, "viên hạ sốt")).toEqual(vector());
    expect(source).toHaveBeenCalledTimes(1);
    expect(embedQuery).toHaveBeenCalledWith("viên hạ sốt");
  });

  it("resolves no settings for a blank search", async () => {
    const source = vi.fn(async () => embedder({}));

    expect(await embedSearchQuery(source, "   ")).toBeUndefined();
    expect(source).not.toHaveBeenCalled();
  });

  it("answers keyword-only when no source is wired at all", async () => {
    expect(await embedSearchQuery(undefined, "viên hạ sốt")).toBeUndefined();
  });

  it("surfaces a settings read failure instead of silently skipping the semantic branch", async () => {
    const warn = vi.fn<(error: unknown) => void>();
    const source = async (): Promise<TextEmbedder | undefined> => {
      throw new Error("The stored secret cannot be decrypted with the current master key.");
    };

    await expect(embedSearchQuery(source, "viên hạ sốt", warn)).rejects.toThrow("cannot be decrypted");
    expect(warn).not.toHaveBeenCalled();
  });
});
