export const EMBEDDING_DIMENSIONS = 768;

export interface TextEmbedder {
  readonly model: string;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export type TextEmbedderSource = () => Promise<TextEmbedder | undefined>;
