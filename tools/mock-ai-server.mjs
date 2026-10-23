// Fake AI provider for the chaos tests of the chatbot and the prescription reader. Zero dependencies.
//
// Speaks the wire protocols the services call:
//   POST */chat/completions                    OpenAI-compatible chat (chatbot, provider openai-compatible)
//   POST /v1/systemone                         TypeSafe Jev intent gate (chatbot, intent-gate)
//   POST /v1beta/models/{m}:generateContent    Gemini text and vision (chatbot gemini, prescription reader)
//   POST /v1beta/models/{m}:embedContent       Gemini embeddings (catalog-service)
//   POST /v1beta/models/{m}:batchEmbedContents
//
// Every provider request answers according to the current mode. The control API on the same port changes the mode
// at runtime:
//   POST /__mode   {"mode":"slow","delayMs":25000} | {"mode":"error429","retryAfterSeconds":2} | {"mode":"ok"} ...
//   GET  /__mode   current mode
//   GET  /__stats  request counts per path and mode, last request timestamps
//   POST /__reset  mode back to ok, stats cleared, held (hung) connections closed
//
// Run: MOCK_AI_PORT=5390 node tools/mock-ai-server.mjs

import { createServer } from "node:http";

const MODES = ["ok", "slow", "hang", "error500", "error429", "malformed", "truncated"];
const JSON_TYPE = "application/json; charset=utf-8";
const MAX_BODY_BYTES = 32 * 1024 * 1024;
// Must match EMBEDDING_DIMENSIONS in apps/catalog-service/src/modules/catalog/search/text-embedder.ts.
const EMBEDDING_DIMENSIONS = 768;
const MOCK_REPLY = "Mock AI reply.";
const MALFORMED_BODY = '{"id":"chatcmpl-mock","choices":[{"message":{"content":"Mock';
const INTENT_ANSWER = {
  answers: {
    intent: { type: "choice", choice: "product_search", confidence: 0.9 },
    emergency: { type: "noul", noul: 0 },
    injection: { type: "noul", noul: 0 },
  },
};
const PRESCRIPTION_ANSWER = {
  isPrescription: true,
  code: null,
  patientName: null,
  facilityName: null,
  doctorName: null,
  diagnosis: null,
  issuedOn: null,
  lines: [
    {
      rawText: "Paracetamol 500mg - 10 viên",
      name: "Paracetamol 500mg",
      activeIngredients: ["Paracetamol"],
      strength: "500 mg",
      dosageForm: "Viên nén",
      quantity: 10,
      unit: "viên",
      usage: "Sáng 1 viên, tối 1 viên sau ăn",
    },
  ],
};

const port = readPort(process.env.MOCK_AI_PORT);
const state = { mode: "ok", delayMs: 0, retryAfterSeconds: 1 };
const stats = { startedAt: new Date().toISOString(), total: 0, lastRequestAt: null, paths: {} };
/** Responses held open by `hang`, closed by `/__reset`. */
const held = new Set();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const server = createServer((req, res) => {
  void handle(req, res);
});

