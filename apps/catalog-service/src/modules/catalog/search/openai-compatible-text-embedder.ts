import { z } from "zod";

import { normalizeVector } from "./normalize-vector.ts";
import { EMBEDDING_DIMENSIONS, type TextEmbedder } from "./text-embedder.ts";

type OpenAiCompatibleTextEmbedderOptions = { baseUrl: string; model: string; apiKey: string };

// HuggingFace text-embeddings-inference accepts 32 inputs per request by default (--max-client-batch-size).
const DOCUMENT_BATCH_SIZE = 32;
const DOCUMENT_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 3_000;

const embeddingValuesSchema = z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS);
const embeddingsResponseSchema = z.object({
  data: z.array(z.object({ index: z.int().nonnegative(), embedding: embeddingValuesSchema })),
});

/**
 * The E5 family was trained with a role prefix on every text and returns worse vectors without it. Other models
 * (OpenAI, BGE-M3, Qwen3) take the text as it is.
 */
const isE5 = (model: string): boolean => /(^|[/_-])e5([/_-]|$)/i.test(model);

const prefixesFor = (model: string): { query: string; document: string } =>
  isE5(model) ? { query: "query: ", document: "passage: " } : { query: "", document: "" };

/**
 * Cosine distance above which a vector-only hit is dropped. E5 vectors sit close together: on the seeded catalog with
 * multilingual-e5-small, relevant hits measured 0.09 to 0.16 and unrelated or nonsense queries 0.17 and up (e5-base
 * measured 0.14 to 0.18 and 0.20 and up, so a model change means measuring again). Models without a measurement use
 * the Gemini value, which is uncalibrated for them: measure before trusting it.
 */
const maxVectorDistanceFor = (model: string): number => (isE5(model) ? 0.15 : 0.35);

/**
 * Any server that speaks `POST {baseUrl}/embeddings`: OpenAI, HuggingFace text-embeddings-inference, Ollama, vLLM.
 * The base URL ends with the API version path, for example `http://embedder:3000/v1`.
 */
export class OpenAiCompatibleTextEmbedder implements TextEmbedder {
  public readonly model: string;
  public readonly maxVectorDistance: number;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly prefixes: { query: string; document: string };

  public constructor(options: OpenAiCompatibleTextEmbedderOptions) {
    this.model = options.model;
    this.maxVectorDistance = maxVectorDistanceFor(options.model);
    this.endpoint = `${options.baseUrl.replace(/\/+$/, "")}/embeddings`;
    this.apiKey = options.apiKey;
    this.prefixes = prefixesFor(options.model);
  }

  public async embedDocuments(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += DOCUMENT_BATCH_SIZE) {
      const batch = texts.slice(start, start + DOCUMENT_BATCH_SIZE);
      const embeddings = await this.embed(
        batch.map((text) => `${this.prefixes.document}${text}`),
        DOCUMENT_TIMEOUT_MS,
      );
      if (embeddings.length !== batch.length) {
        throw new Error(`Embedding server returned ${embeddings.length} embeddings for ${batch.length} documents`);
      }
      vectors.push(...embeddings);
    }
    return vectors;
  }

  public async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embed([`${this.prefixes.query}${text}`], QUERY_TIMEOUT_MS);
    if (!embedding) throw new Error("Embedding server returned no embedding for the query");
    return embedding;
  }

  /**
   * Error messages name the failing shape and path only. A provider body can be large and can echo request text.
   */
  private async embed(input: string[], timeoutMs: number): Promise<number[][]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input, dimensions: EMBEDDING_DIMENSIONS }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Embedding request failed with status ${response.status}`);
    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Embedding response is not valid JSON");
    }
    const parsed = embeddingsResponseSchema.safeParse(json);
    if (!parsed.success) {
      const where = parsed.error.issues[0]?.path.map(String).join(".") || "root";
      throw new Error(
        `Embedding response does not match the expected shape at ${where}: expected ${EMBEDDING_DIMENSIONS}-dimension vectors of finite numbers`,
      );
    }
    // The API may answer out of order; `index` is the position of the input.
    return parsed.data.data
      .toSorted((left, right) => left.index - right.index)
      .map((item) => normalizeVector(item.embedding));
  }
}
