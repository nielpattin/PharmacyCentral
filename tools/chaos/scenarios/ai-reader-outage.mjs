// The prescription reader misbehaves while a customer uploads a photo. sales-service calls the reader (Gemini only,
// 45 s timeout, no retry) once per photo. One copy of tools/mock-ai-server.mjs stands in for it, and sales-service is
// recreated once with AI_PRESCRIPTION_READER_* pointed at the mock (compose reads process variables before .env, so
// .env and the saved credentials stay untouched), then recreated again with the real settings at the end.
//
// Expected, from prescription-intake-routes.ts: a reader failure answers 502 reader_failed, never another 5xx and
// never a request held past the 45 s timeout. Real provider calls are never made.
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { composeCli } from "../lib/compose.mjs";
import { ROOT } from "../lib/exec.mjs";
import { ACCOUNTS } from "../lib/gateway.mjs";
import { TINY_PNG } from "../lib/shop.mjs";

const MOCK_PORT = 5392;
const READER_TIMEOUT_MS = 45_000;
// Longer than the reader timeout, so the client never gives up before the service does.
const CLIENT_TIMEOUT_MS = 70_000;
const SLOW_DELAY_MS = 60_000;
const FAST_BUDGET_MS = 6_000;

const describe = (response) => `${response.status}${response.body?.code ? `/${response.body.code}` : ""}`;
const isReaderFailed = (response) => response.status === 502 && response.body?.code === "reader_failed";

const mockControl = async (path, body) => {
  const response = await fetch(`http://127.0.0.1:${MOCK_PORT}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5_000),
  });
  return response.json();
};

const mockedReader = {
  AI_PRESCRIPTION_READER_PROVIDER: "gemini",
  AI_PRESCRIPTION_READER_BASE_URL: `http://host.docker.internal:${MOCK_PORT}`,
  AI_PRESCRIPTION_READER_MODEL: "mock-reader",
  AI_PRESCRIPTION_READER_API_KEY: "mock-key",
};

/** Uploads one photo and measures how long the answer took. */
async function upload(customer) {
  const startedAt = Date.now();
  const response = await customer.postRaw("/api/prescriptions/intake/image", TINY_PNG, "image/png", {
    timeoutMs: CLIENT_TIMEOUT_MS,
  });
  return { ...response, ms: Date.now() - startedAt };
}

export default {
  name: "ai-reader-outage",
  description: "prescription reader fails in every way: clean 502s inside the 45 s timeout, no hang, full recovery",
  plan: [
    "start a mock AI server (5392); recreate sales-service with the prescription reader pointed at it",
    "reader slow (60 s), hung, 500, 429, malformed, truncated: one photo each",
    "reader healthy again: the photo is read; sales-service stayed healthy",
    "recreate sales-service with the real provider settings",
  ],

  async preflight(ctx) {
    const anonymous = ctx.gateway.anonymous();
    const stores = await anonymous.get("/api/stores", { limit: 1 });
    ctx.check("dry run: store list answers", stores.status === 200, `status ${stores.status}`);
    ctx.check("dry run: docker compose reaches sales-service", Boolean(await ctx.compose.ps("sales-service")));
  },

  async run(ctx) {
    try {
      const child = spawn(process.execPath, ["tools/mock-ai-server.mjs"], {
        cwd: ROOT,
        windowsHide: true,
        env: { ...process.env, MOCK_AI_PORT: String(MOCK_PORT) },
        stdio: "ignore",
      });
      ctx.onCleanup(`stop the mock AI server on ${MOCK_PORT}`, () => child.kill());
      await ctx.waitFor("mock AI server answers", () => mockControl("/__mode"), { timeoutMs: 15_000, intervalMs: 300 });

      ctx.onCleanup("recreate sales-service with the real provider settings", async () => {
        await composeCli(["up", "-d", "--no-deps", "--force-recreate", "sales-service"], { timeoutMs: 180_000 });
        await ctx.compose.waitHealthy("sales-service", 120_000);
      });
      await composeCli(["up", "-d", "--no-deps", "--force-recreate", "sales-service"], {
        env: mockedReader,
        timeoutMs: 180_000,
      });
      await ctx.compose.waitHealthy("sales-service", 120_000);
      ctx.note("sales-service now talks to the mock reader");

      const customer = await ctx.gateway.login(ACCOUNTS.customer);

      const baseline = await upload(customer);
      const stats = await mockControl("/__stats");
      ctx.check(
        "healthy mock: the photo is read and the lines come back",
        baseline.status === 200 && Array.isArray(baseline.body?.lines),
        `${describe(baseline)} in ${baseline.ms} ms; mock saw ${stats.total} requests`,
      );
      if (baseline.status !== 200) {
        throw new Error(
          baseline.status === 429
            ? "The demo customer used its 30 photos of the day (5 a minute): wait, or clear its counter, see docs/Runbooks.md"
            : "The stack never reached the mock reader; later results would be meaningless",
        );
      }

      const faults = [
        {
          label: "slow answer (60 s, past the 45 s timeout)",
          mode: { mode: "slow", delayMs: SLOW_DELAY_MS },
          budget: READER_TIMEOUT_MS + 5_000,
          floor: READER_TIMEOUT_MS - 2_000,
        },
        { label: "hung", mode: { mode: "hang" }, budget: READER_TIMEOUT_MS + 5_000, floor: READER_TIMEOUT_MS - 2_000 },
        { label: "500 error", mode: { mode: "error500" }, budget: FAST_BUDGET_MS },
        { label: "429 rate limited", mode: { mode: "error429", retryAfterSeconds: 2 }, budget: FAST_BUDGET_MS },
        { label: "malformed JSON body", mode: { mode: "malformed" }, budget: FAST_BUDGET_MS },
        { label: "connection reset mid-body", mode: { mode: "truncated" }, budget: FAST_BUDGET_MS },
      ];
      for (const fault of faults) {
        await mockControl("/__mode", fault.mode);
        const answer = await upload(customer);
        ctx.check(
          `reader ${fault.label}: clean 502 reader_failed within ${fault.budget / 1000} s`,
          isReaderFailed(answer) && answer.ms <= fault.budget,
          `${describe(answer)} in ${answer.ms} ms`,
        );
        if (fault.floor) {
          ctx.check(
            `reader ${fault.label}: the 45 s timeout is what ends the wait`,
            answer.ms >= fault.floor,
            `${answer.ms} ms`,
          );
        }
        await mockControl("/__mode", { mode: "ok" });
        await delay(2_000);
      }

      // The limiter counts every photo that reaches the reader, failed reads included, so a customer whose photos kept
      // failing may be asked to wait. Retry until the window clears.
      const after = await ctx.waitFor(
        "photo accepted again after the limiter window",
        async () => {
          const attempt = await upload(customer);
          return attempt.status === 429 ? false : attempt;
        },
        { timeoutMs: 120_000, intervalMs: 10_000 },
      );
      ctx.check(
        "reader healthy again: the photo is read",
        after.status === 200,
        `${describe(after)} in ${after.ms} ms`,
      );
      const container = await ctx.compose.ps("sales-service");
      ctx.check(
        "sales-service stayed running and healthy (no restart needed)",
        container?.state === "running" && container.health === "healthy",
        `${container?.state}/${container?.health}`,
      );
    } finally {
      await ctx.restoreAll();
    }
  },
};