server.listen(port, "0.0.0.0", () => log(`listening on 0.0.0.0:${port} mode=${state.mode}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    log(`${signal} received, stopping`);
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}

function readPort(raw) {
  if (raw === undefined || raw.trim() === "") {
    throw new Error("MOCK_AI_PORT is required, for example MOCK_AI_PORT=5390");
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`MOCK_AI_PORT must be a TCP port from 1 to 65535, got "${raw}"`);
  }
  return value;
}

async function handle(req, res) {
  const started = Date.now();
  const url = new URL(req.url ?? "/", "http://mock.local");
  const isControl = url.pathname.startsWith("/__");
  const settings = { ...state };
  const ctx = { mode: isControl ? "control" : settings.mode, outcome: "answered" };
  res.once("close", () =>
    log(
      `${req.method} ${url.pathname} mode=${ctx.mode} outcome=${ctx.outcome} ` +
        `status=${res.headersSent ? res.statusCode : "-"} ms=${Date.now() - started}`,
    ),
  );

  try {
    const rawBody = await readBody(req);
    if (isControl) return handleControl(req, res, url.pathname, rawBody, ctx);
    record(req.method, url.pathname, settings.mode);
    return answerProvider(req, res, ctx, settings, url.pathname, rawBody);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    ctx.outcome = `error: ${error.message}`;
    if (res.headersSent) {
      res.destroy();
    } else {
      sendJson(res, status, errorPayload(error.message), { connection: "close" });
    }
  }
}

function answerProvider(req, res, ctx, settings, pathname, rawBody) {
  const routed = route(req.method, pathname, rawBody);
  switch (settings.mode) {
    case "ok":
      return sendJson(res, routed.status, routed.payload);
    case "slow": {
      const timer = setTimeout(() => {
        ctx.outcome = `slow-answer after ${settings.delayMs}ms`;
        sendJson(res, routed.status, routed.payload);
      }, settings.delayMs);
      res.once("close", () => clearTimeout(timer));
      return;
    }
    case "hang":
      ctx.outcome = "held";
      held.add(res);
      res.once("close", () => held.delete(res));
      return;
    case "error500":
      ctx.outcome = "http-500";
      return sendJson(res, 500, errorPayload("mock provider failure"));
    case "error429":
      ctx.outcome = "http-429";
      return sendJson(res, 429, errorPayload("mock provider rate limit"), {
        "retry-after": String(settings.retryAfterSeconds),
      });
    case "malformed":
      ctx.outcome = "malformed-body";
      res.writeHead(200, { "content-type": JSON_TYPE, "content-length": Buffer.byteLength(MALFORMED_BODY) });
      return res.end(MALFORMED_BODY);
    case "truncated": {
      // Headers and half the body go out, then the socket is reset, so the client sees a mid-body failure.
      const full = Buffer.from(JSON.stringify(routed.payload));
      ctx.outcome = "reset-mid-body";
      res.writeHead(routed.status, { "content-type": JSON_TYPE, "content-length": full.length });
      res.write(full.subarray(0, Math.floor(full.length / 2)), () => {
        if (!req.socket.destroyed) req.socket.resetAndDestroy();
      });
      return;
    }
    default:
      throw new Error(`unknown mode ${settings.mode}`);
  }
}

function handleControl(req, res, pathname, rawBody, ctx) {
  if (pathname === "/__mode" && req.method === "GET") return sendJson(res, 200, state);
  if (pathname === "/__mode" && req.method === "POST") {
    const change = parseModeChange(parseBody(rawBody));
    Object.assign(state, change);
    ctx.outcome = `mode-set ${state.mode} delayMs=${state.delayMs} retryAfterSeconds=${state.retryAfterSeconds}`;
    return sendJson(res, 200, state);
  }
  if (pathname === "/__stats" && req.method === "GET") {
    return sendJson(res, 200, { ...stats, mode: state.mode, heldRequests: held.size });
  }
  if (pathname === "/__reset" && req.method === "POST") {
    reset();
    ctx.outcome = "reset";
    return sendJson(res, 200, state);
  }
  return sendJson(res, 404, errorPayload(`no control route for ${req.method} ${pathname}`));
}

function parseModeChange(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'body must be a JSON object such as {"mode":"ok"}');
  }
  const { mode, delayMs, retryAfterSeconds } = body;
  if (!MODES.includes(mode)) throw new HttpError(400, `mode must be one of ${MODES.join(", ")}`);
  if (mode === "slow" && !(Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 600_000)) {
    throw new HttpError(400, "slow needs delayMs, an integer from 0 to 600000");
  }
  if (retryAfterSeconds !== undefined && !(Number.isInteger(retryAfterSeconds) && retryAfterSeconds >= 0)) {
    throw new HttpError(400, "retryAfterSeconds must be an integer from 0");
  }
  return {
    mode,
    delayMs: mode === "slow" ? delayMs : 0,
    retryAfterSeconds: retryAfterSeconds ?? 1,
  };
}

function reset() {
  Object.assign(state, { mode: "ok", delayMs: 0, retryAfterSeconds: 1 });
  for (const res of held) res.destroy();
  held.clear();
  stats.startedAt = new Date().toISOString();
  stats.total = 0;
  stats.lastRequestAt = null;
  stats.paths = {};
}

function record(method, pathname, mode) {
  const now = new Date().toISOString();
  const key = `${method} ${pathname.replace(/\/models\/[^/:]+/, "/models/{model}")}`;
  const entry = (stats.paths[key] ??= { count: 0, lastAt: null, byMode: {} });
  entry.count += 1;
  entry.lastAt = now;
  entry.byMode[mode] = (entry.byMode[mode] ?? 0) + 1;
  stats.total += 1;
  stats.lastRequestAt = now;
}

/** Returns the status and body a healthy provider would send. Modes other than `ok` decide what goes on the wire. */
function route(method, pathname, rawBody) {
  if (method !== "POST") return { status: 405, payload: errorPayload(`method not allowed: ${method}`) };
  const body = tryParse(rawBody);
  if (typeof body !== "object" || body === null) {
    return { status: 400, payload: errorPayload("request body must be a JSON object") };
  }
  if (pathname.endsWith("/chat/completions")) return { status: 200, payload: chatCompletion(body) };
  if (pathname === "/v1/systemone") return { status: 200, payload: INTENT_ANSWER };

  const gemini = /^\/v1beta\/models\/[^/:]+:(\w+)$/.exec(pathname);
  if (gemini?.[1] === "generateContent") return { status: 200, payload: geminiGenerate(body) };
  if (gemini?.[1] === "embedContent") {
    return { status: 200, payload: { embedding: { values: vectorFor(textOf(body.content)) } } };
  }
  if (gemini?.[1] === "batchEmbedContents") {
    const requests = Array.isArray(body.requests) ? body.requests : [];
    return {
      status: 200,
      payload: { embeddings: requests.map((request) => ({ values: vectorFor(textOf(request?.content)) })) },
    };
  }
  return { status: 404, payload: errorPayload(`no mock route for ${method} ${pathname}`) };
}

function chatCompletion(body) {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: typeof body.model === "string" ? body.model : "mock-model",
    choices: [{ index: 0, message: { role: "assistant", content: MOCK_REPLY }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 12,
      total_tokens: 22,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

/** A request whose generationConfig carries the prescription schema gets the extraction JSON; any other gets text. */
function geminiGenerate(body) {
  const properties = body.generationConfig?.responseJsonSchema?.properties;
  const isExtraction = typeof properties === "object" && properties !== null && "isPrescription" in properties;
  const text = isExtraction ? JSON.stringify(PRESCRIPTION_ANSWER) : MOCK_REPLY;
  return {
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 12, totalTokenCount: 22 },
  };
}

/** A unit vector whose hot component depends on the text, so equal texts embed equally. */
function vectorFor(text) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)) % EMBEDDING_DIMENSIONS;
  const values = new Array(EMBEDDING_DIMENSIONS).fill(0);
  values[hash] = 1;
  return values;
}

function textOf(content) {
  if (!Array.isArray(content?.parts)) return "";
  return content.parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseBody(text) {
  const body = tryParse(text);
  if (body === undefined) throw new HttpError(400, "request body is not JSON");
  return body;
}

function errorPayload(message) {
  return { error: { message } };
}

function sendJson(res, status, payload, headers = {}) {
  const text = JSON.stringify(payload);
  res.writeHead(status, { "content-type": JSON_TYPE, "content-length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

function log(line) {
  console.log(`${new Date().toISOString()} mock-ai ${line}`);
}
