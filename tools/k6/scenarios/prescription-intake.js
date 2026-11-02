// Prescription photo intake: one signed-in customer pass through POST /api/prescriptions/intake/image. Every profile runs
// the same single pass. The photo allowance is per account (5 a minute and 30 a day,
// apps/sales-service/src/modules/prescriptions/domain/prescription-intake-rate-limiter.ts), so more VUs would only add
// 429s. The pass makes at most six reader calls (each one a paid Gemini request) and enforces that at runtime.
//
// The intake is synchronous: the POST answers with the terminal result, so there is no status endpoint to poll. The
// image is a 70-byte PNG built in code. A blank image is not a prescription, so the reader's answer is normally 422
// not_a_prescription; that is a terminal business answer. A real 200 needs a real prescription photo, which cannot
// be shipped here without a binary file under tools/k6.
import { check, sleep } from "k6";
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";

import { accounts, targetUrl } from "../lib/config.js";
import { loginOncePerVu } from "../lib/session.js";

const photoLatency = new Trend("photo_intake_ms", true);
const businessRejections = new Counter("business_rejections");

// sales-service: MAX_IMAGE_BYTES, the route's body limit past which express answers 413.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// sales-service: PRESCRIPTION_INTAKE_RATE_LIMIT_WINDOWS, minute limit.
const MINUTE_LIMIT = 5;
// One pass: the happy photo, MINUTE_LIMIT - 1 concurrent photos that fill the minute window, and one after the 429.
const READER_CALL_CAP = 1 + (MINUTE_LIMIT - 1) + 1;
const TERMINAL_REJECTIONS = ["not_a_prescription", "unreadable_prescription"];
const IMAGE_PATH = "/api/prescriptions/intake/image";

export const options = {
  scenarios: {
    intake: { executor: "shared-iterations", vus: 1, iterations: 1, maxDuration: "5m" },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    // The photo route waits on Gemini for seconds per call.
    photo_intake_ms: ["p(95)<30000"],
  },
};

// A 1x1 PNG (70 bytes). Its magic bytes pass the type check; the reader decides what it is.
const PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 100, 96, 248, 95, 15, 0, 2, 135, 1, 128, 235, 71, 186, 146, 0, 0, 0, 0, 73,
  69, 78, 68, 174, 66, 96, 130,
]);

// One byte over the limit, starting with the PNG signature. The 413 comes from the body parser before any validation.
const OVERSIZE = new Uint8Array(MAX_IMAGE_BYTES + 1);
OVERSIZE.set(PNG, 0);

let readerCalls = 0;

// Counts photos that will reach the reader (each one a paid call) before they are sent, and refuses to exceed the cap.
function reserveReaderCalls(count) {
  readerCalls += count;
  if (readerCalls > READER_CALL_CAP) {
    throw new Error(`Reader calls exceed the cap of ${READER_CALL_CAP}: each one is a paid Gemini request`);
  }
}

