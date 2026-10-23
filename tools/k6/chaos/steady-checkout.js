// Steady checkout load for the chaos runner: the checkout journey at a constant number of VUs for CHAOS_DURATION
// seconds. Failures are expected while a dependency is down, so no threshold can fail the run. The runner reads the
// totals from the `CHAOS_SUMMARY` line that handleSummary prints, and per-interval failure counts from Prometheus
// (`--out experimental-prometheus-rw`), where the two chaos counters below are pushed every few seconds.
import http from "k6/http";
import { Counter } from "k6/metrics";

import { required } from "../lib/config.js";

export { default, setup } from "../scenarios/checkout.js";

// A stopped dependency must fail a request fast instead of holding a VU for k6's 60 s default.
const REQUEST_TIMEOUT = "10s";
const chaosRequests = new Counter("chaos_http_requests");
const chaosErrors = new Counter("chaos_http_errors");

// The checkout journey reaches the gateway only through http.request (lib/session.js) and http.post (lib/sepay.js).
// Both are wrapped here, once, so every request gets the timeout and is counted: transport errors and 5xx are failures.
const request = http.request.bind(http);
const post = http.post.bind(http);
http.request = (method, url, body, params = {}) => tally(request(method, url, body, withTimeout(params)));
http.post = (url, body, params = {}) => tally(post(url, body, withTimeout(params)));

// setup() runs once as VU 0 and imports the opening stock, which legitimately takes longer than a request cap.
function withTimeout(params) {
  return __VU === 0 ? params : { timeout: REQUEST_TIMEOUT, ...params };
}

function tally(response) {
  chaosRequests.add(1);
  if (response.status === 0 || response.status >= 500) chaosErrors.add(1, { status: String(response.status) });
  return response;
}

export const options = {
  scenarios: {
    steady: {
      executor: "constant-vus",
      vus: Number(required("CHAOS_VUS")),
      duration: `${Number(required("CHAOS_DURATION"))}s`,
      gracefulStop: "30s",
    },
  },
  thresholds: {},
};

const metricValue = (data, name, stat) => data.metrics[name]?.values?.[stat] ?? 0;

export function handleSummary(data) {
  const summary = {
    durationSeconds: Math.round(data.state.testRunDurationMs / 1000),
    iterations: metricValue(data, "iterations", "count"),
    httpRequests: metricValue(data, "http_reqs", "count"),
    httpFailed: metricValue(data, "http_req_failed", "passes"),
    httpFailedRate: metricValue(data, "http_req_failed", "rate"),
    chaosRequests: metricValue(data, "chaos_http_requests", "count"),
    chaosErrors: metricValue(data, "chaos_http_errors", "count"),
    checksPassRate: metricValue(data, "checks", "rate"),
    businessRejections: metricValue(data, "business_rejections", "count"),
    orderToPaidP95Ms: data.metrics.order_to_paid_ms?.values?.["p(95)"] ?? null,
  };
  return { stdout: `CHAOS_SUMMARY ${JSON.stringify(summary)}\n` };
}
