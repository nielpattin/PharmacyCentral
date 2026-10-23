// Customer chatbot journey: one session of three questions (a catalog product lookup, an out-of-scope question the intent
// gate refuses, and a follow-up in the same session). The stress profile exceeds the per-customer question limit on
// purpose, checks the clean 429, then checks that the customer is answered again once the window clears.
//
// Every question calls the AI provider, so each profile's provider calls are capped by construction and checked when
// the script loads (see PLANS). Limits are from apps/chatbot-service/src/modules/chat/chat-service.ts.
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

import { accounts, profile } from "../lib/config.js";
import { loginOncePerVu } from "../lib/session.js";

const productLatency = new Trend("chat_product_ms", true);
const outOfScopeLatency = new Trend("chat_out_of_scope_ms", true);
const followUpLatency = new Trend("chat_follow_up_ms", true);
const businessRejections = new Counter("business_rejections");

// At most this many questions per customer in any 60 seconds (MAX_QUESTIONS_PER_MINUTE). Refused questions are not saved,
// so they do not count against the window.
const QUESTIONS_PER_MINUTE = 10;
const WINDOW_MS = 60_000;
// Worst case per question: one intent-gate call, then up to three chat-model rounds (MAX_TOOL_ROUNDS = 2 tool rounds,
// then the answer). A question the gate refuses costs only the gate call, so this is an upper bound.
const PROVIDER_CALLS_PER_QUESTION = 4;

// `questions` counts every message sent, including ones expected to be refused, so the cap holds even if all are answered.
const PLANS = {
  smoke: { vus: 1, iterations: 1, questions: 3, providerCallCap: 12 },
  load: { vus: 2, iterations: 2, questions: 3, providerCallCap: 30 },
  // Stress: one session, a burst of QUESTIONS_PER_MINUTE + 1 greetings, then one recovery question.
  stress: { vus: 1, iterations: 1, questions: QUESTIONS_PER_MINUTE + 2, providerCallCap: 48 },
};

const PROFILE = profile();
const plan = PLANS[PROFILE];
if (plan.iterations * plan.questions * PROVIDER_CALLS_PER_QUESTION > plan.providerCallCap) {
  throw new Error(`Profile ${PROFILE} can make more provider calls than its cap of ${plan.providerCallCap}`);
}

// The gate's fixed refusal for out-of-scope questions (GATE_REPLIES.out_of_scope in intent-policy.ts).
const OUT_OF_SCOPE_REPLY =
  "Tôi chỉ tư vấn về sản phẩm và việc mua hàng tại Pharmacy Central. Bạn có thể hỏi tôi về triệu chứng, tên thuốc, hoạt chất hoặc cách đặt hàng.";
const PRODUCT_QUESTION = "Nhà thuốc có Paracetamol 500mg không? Giá bao nhiêu một hộp?";
const OUT_OF_SCOPE_QUESTION = "Ngày mai ở Hà Nội có mưa to không?";
const FOLLOW_UP_QUESTION = "Vậy Paracetamol 500mg vừa rồi có cần đơn thuốc không?";
// A greeting is refused by the gate, so each burst question costs at most one provider call.
const BURST_QUESTION = "Xin chào";
const RECOVERY_ATTEMPTS = 3;
const RECOVERY_RETRY_S = 15;

