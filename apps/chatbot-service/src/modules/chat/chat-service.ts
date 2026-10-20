import { z } from "zod";

import type { ChatProductCard, ChatProductRef, ChatReply } from "../../contracts/chat.ts";
import type {
  CatalogProduct,
  ChatModel,
  ChatTool,
  ChatToolCall,
  ChatToolResult,
  ChatTurn,
  ChatUsage,
  ProductDetails,
  ProductLookup,
  ProductPrice,
  ToolPrice,
  ToolProduct,
  ToolProductDetails,
} from "../../domain/chat-model.ts";
import type { IntentGate, IntentVerdict } from "../../domain/intent-gate.ts";
import {
  ChatRateLimitedError,
  ChatSessionFullError,
  type ChatSessionStore,
  type StoredTurn,
} from "./chat-session-store.ts";
import { decideGate } from "./intent-policy.ts";

export type ChatDependencies = {
  model: ChatModel;
  products: ProductLookup;
  store: ChatSessionStore;
  gate: IntentGate;
  reportUsage: (report: { usage: ChatUsage; modelCalls: number }) => void;
  reportGate: (report: { decision: "allow" | "block"; reason: string | null; verdict: IntentVerdict | null }) => void;
};

export const MAX_QUESTIONS_PER_SESSION = 20;
export const MAX_TOOL_ROUNDS = 2;
export const MAX_TOOL_CALLS_PER_QUESTION = 4;
export const MAX_PRODUCT_CARDS = 5;
export const MAX_QUESTIONS_PER_MINUTE = 10;
export const MAX_QUESTIONS_PER_DAY = 100;

const WRITE_LIMITS = {
  maxQuestionsPerSession: MAX_QUESTIONS_PER_SESSION,
  maxPerMinute: MAX_QUESTIONS_PER_MINUTE,
  maxPerDay: MAX_QUESTIONS_PER_DAY,
};

/** A blocked injection attempt is saved under this text, so the attack never returns to the chat model. */
const BLOCKED_INJECTION_QUESTION = "[Câu hỏi đã bị chặn]";

/** Raised for a missing session and for another customer's session, so responses do not reveal which ids exist. */
export class ChatSessionNotFoundError extends Error {
  public constructor(message = "Chat session not found") {
    super(message);
    this.name = "ChatSessionNotFoundError";
  }
}

/**
 * Gemini's implicit cache needs an identical prompt prefix. Keep per-question content out of this text. It travels as
 * tool results and history.
 */
export const SYSTEM_RULES = `Bạn là trợ lý tư vấn của nhà thuốc Pharmacy Central.

Công cụ:
- search_products: tìm sản phẩm trong danh mục theo nhu cầu, triệu chứng, tên hoặc hoạt chất. Gọi khi khách hỏi về sản phẩm mà cuộc trò chuyện chưa có thông tin.
- get_product_details: xem chi tiết một sản phẩm (hoạt chất, hàm lượng, dạng bào chế, quy cách, số đăng ký, giá) theo SKU đã xuất hiện trong cuộc trò chuyện.
- Không gọi công cụ cho lời chào, lời cảm ơn, hay câu hỏi về cách gửi ảnh, mã QR đơn thuốc và các bước đặt hàng.

Quy tắc:
- Chỉ nói về sản phẩm có trong kết quả công cụ hoặc đã giới thiệu trước đó trong cuộc trò chuyện. Không bịa thông tin.
- Giá trong kết quả công cụ là giá niêm yết hiện tại cho một đơn vị bán. Nêu đúng con số và đơn vị đó, và nói giá cuối cùng được xác nhận khi đặt hàng. Nếu không có giá, nói sản phẩm chưa có giá niêm yết. Không nói về tình trạng còn hàng.
- Không chẩn đoán bệnh và không kê đơn. Với câu hỏi về liều dùng hay tương tác thuốc, khuyên khách hỏi dược sĩ.
- Sản phẩm cần đơn thuốc chỉ bán khi có đơn; hãy nói rõ điều đó.
- Viết văn bản thuần, không dùng Markdown như **, #, hay danh sách lồng nhau.
- Trả lời bằng tiếng Việt, ngắn gọn.`;