function header(response, name) {
  const key = Object.keys(response.headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : response.headers[key];
}

function bodyOf(response) {
  try {
    return response.json();
  } catch (_error) {
    return undefined;
  }
}

function upload(customer, body, contentType, name, expect) {
  return customer.postRaw(IMAGE_PATH, body, {
    headers: customer.authHeaders(IMAGE_PATH, { "Content-Type": contentType }),
    name,
    expect,
  });
}

// One reader-bound photo, sent alone.
function readerUpload(customer, name, expect = [422]) {
  reserveReaderCalls(1);
  const response = upload(customer, PNG.buffer, "image/png", name, expect);
  photoLatency.add(response.timings.duration);
  return response;
}

// `count` reader-bound photos sent together. Sent one after another they would take longer than the minute window,
// because each one waits on Gemini, and the first would age out before the limit is reached.
function readerBurst(customer, count) {
  reserveReaderCalls(count);
  const headers = customer.authHeaders(IMAGE_PATH, { "Content-Type": "image/png" });
  const requests = Array.from({ length: count }, () => ({
    method: "POST",
    url: targetUrl() + IMAGE_PATH,
    body: PNG.buffer,
    params: {
      headers,
      tags: { name: "POST /prescriptions/intake/image (fill)" },
      responseCallback: http.expectedStatuses({ min: 200, max: 399 }, 422),
    },
  }));
  const responses = http.batch(requests);
  for (const response of responses) photoLatency.add(response.timings.duration);
  return responses;
}

function checkTerminal(response) {
  const body = bodyOf(response);
  if (response.status === 200) {
    check(body, {
      "photo intake returns the prescription and its lines": (b) =>
        b?.source === "image" && Array.isArray(b?.lines) && b.lines.length > 0,
    });
    return;
  }
  const accepted =
    response.status === 422 && TERMINAL_REJECTIONS.includes(body?.code) && typeof body?.detail === "string";
  check(response, { "photo reaches a terminal reader answer (200 or 422 verdict)": () => accepted });
  if (accepted) businessRejections.add(1, { reason: body.code });
}

// Reader is off when sales-service has no provider settings: 503 reader_unavailable, title "not configured". Any other
// 503 is a failure.
function isReaderNotConfigured(response) {
  const body = bodyOf(response);
  return (
    response.status === 503 &&
    body?.code === "reader_unavailable" &&
    body?.title === "Prescription reader is not configured"
  );
}

function checkOversize(customer) {
  const oversized = upload(
    customer,
    OVERSIZE.buffer,
    "image/png",
    "POST /prescriptions/intake/image (oversize)",
    [413],
  );
  check(oversized, {
    "photo over 8 MB is rejected with 413": (r) => r.status === 413 && bodyOf(r)?.status === 413,
  });
}

function checkUnsupportedTypes(customer) {
  const unsupported = upload(
    customer,
    PNG.buffer,
    "text/plain",
    "POST /prescriptions/intake/image (text/plain)",
    [400],
  );
  check(unsupported, {
    "unsupported content type is rejected (400 invalid_image)": (r) =>
      r.status === 400 && bodyOf(r)?.code === "invalid_image",
  });
  const mismatched = upload(customer, PNG.buffer, "image/jpeg", "POST /prescriptions/intake/image (mismatch)", [400]);
  check(mismatched, {
    "image bytes that do not match the declared type are rejected (400 invalid_image)": (r) =>
      r.status === 400 && bodyOf(r)?.code === "invalid_image",
  });
}

export default function () {
  const customer = loginOncePerVu(accounts.customer);
  readerCalls = 0;

  // Happy path: the first reader call. Its answer also tells whether the reader is configured.
  const happy = readerUpload(customer, "POST /prescriptions/intake/image (happy)", [422, 503]);
  if (isReaderNotConfigured(happy)) {
    businessRejections.add(1, { reason: "reader_not_configured" });
    console.warn("Prescription reader is not configured: only the 413 check ran, the reader-bound checks were skipped");
    checkOversize(customer);
    return;
  }
  checkTerminal(happy);

  for (const response of readerBurst(customer, MINUTE_LIMIT - 1)) checkTerminal(response);

  // The window now holds MINUTE_LIMIT attempts: the next photo is refused before the reader.
  const limited = upload(customer, PNG.buffer, "image/png", "POST /prescriptions/intake/image (limited)", [429]);
  const retryAfter = Number(header(limited, "Retry-After"));
  const waitable = Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60;
  check(limited, {
    "photo over the per-minute limit answers 429 rate_limited": (r) =>
      r.status === 429 && bodyOf(r)?.code === "rate_limited",
    "Retry-After is a wait within the one-minute window": () => waitable,
  });
  if (limited.status === 429) businessRejections.add(1, { reason: "rate_limited" });

  // Free checks: refused before the reader and the limiter, so they spend no allowance even while limited.
  checkUnsupportedTypes(customer);
  checkOversize(customer);

  // Recovery: the oldest counted attempt leaves the window after Retry-After seconds.
  if (waitable) sleep(retryAfter + 1);
  reserveReaderCalls(1);
  checkTerminal(upload(customer, PNG.buffer, "image/png", "POST /prescriptions/intake/image (recovered)", [422]));
}
