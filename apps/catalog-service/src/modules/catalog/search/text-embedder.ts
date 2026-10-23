/**
 * Every provider returns vectors of this size and the Typesense collection is created for it. 384 is the native size
 * of multilingual-e5-small; Gemini and OpenAI models take it as a requested (truncated) output size.
 */
export const EMBEDDING_DIMENSIONS = 384;

export interface TextEmbedder {
  readonly model: string;
  /**
   * Cosine distance (0 to 2) above which a vector-only search hit is dropped; keyword matches are always kept. Each
   * model spreads its distances differently, so the value is calibrated per model on the seeded catalog.
   */
  readonly maxVectorDistance: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export type TextEmbedderSource = () => Promise<TextEmbedder | undefined>;
