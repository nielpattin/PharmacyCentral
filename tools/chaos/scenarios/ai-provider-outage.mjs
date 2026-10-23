// The AI providers misbehave while customers chat. chatbot-service talks to two providers: the chat model (30 s
// timeout, no retry) and the intent gate (4 s per attempt, 3 attempts). Two copies of tools/mock-ai-server.mjs stand in
// for them, so one can fail while the other stays healthy. chatbot-service is recreated once with its AI_CHATBOT_* and
// AI_INTENT_GATE_* variables pointed at the mocks (compose reads process variables before .env, so .env and the
// database stay untouched), and recreated again with the real settings at the end.
//
// Expected, from chat-routes.ts: any chat model or intent gate failure answers 503 assistant_unavailable, never a 5xx
// of another kind and never a request held past the provider timeouts. Real provider calls are never made.
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { composeCli } from "../lib/compose.mjs";
import { ROOT } from "../lib/exec.mjs";
import { ACCOUNTS } from "../lib/gateway.mjs";

const CHAT_PORT = 5390;
const GATE_PORT = 5391;
const MOCK_ORIGIN_FOR_CONTAINERS = "http://host.docker.internal";
const CHAT_TIMEOUT_MS = 30_000;
// 3 attempts x 4 s plus full-jitter backoff of at most 0.2 s and 0.4 s, with headroom.
const GATE_BUDGET_MS = 20_000;
const FAST_BUDGET_MS = 6_000;
// Longer than the 30 s model timeout, so the client never gives up before the service does.
const CLIENT_TIMEOUT_MS = 50_000;
const SLOW_DELAY_MS = 40_000;
const CONCURRENT_HANGING = 3;
const QUESTION = "Bạn có thuốc paracetamol không?";
const OK_REPLY = "Mock AI reply.";

const describe = (response) => `${response.status}${response.body?.code ? `/${response.body.code}` : ""}`;
const isUnavailable = (response) => response.status === 503 && response.body?.code === "assistant_unavailable";

const mockControl = async (port, path, body) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5_000),
  });
  return response.json();
};

async function startMock(ctx, port) {
  const child = spawn(process.execPath, ["tools/mock-ai-server.mjs"], {
    cwd: ROOT,
    windowsHide: true,
    env: { ...process.env, MOCK_AI_PORT: String(port) },
    stdio: "ignore",
  });
  ctx.onCleanup(`stop the mock AI server on ${port}`, () => child.kill());
  await ctx.waitFor(`mock AI server on ${port} answers`, () => mockControl(port, "/__mode"), {
    timeoutMs: 15_000,
    intervalMs: 300,
  });
}

const mockedProviders = {
  AI_CHATBOT_PROVIDER: "openai-compatible",
  AI_CHATBOT_BASE_URL: `${MOCK_ORIGIN_FOR_CONTAINERS}:${CHAT_PORT}/v1`,
  AI_CHATBOT_MODEL: "mock-chat",
  AI_CHATBOT_API_KEY: "mock-key",
  AI_INTENT_GATE_PROVIDER: "typesafe",
  AI_INTENT_GATE_BASE_URL: `${MOCK_ORIGIN_FOR_CONTAINERS}:${GATE_PORT}`,
  AI_INTENT_GATE_MODEL: "mock-gate",
  AI_INTENT_GATE_API_KEY: "mock-key",
};

/** Sends one question in a fresh session and measures how long the answer took. */
async function ask(customer) {
  const session = await customer.post("/api/chatbot/sessions");
  if (session.status !== 201) throw new Error(`Chat session could not be opened (${describe(session)})`);
  const startedAt = Date.now();
  const response = await customer.post(
    `/api/chatbot/sessions/${session.body.id}/messages`,
    { content: QUESTION },
    { timeoutMs: CLIENT_TIMEOUT_MS },
  );
  return { ...response, ms: Date.now() - startedAt };
}

