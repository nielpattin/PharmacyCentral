import { Router, type Request, type Response } from "express";

import { chatSessionParamsSchema, sendChatMessageRequestSchema } from "../../contracts/chat.ts";
import { ChatModelError, ProductLookupError } from "../../domain/chat-model.ts";
import { IntentGateError } from "../../domain/intent-gate.ts";
import { AiBudgetExceededError, AiCapacityError, AiPricingMissingError } from "../ai-budget/ai-budget-errors.ts";
import type { Logger } from "../../logger.ts";
import { ChatRateLimitedError, ChatSessionFullError } from "./chat-session-store.ts";
import { ChatSessionNotFoundError, sendChatMessage, startChatSession, type ChatDependencies } from "./chat-service.ts";

const UNAUTHENTICATED = {
  type: "https://api.pharmacycentral.local/problems/unauthenticated",
  title: "Customer sign-in required",
  status: 401,
  code: "unauthenticated",
};

/**
 * The gateway middleware verifies the identity context first. Employee and system callers get the same 401 as an
 * anonymous request.
 */
const requireCustomerId = (request: Request, response: Response): string | undefined => {
  const actorId = request.header("x-actor-id");
  if (request.header("x-actor-type") !== "customer" || !actorId) {
    response.status(401).json(UNAUTHENTICATED);
    return undefined;
  }
  return actorId;
};

const SESSION_NOT_FOUND = {
  type: "https://api.pharmacycentral.local/problems/chat-session-not-found",
  title: "Chat session not found",
  status: 404,
  code: "chat_session_not_found",
};

const SESSION_FULL = {
  type: "https://api.pharmacycentral.local/problems/chat-session-full",
  title: "Chat session is full",
  status: 409,
  code: "session_full",
};

const AI_BUDGET_EXCEEDED = {
  type: "https://api.pharmacycentral.local/problems/ai-budget-exceeded",
  title: "AI budget exceeded",
  status: 429,
  code: "ai_budget_exceeded",
};

const ASSISTANT_BUSY = {
  type: "https://api.pharmacycentral.local/problems/assistant-busy",
  title: "Assistant busy",
  status: 503,
  code: "assistant_busy",
};

/** Model and catalog failures answer 503 with a fixed code. The provider's wording never reaches the widget. */
export const createChatRouter = ({ deps, logger }: { deps: ChatDependencies; logger: Logger }): Router => {
  const router = Router();

  router.post("/chatbot/sessions", async (request, response) => {
    const customerId = requireCustomerId(request, response);
    if (!customerId) return;
    response.status(201).json({ id: await startChatSession(deps, customerId) });
  });

  router.post("/chatbot/sessions/:sessionId/messages", async (request, response) => {
    const customerId = requireCustomerId(request, response);
    if (!customerId) return;
    const params = chatSessionParamsSchema.safeParse(request.params);
    if (!params.success) {
      response.status(404).json(SESSION_NOT_FOUND);
      return;
    }
    const body = sendChatMessageRequestSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }
    try {
      response.json(
        await sendChatMessage(deps, {
          customerId,
          sessionId: params.data.sessionId,
          content: body.data.content,
        }),
      );
    } catch (error) {
      if (error instanceof ChatSessionNotFoundError) {
        response.status(404).json(SESSION_NOT_FOUND);
        return;
      }
      if (error instanceof ChatSessionFullError) {
        response.status(409).json(SESSION_FULL);
        return;
      }
      if (error instanceof ChatRateLimitedError) {
        response.status(429).json({
          type: "https://api.pharmacycentral.local/problems/chat-rate-limited",
          title: "Too many questions",
          status: 429,
          code: "rate_limited",
        });
        return;
      }
      if (error instanceof AiBudgetExceededError) {
        response.status(429).json(AI_BUDGET_EXCEEDED);
        return;
      }
      if (error instanceof AiCapacityError) {
        response.set("Retry-After", "5");
        response.status(503).json(ASSISTANT_BUSY);
        return;
      }
      if (error instanceof AiPricingMissingError) {
        // An admin must price the model before a spend limit can be enforced. Customers see the usual outage text.
        logger.error({ name: error.name, message: error.message }, "AI spend limit cannot be enforced");
        response.status(503).json({ title: "Assistant unavailable", status: 503, code: "assistant_unavailable" });
        return;
      }
      if (error instanceof ChatModelError || error instanceof ProductLookupError || error instanceof IntentGateError) {
        logger.error({ name: error.name, message: error.message }, "chat dependency failed");
        response.status(503).json({ title: "Assistant unavailable", status: 503, code: "assistant_unavailable" });
        return;
      }
      throw error;
    }
  });

  return router;
};
