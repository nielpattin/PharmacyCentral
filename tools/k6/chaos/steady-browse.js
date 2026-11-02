// Steady browse load for the chaos runner: the anonymous storefront journey of scenarios/browse.js (store and product lists,
// search, product detail; no sign-in, no token) at a constant arrival rate for CHAOS_DURATION seconds.
// Failures are expected while a dependency is down, so no threshold can fail the run. Same CHAOS_SUMMARY line and
// Prometheus counters as steady-checkout.js.
import http from "k6/http";
import { Counter } from "k6/metrics";

import { required } from "../lib/config.js";

export { anonymousBrowse as default, setup } from "../scenarios/browse.js";

const REQUEST_TIMEOUT = "10s";
const chaosRequests = new Counter("chaos_http_requests");
const chaosErrors = new Counter("chaos_http_errors");

// The journey reaches the gateway through http.get.
const request = http.request.bind(http);
const get = http.get.bind(http);
http.request = (method, url, body, params = {}) => tally(request(method, url, body, withTimeout(params)));
http.get = (url, params = {}) => tally(get(url, withTimeout(params)));

// setup() runs once as VU 0 and reads the catalog, which legitimately takes longer than a request cap.
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
      executor: "constant-arrival-rate",
      rate: Number(required("CHAOS_RATE")),
      timeUnit: "1s",
      duration: `${Number(required("CHAOS_DURATION"))}s`,
      preAllocatedVUs: 40,
      maxVUs: 200,
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
    businessRejections: 0,
    orderToPaidP95Ms: null,
  };
  return { stdout: `CHAOS_SUMMARY ${JSON.stringify(summary)}\n` };
}
