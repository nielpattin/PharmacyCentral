import { z } from "zod";

import { EMBEDDING_DIMENSIONS, type TextEmbedder } from "./text-embedder.ts";

type GeminiTextEmbedderOptions = { baseUrl: string; model: string; apiKey: string };

const DOCUMENT_BATCH_SIZE = 50;
const DOCUMENT_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 3_000;

const embeddingValuesSchema = z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS);
const batchEmbeddingResponseSchema = z.object({
  embeddings: z.array(z.object({ values: embeddingValuesSchema })),
});
const singleEmbeddingResponseSchema = z.object({
  embedding: z.object({ values: embeddingValuesSchema }),
});

/** gemini-embedding-001 returns unit vectors only at 3072 dimensions, so smaller outputs are normalized here. */
const normalize = (values: number[]): number[] => {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  // Huge finite components overflow to Infinity when squared, so the norm check catches them.
  if (!Number.isFinite(norm) || norm === 0) throw new Error("Embedding has a zero or non-finite norm");
  return values.map((value) => value / norm);
};

export class GeminiTextEmbedder implements TextEmbedder {
  public readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  public constructor(options: GeminiTextEmbedderOptions) {
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
  }

  public async embedDocuments(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += DOCUMENT_BATCH_SIZE) {
      const batch = texts.slice(start, start + DOCUMENT_BATCH_SIZE);
      const body = await this.post(
        `/v1beta/models/${encodeURIComponent(this.model)}:batchEmbedContents`,
        {
          requests: batch.map((text) => ({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
            taskType: "RETRIEVAL_DOCUMENT",
            outputDimensionality: EMBEDDING_DIMENSIONS,
          })),
        },
        DOCUMENT_TIMEOUT_MS,
        batchEmbeddingResponseSchema,
        "batch embedding",
      );
      const embeddings = body.embeddings;
      if (embeddings.length !== batch.length) {
        throw new Error(`Gemini returned ${embeddings.length} embeddings for ${batch.length} documents`);
      }
      for (const embedding of embeddings) vectors.push(normalize(embedding.values));
    }
    return vectors;
  }

  public async embedQuery(text: string): Promise<number[]> {
    const body = await this.post(
      `/v1beta/models/${encodeURIComponent(this.model)}:embedContent`,
      {
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
      QUERY_TIMEOUT_MS,
      singleEmbeddingResponseSchema,
      "query embedding",
    );
    return normalize(body.embedding.values);
  }

  /**
   * Error messages name the failing shape and path only. A provider body can be large and can echo request text.
   */
  private async post<S extends z.ZodType>(
    path: string,
    body: unknown,
    timeoutMs: number,
    schema: S,
    shape: string,
  ): Promise<z.infer<S>> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Gemini embedding request failed with status ${response.status}`);
    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Gemini ${shape} response is not valid JSON`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const where = parsed.error.issues[0]?.path.map(String).join(".") || "root";
      throw new Error(
        `Gemini ${shape} response does not match the expected shape at ${where}: expected ${EMBEDDING_DIMENSIONS}-dimension vectors of finite numbers`,
      );
    }
    return parsed.data;
  }
}
