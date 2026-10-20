import { z } from "zod";

export const sendChatMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(1000),
});

export const chatSessionParamsSchema = z.object({
  sessionId: z.uuid(),
});

export const chatProductRefSchema = z.object({
  id: z.uuid(),
  sku: z.string().min(1),
  name: z.string(),
});

export const chatProductRefsSchema = z.array(chatProductRefSchema);

export type ChatProductRef = z.infer<typeof chatProductRefSchema>;

export type ChatProductCard = ChatProductRef & {
  manufacturer: string | null;
  prescriptionRequired: boolean;
  imageUrl: string | null;
  price: { amount: string; currency: string; unitName: string } | null;
};

export type ChatReply = {
  reply: string;
  products: ChatProductCard[];
};

export type CreatedChatSession = {
  id: string;
};