export const CHAT_TOOLS: ChatTool[] = [
  {
    name: "search_products",
    description: "Tìm sản phẩm trong danh mục theo nhu cầu, triệu chứng, tên hoặc hoạt chất.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Từ khóa tìm kiếm, ví dụ triệu chứng, tên thuốc hoặc hoạt chất." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_product_details",
    description: "Xem chi tiết một sản phẩm theo SKU đã xuất hiện trong cuộc trò chuyện.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string", description: "Mã SKU của sản phẩm, lấy từ kết quả search_products hoặc lịch sử." },
      },
      required: ["sku"],
    },
  },
];

const searchArgs = z.object({ query: z.string().trim().min(1).max(200) });
const detailsArgs = z.object({ sku: z.string().trim().min(1).max(64) });

const toolPrice = (price: ProductPrice | null): ToolPrice | null =>
  price === null ? null : { amount: price.amount, currency: price.currency, unit: price.unitName };

const toolProduct = (product: CatalogProduct): ToolProduct => ({
  sku: product.sku,
  name: product.name,
  manufacturer: product.manufacturer,
  prescriptionRequired: product.prescriptionRequired,
  indications: product.indications,
  price: toolPrice(product.price),
});

const toolDetails = (details: ProductDetails): ToolProductDetails => ({
  ...toolProduct(details),
  genericName: details.genericName,
  activeIngredient: details.activeIngredient,
  strength: details.strength,
  dosageForm: details.dosageForm,
  packageDescription: details.packageDescription,
  registrationNumber: details.registrationNumber,
  category: details.category,
});

const toRef = (product: CatalogProduct): ChatProductRef => ({ id: product.id, sku: product.sku, name: product.name });

const toCard = (product: CatalogProduct): ChatProductCard => ({
  ...toRef(product),
  manufacturer: product.manufacturer,
  prescriptionRequired: product.prescriptionRequired,
  imageUrl: product.imageUrl,
  price: product.price,
});

export const renderTurn = (turn: StoredTurn): ChatTurn => {
  if (turn.role === "user") return { role: "user", content: turn.content };
  if (turn.products.length === 0) return { role: "assistant", content: turn.content };
  const listed = turn.products.map((product) => `${product.sku} (${product.name})`).join("; ");
  return { role: "assistant", content: `${turn.content}\n\n[Sản phẩm đã giới thiệu: ${listed}]` };
};

const createToolRunner = (lookup: ProductLookup, history: StoredTurn[]) => {
  const known = new Map<string, string>();
  for (const turn of history) {
    if (turn.role !== "assistant") continue;
    for (const product of turn.products) known.set(product.sku, product.id);
  }
  const surfaced: CatalogProduct[] = [];
  let toolCalls = 0;

  const search = async (args: unknown): Promise<ChatToolResult> => {
    const parsed = searchArgs.safeParse(args);
    if (!parsed.success) return { error: "invalid_arguments" };
    const products = await lookup.search(parsed.data.query);
    for (const product of products) {
      known.set(product.sku, product.id);
      surfaced.push(product);
    }
    return { products: products.map(toolProduct) };
  };

  const details = async (args: unknown): Promise<ChatToolResult> => {
    const parsed = detailsArgs.safeParse(args);
    if (!parsed.success) return { error: "invalid_arguments" };
    const productId = known.get(parsed.data.sku);
    if (productId === undefined) {
      return { error: "unknown_sku", message: "Gọi search_products trước để tìm sản phẩm." };
    }
    const product = await lookup.details(productId);
    if (product === undefined) return { error: "not_found" };
    surfaced.push(product);
    return { product: toolDetails(product) };
  };

  const runTool = async (call: ChatToolCall): Promise<ChatToolResult> => {
    if (toolCalls >= MAX_TOOL_CALLS_PER_QUESTION) {
      return { error: "tool_limit", message: "Đã đạt giới hạn số lần gọi công cụ cho câu hỏi này." };
    }
    toolCalls += 1;
    switch (call.name) {
      case "search_products":
        return search(call.args);
      case "get_product_details":
        return details(call.args);
      default:
        return { error: "unknown_tool" };
    }
  };

  return { runTool, surfaced };
};

