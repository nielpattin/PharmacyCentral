import { requiredEnv } from "./env.mjs";

/** Grafana's API through the proxy: `path` starts with `/api`. */
function grafana(path) {
  const token = Buffer.from(`${requiredEnv("GRAFANA_ADMIN_USER")}:${requiredEnv("GRAFANA_ADMIN_PASSWORD")}`).toString(
    "base64",
  );
  return fetch(`http://127.0.0.1:${requiredEnv("GRAFANA_PORT")}${path}`, {
    headers: { Authorization: `Basic ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
}

/** Instant Prometheus query through the Grafana datasource proxy. Resolves with the result vector. */
export async function prom(query) {
  const response = await grafana(
    `/api/datasources/proxy/uid/prometheus/api/v1/query?query=${encodeURIComponent(query)}`,
  );
  if (!response.ok) throw new Error(`Prometheus query answered HTTP ${response.status}`);
  const body = await response.json();
  if (body.status !== "success") throw new Error(`Prometheus query failed: ${body.error ?? body.status}`);
  return body.data.result;
}

/** The sum of every sample of a query; 0 when the query matches nothing. */
export async function promScalar(query) {
  const result = await prom(query);
  return result.reduce((sum, sample) => sum + Number(sample.value[1]), 0);
}

/** Grafana-managed alert rule states by title, e.g. `{ "Outbox stuck": "inactive" }`. */
export async function alerts() {
  const response = await grafana("/api/prometheus/grafana/api/v1/rules");
  if (!response.ok) throw new Error(`Grafana rules answered HTTP ${response.status}`);
  const body = await response.json();
  const rules = body.data.groups.flatMap((group) => group.rules);
  return Object.fromEntries(rules.map((rule) => [rule.name, rule.state]));
}
