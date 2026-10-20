import type { IntentVerdict } from "../../domain/intent-gate.ts";

// Starting values, not tuned on real traffic. Adjust them once the intent gate decision log shows how Jev scores real
// questions.
export const EMERGENCY_THRESHOLD = 0.6;
export const INJECTION_THRESHOLD = 0.7;
export const INTENT_CONFIDENCE_THRESHOLD = 0.6;

export type GateReason = "emergency" | "injection" | "greeting" | "out_of_scope";

export type GateDecision = { action: "allow" } | { action: "block"; reason: GateReason; reply: string };

/** Fixed replies for a blocked question. A blocked question costs no chat model call. */
export const GATE_REPLIES: Record<GateReason, string> = {
  emergency:
    "Nếu bạn hoặc người thân đang có dấu hiệu nguy hiểm đến tính mạng, hãy gọi cấp cứu 115 hoặc đến cơ sở y tế gần nhất ngay. Tôi không thể xử lý tình huống khẩn cấp qua tin nhắn.",
  injection: "Tôi không thể thực hiện yêu cầu này. Tôi chỉ tư vấn về sản phẩm và việc mua hàng tại Pharmacy Central.",
  greeting: "Rất vui được hỗ trợ bạn. Bạn cần tìm sản phẩm theo triệu chứng, tên thuốc hoặc hoạt chất, cứ hỏi tôi nhé.",
  out_of_scope:
    "Tôi chỉ tư vấn về sản phẩm và việc mua hàng tại Pharmacy Central. Bạn có thể hỏi tôi về triệu chứng, tên thuốc, hoạt chất hoặc cách đặt hàng.",
};

/** Precedence: emergency, then injection, then intent. Product intents and unclear verdicts go on to the chat model. */
export const decideGate = (verdict: IntentVerdict): GateDecision => {
  if (verdict.emergency >= EMERGENCY_THRESHOLD) {
    return { action: "block", reason: "emergency", reply: GATE_REPLIES.emergency };
  }
  if (verdict.injection >= INJECTION_THRESHOLD) {
    return { action: "block", reason: "injection", reply: GATE_REPLIES.injection };
  }
  if (
    (verdict.intent === "greeting" || verdict.intent === "out_of_scope") &&
    verdict.intentConfidence !== null &&
    verdict.intentConfidence >= INTENT_CONFIDENCE_THRESHOLD
  ) {
    return { action: "block", reason: verdict.intent, reply: GATE_REPLIES[verdict.intent] };
  }
  return { action: "allow" };
};