export default {
  name: "ai-provider-outage",
  description: "chat model and intent gate fail in every way: clean 503s inside the timeouts, no hang, full recovery",
  plan: [
    "start two mock AI servers (chat model on 5390, intent gate on 5391); recreate chatbot-service pointed at them",
    "chat model slow (40 s), hung (3 concurrent questions, while an unrelated endpoint is timed), 500, 429, malformed, truncated",
    "intent gate hung and 500 while the chat model is healthy",
    "both healthy again: the same question is answered; chatbot-service stayed healthy throughout",
    "recreate chatbot-service with the real provider settings",
  ],

  async preflight(ctx) {
    const anonymous = ctx.gateway.anonymous();
    const stores = await anonymous.get("/api/stores", { limit: 1 });
    ctx.check("dry run: store list answers", stores.status === 200, `status ${stores.status}`);
    ctx.check("dry run: docker compose reaches chatbot-service", Boolean(await ctx.compose.ps("chatbot-service")));
  },

  async run(ctx) {
    try {
      await startMock(ctx, CHAT_PORT);
      await startMock(ctx, GATE_PORT);

      ctx.onCleanup("recreate chatbot-service with the real provider settings", async () => {
        await composeCli(["up", "-d", "--no-deps", "--force-recreate", "chatbot-service"]);
        await ctx.compose.waitHealthy("chatbot-service", 120_000);
      });
      await composeCli(["up", "-d", "--no-deps", "--force-recreate", "chatbot-service"], {
        env: mockedProviders,
        timeoutMs: 180_000,
      });
      await ctx.compose.waitHealthy("chatbot-service", 120_000);
      ctx.note("chatbot-service now talks to the mock providers");

      const customer = await ctx.gateway.login(ACCOUNTS.customer);
      const setChat = (mode) => mockControl(CHAT_PORT, "/__mode", mode);
      const setGate = (mode) => mockControl(GATE_PORT, "/__mode", mode);

      // Wiring: without a 200 from the mocks nothing below means anything (typically host.docker.internal is blocked).
      const baseline = await ask(customer);
      const chatStats = await mockControl(CHAT_PORT, "/__stats");
      const gateStats = await mockControl(GATE_PORT, "/__stats");
      ctx.check(
        "healthy mocks: a question is answered with the mock reply",
        baseline.status === 200 && String(baseline.body?.reply).includes(OK_REPLY),
        `${describe(baseline)} in ${baseline.ms} ms; chat mock saw ${chatStats.total} requests, gate mock ${gateStats.total}`,
      );
      if (baseline.status !== 200)
        throw new Error("The stack never reached the mock providers; later results would be meaningless");

      const chatFaults = [
        {
          label: "slow answer (40 s, past the 30 s timeout)",
          mode: { mode: "slow", delayMs: SLOW_DELAY_MS },
          budget: CHAT_TIMEOUT_MS + 5_000,
          floor: CHAT_TIMEOUT_MS - 2_000,
        },
        { label: "500 error", mode: { mode: "error500" }, budget: FAST_BUDGET_MS },
        { label: "429 rate limited", mode: { mode: "error429", retryAfterSeconds: 2 }, budget: FAST_BUDGET_MS },
        { label: "malformed JSON body", mode: { mode: "malformed" }, budget: FAST_BUDGET_MS },
        { label: "connection reset mid-body", mode: { mode: "truncated" }, budget: FAST_BUDGET_MS },
      ];
      for (const fault of chatFaults) {
        await setChat(fault.mode);
        const answer = await ask(customer);
        ctx.check(
          `chat model ${fault.label}: clean 503 assistant_unavailable`,
          isUnavailable(answer),
          `${describe(answer)} in ${answer.ms} ms`,
        );
        ctx.check(
          `chat model ${fault.label}: answered within ${fault.budget / 1000} s`,
          answer.ms <= fault.budget,
          `${answer.ms} ms`,
        );
        if (fault.floor) {
          ctx.check(
            `chat model ${fault.label}: the 30 s timeout is what ends the wait`,
            answer.ms >= fault.floor,
            `${answer.ms} ms`,
          );
        }
        await setChat({ mode: "ok" });
        await delay(3_000);
      }

      // 2. Chat model hung: concurrent questions must each end at the timeout, and unrelated endpoints stay fast.
      await setChat({ mode: "hang" });
      const hangingAnswers = Array.from({ length: CONCURRENT_HANGING }, () => ask(customer));
      await delay(5_000);
      const probes = [];
      for (let probe = 0; probe < 5; probe++) {
        const startedAt = Date.now();
        const stores = await ctx.gateway.anonymous().get("/api/stores", { limit: 1 });
        probes.push({ status: stores.status, ms: Date.now() - startedAt });
        await delay(500);
      }
      const answers = await Promise.all(hangingAnswers);
      ctx.check(
        `chat model hung: ${CONCURRENT_HANGING} concurrent questions each end in a clean 503 near the 30 s timeout`,
        answers.every((answer) => isUnavailable(answer) && answer.ms <= CHAT_TIMEOUT_MS + 5_000),
        answers.map((answer) => `${describe(answer)} ${answer.ms} ms`).join("; "),
      );
      ctx.check(
        "chat model hung: unrelated endpoints stay fast (store list under 2 s)",
        probes.every((probe) => probe.status === 200 && probe.ms < 2_000),
        probes.map((probe) => `${probe.status} ${probe.ms} ms`).join(", "),
      );
      await setChat({ mode: "ok" });
      await delay(3_000);

      const gateFaults = [
        { label: "hung", mode: { mode: "hang" }, budget: GATE_BUDGET_MS },
        { label: "500 error", mode: { mode: "error500" }, budget: GATE_BUDGET_MS },
      ];
      for (const fault of gateFaults) {
        await setGate(fault.mode);
        const answer = await ask(customer);
        ctx.check(
          `intent gate ${fault.label}: clean 503 assistant_unavailable within ${fault.budget / 1000} s`,
          isUnavailable(answer) && answer.ms <= fault.budget,
          `${describe(answer)} in ${answer.ms} ms`,
        );
        await setGate({ mode: "ok" });
        await delay(3_000);
      }
      const gateAttempts = (await mockControl(GATE_PORT, "/__stats")).total;
      ctx.note(`intent gate mock saw ${gateAttempts} requests in total (3 attempts per failing question expected)`);

      const after = await ask(customer);
      ctx.check(
        "both providers healthy again: the question is answered",
        after.status === 200 && String(after.body?.reply).includes(OK_REPLY),
        `${describe(after)} in ${after.ms} ms`,
      );
      const container = await ctx.compose.ps("chatbot-service");
      ctx.check(
        "chatbot-service stayed running and healthy (no restart needed)",
        container?.state === "running" && container.health === "healthy",
        `${container?.state}/${container?.health}`,
      );
      const serverErrors = await ctx.promScalar(
        `sum(increase(http_server_request_duration_seconds_count{service_name="chatbot-service",http_response_status_code=~"5..",http_response_status_code!="503"}[15m]))`,
      );
      ctx.check(
        "chatbot-service answered no 5xx other than the clean 503",
        serverErrors === 0,
        `${serverErrors} others`,
      );
    } finally {
      await ctx.restoreAll();
    }
  },
};