export const options = {
  scenarios: {
    chatbot: {
      executor: "shared-iterations",
      vus: plan.vus,
      iterations: plan.iterations,
      maxDuration: "5m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    chat_product_ms: ["p(95)<20000"],
    ...(PROFILE === "stress"
      ? {}
      : {
          chat_out_of_scope_ms: ["p(95)<10000"],
          chat_follow_up_ms: ["p(95)<20000"],
        }),
  },
};

function openSession(customer) {
  const response = customer.post("/api/chatbot/sessions", undefined, { name: "POST /chatbot/sessions" });
  check(response, { "chat session opened (201)": (r) => r.status === 201 });
  return response.status === 201 ? response.json()?.id : undefined;
}

function ask(customer, sessionId, content, params = {}) {
  return customer.post(`/api/chatbot/sessions/${sessionId}/messages`, { content }, params);
}

function header(response, name) {
  const key = Object.keys(response.headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : response.headers[key];
}

// The answer must cite catalog products (cards carry real ids); one card is fetched from the catalog as a spot check.
function checkProductAnswer(customer, response) {
  if (!check(response, { "product question answered (200)": (r) => r.status === 200 })) return;
  const reply = response.json();
  check(reply, {
    "product answer has text": (body) => typeof body?.reply === "string" && body.reply.trim().length > 0,
    "product answer cites catalog products": (body) => Array.isArray(body?.products) && body.products.length > 0,
  });
  const card = reply?.products?.[0];
  if (!card) return;
  const product = customer.get(`/api/products/${card.id}`, { name: "GET /products/:id" }).json();
  check(product, { "spot-checked product exists in the catalog with the same SKU": (p) => p?.sku === card.sku });
}

function journey(customer) {
  const sessionId = openSession(customer);
  if (!sessionId) return;

  const product = ask(customer, sessionId, PRODUCT_QUESTION);
  productLatency.add(product.timings.duration);
  checkProductAnswer(customer, product);

  const outOfScope = ask(customer, sessionId, OUT_OF_SCOPE_QUESTION);
  outOfScopeLatency.add(outOfScope.timings.duration);
  if (check(outOfScope, { "out-of-scope question answered (200)": (r) => r.status === 200 })) {
    check(outOfScope.json(), {
      "intent gate refuses the out-of-scope question": (body) =>
        body?.reply === OUT_OF_SCOPE_REPLY && Array.isArray(body?.products) && body.products.length === 0,
    });
  }

  const followUp = ask(customer, sessionId, FOLLOW_UP_QUESTION);
  followUpLatency.add(followUp.timings.duration);
  if (check(followUp, { "follow-up question answered (200)": (r) => r.status === 200 })) {
    check(followUp.json(), {
      "follow-up gets a non-empty answer that is not a refusal": (body) =>
        typeof body?.reply === "string" && body.reply.trim().length > 0 && body.reply !== OUT_OF_SCOPE_REPLY,
    });
  }
}

// Over the limit the service answers 429 with code rate_limited. It sets no Retry-After; the check accepts one
// only when it is a whole number of seconds.
function checkLimited(response) {
  const retryAfter = header(response, "Retry-After");
  check(response, {
    "over-limit question answers 429 with rate_limited": (r) => r.status === 429 && r.json()?.code === "rate_limited",
    "Retry-After, when the service sends it, is whole seconds": () =>
      retryAfter === undefined || Number.isInteger(Number(retryAfter)),
  });
}

function burstThenRecover(customer) {
  const sessionId = openSession(customer);
  if (!sessionId) return;

  let limited = 0;
  let lastAnsweredAt;
  const burst = plan.questions - 1;
  for (let index = 0; index < burst; index++) {
    const response = ask(customer, sessionId, BURST_QUESTION, { expect: [429] });
    if (response.status === 200) lastAnsweredAt = Date.now();
    if (response.status === 429) {
      limited += 1;
      businessRejections.add(1, { reason: "rate_limited" });
      checkLimited(response);
    }
  }
  check({ limited }, { "the burst reached the per-minute limit (at least one 429)": (s) => s.limited >= 1 });

  // The window clears WINDOW_MS after the last saved question; wait that long plus a second before asking again.
  if (lastAnsweredAt !== undefined) {
    sleep(Math.max(0, lastAnsweredAt + WINDOW_MS + 1000 - Date.now()) / 1000);
  }
  let recovered;
  for (let attempt = 0; attempt < RECOVERY_ATTEMPTS && recovered === undefined; attempt++) {
    const response = ask(customer, sessionId, PRODUCT_QUESTION, { expect: [429] });
    if (response.status === 200) recovered = response;
    else sleep(RECOVERY_RETRY_S);
  }
  if (recovered) productLatency.add(recovered.timings.duration);
  if (recovered) checkProductAnswer(customer, recovered);
  check(
    { recovered: recovered !== undefined },
    {
      "customer is answered again after the window clears": (s) => s.recovered,
    },
  );
}

export default function () {
  const customer = loginOncePerVu(accounts.customer);
  if (PROFILE === "stress") burstThenRecover(customer);
  else journey(customer);
  sleep(1);
}
