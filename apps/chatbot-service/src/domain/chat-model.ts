export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ChatTool = { name: string; description: string; parameters: Record<string, unknown> };

/** One call the model asked for. `args` is model output and stays untrusted until validated. */
export type ChatToolCall = { name: string; args: unknown };

export type ToolErrorCode = "invalid_arguments" | "unknown_sku" | "not_found" | "tool_limit" | "unknown_tool";

export type ChatToolError = { error: ToolErrorCode; message?: string };

export type ToolPrice = { amount: string; currency: string; unit: string };

/** Catalog facts the model may read. Internal ids and image urls stay out of it. */
export type ToolProduct = {
  sku: string;
  name: string;
  manufacturer: string | null;
  prescriptionRequired: boolean;
  indications: string | null;
  price: ToolPrice | null;
};

export type ToolProductDetails = ToolProduct & {
  genericName: string | null;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: string | null;
  packageDescription: string | null;
  registrationNumber: string | null;
  category: string | null;
};

export type ChatToolResult = ChatToolError | { products: ToolProduct[] } | { product: ToolProductDetails };

export type ChatCompletionInput = {
  systemInstruction: string;
  turns: ChatTurn[];
  tools: ChatTool[];
  runTool: (call: ChatToolCall) => Promise<ChatToolResult>;
  maxToolRounds: number;
};

/**
 * Token counts as the provider billed one call. `outputTokens` excludes thought tokens, which `thoughtTokens` counts.
 * A missing usage block stays undefined, never zero-filled.
 */
export type ChatUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number; thoughtTokens: number };

export type ChatCompletion = { text: string; usage: ChatUsage | undefined; modelCalls: number };

export interface ChatModel {
  complete(input: ChatCompletionInput): Promise<ChatCompletion>;
}

/** Raised for every provider failure. The message omits the response body, which echoes the shopper's question. */
export class ChatModelError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatModelError";
  }
}

export type ProductPrice = { amount: string; currency: string; unitName: string };

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  manufacturer: string | null;
  indications: string | null;
  prescriptionRequired: boolean;
  imageUrl: string | null;
  price: ProductPrice | null;
};

export type ProductDetails = CatalogProduct & {
  genericName: string | null;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: string | null;
  packageDescription: string | null;
  registrationNumber: string | null;
  category: string | null;
};

export interface ProductLookup {
  search(text: string): Promise<CatalogProduct[]>;
  /** Undefined when the catalog has no such product or it is no longer on sale. */
  details(productId: string): Promise<ProductDetails | undefined>;
}

export class ProductLookupError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProductLookupError";
  }
}