export const startChatSession = (deps: ChatDependencies, customerId: string): Promise<string> =>
  deps.store.createSession(customerId);

export const sendChatMessage = async (
  deps: ChatDependencies,
  input: { customerId: string; sessionId: string; content: string },
): Promise<ChatReply> => {
  const history = await deps.store.findOwnedHistory({ sessionId: input.sessionId, customerId: input.customerId });
  if (!history) throw new ChatSessionNotFoundError();
  if (history.filter((turn) => turn.role === "user").length >= MAX_QUESTIONS_PER_SESSION) {
    throw new ChatSessionFullError();
  }

  const now = Date.now();
  const [lastMinute, lastDay] = await Promise.all([
    deps.store.countQuestionsSince({ customerId: input.customerId, since: new Date(now - 60_000) }),
    deps.store.countQuestionsSince({ customerId: input.customerId, since: new Date(now - 24 * 60 * 60_000) }),
  ]);
  if (lastMinute >= MAX_QUESTIONS_PER_MINUTE || lastDay >= MAX_QUESTIONS_PER_DAY) throw new ChatRateLimitedError();

  const verdict = await deps.gate.check({
    question: input.content,
    previousQuestion: history.findLast((turn) => turn.role === "user")?.content.slice(0, 300),
    previousReply: history.findLast((turn) => turn.role === "assistant")?.content.slice(0, 600),
  });
  if (verdict === undefined) {
    deps.reportGate({ decision: "allow", reason: null, verdict: null });
  } else {
    const decision = decideGate(verdict);
    if (decision.action === "block") {
      deps.reportGate({ decision: "block", reason: decision.reason, verdict });
      await deps.store.appendExchange({
        customerId: input.customerId,
        sessionId: input.sessionId,
        question: decision.reason === "injection" ? BLOCKED_INJECTION_QUESTION : input.content,
        reply: decision.reply,
        products: [],
        limits: WRITE_LIMITS,
        now: new Date(),
      });
      return { reply: decision.reply, products: [] };
    }
    deps.reportGate({ decision: "allow", reason: null, verdict });
  }

  const { runTool, surfaced } = createToolRunner(deps.products, history);
  const completion = await deps.model.complete({
    systemInstruction: SYSTEM_RULES,
    turns: [...history.map(renderTurn), { role: "user", content: input.content }],
    tools: CHAT_TOOLS,
    runTool,
    maxToolRounds: MAX_TOOL_ROUNDS,
  });
  // The provider bills calls even when the save fails, so usage is reported first.
  if (completion.usage !== undefined) {
    deps.reportUsage({ usage: completion.usage, modelCalls: completion.modelCalls });
  }

  const distinct = new Map<string, CatalogProduct>();
  for (const product of surfaced) {
    if (!distinct.has(product.id)) distinct.set(product.id, product);
  }
  const cards = [...distinct.values()].slice(0, MAX_PRODUCT_CARDS).map(toCard);
  await deps.store.appendExchange({
    customerId: input.customerId,
    sessionId: input.sessionId,
    question: input.content,
    reply: completion.text,
    products: cards.map((card) => ({ id: card.id, sku: card.sku, name: card.name })),
    limits: WRITE_LIMITS,
    now: new Date(),
  });
  return { reply: completion.text, products: cards };
};
