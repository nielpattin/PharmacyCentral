export type Section<T> = { status: "ok"; data: T } | { status: "unavailable"; error: string };

export const settle = async <T>(work: () => Promise<T>): Promise<Section<T>> => {
  try {
    return { status: "ok", data: await work() };
  } catch (error) {
    return { status: "unavailable", error: error instanceof Error ? error.message : String(error) };
  }
};

export type ServiceTarget = { name: string; url: string; healthPath: string; livePath: string };

export type Probes = {
  services: ServiceTarget[];
  prometheusUrl: string;
  rabbitmq: { url: string; user: string; password: string };
  typesense: { url: string; apiKey: string };
  /** Timeout for health probes and the RabbitMQ and Typesense reads. */
  timeoutMs: number;
  /** Timeout for Prometheus queries, which can take longer than a health probe. */
  queryTimeoutMs: number;
  fetch: typeof fetch;
};

const getJson = async (probes: Probes, url: string, headers: Record<string, string> = {}): Promise<unknown> => {
  const response = await probes.fetch(url, { headers, signal: AbortSignal.timeout(probes.timeoutMs) });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
};

export type EndpointProbe = { up: boolean; httpStatus: number | null; latencyMs: number | null };

/** One GET against a health endpoint. A 2xx answer is up; a refused or timed-out connection is down with no status. */
export const probeEndpoint = async (probes: Probes, url: string): Promise<EndpointProbe> => {
  const started = performance.now();
  try {
    const response = await probes.fetch(url, { signal: AbortSignal.timeout(probes.timeoutMs) });
    await response.body?.cancel();
    return {
      up: response.ok,
      httpStatus: response.status,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch {
    return { up: false, httpStatus: null, latencyMs: null };
  }
};

export type ServiceProbe = {
  name: string;
  status: "up" | "down";
  httpStatus: number | null;
  latencyMs: number | null;
  liveStatus: "up" | "down";
  liveHttpStatus: number | null;
};

export const probeServices = (probes: Probes): Promise<ServiceProbe[]> =>
  Promise.all(
    probes.services.map(async (target): Promise<ServiceProbe> => {
      const [ready, live] = await Promise.all([
        probeEndpoint(probes, `${target.url}${target.healthPath}`),
        probeEndpoint(probes, `${target.url}${target.livePath}`),
      ]);
      return {
        name: target.name,
        status: ready.up ? "up" : "down",
        httpStatus: ready.httpStatus,
        latencyMs: ready.latencyMs,
        liveStatus: live.up ? "up" : "down",
        liveHttpStatus: live.httpStatus,
      };
    }),
  );

export type QueueDepth = {
  name: string;
  ready: number;
  unacknowledged: number;
  consumers: number;
  deadLetter: boolean;
};

type RabbitQueue = { name: string; messages_ready?: number; messages_unacknowledged?: number; consumers?: number };

export const probeQueues = async (probes: Probes): Promise<QueueDepth[]> => {
  const { url, user, password } = probes.rabbitmq;
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  const queues = (await getJson(probes, `${url}/api/queues`, { Authorization: auth })) as RabbitQueue[];
  return queues
    .map((queue) => ({
      name: queue.name,
      ready: queue.messages_ready ?? 0,
      unacknowledged: queue.messages_unacknowledged ?? 0,
      consumers: queue.consumers ?? 0,
      deadLetter: queue.name.endsWith(".dead"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export type SearchCollection = { name: string; documents: number };

export const probeSearchIndex = async (probes: Probes): Promise<SearchCollection[]> => {
  const collections = (await getJson(probes, `${probes.typesense.url}/collections`, {
    "X-TYPESENSE-API-KEY": probes.typesense.apiKey,
  })) as { name: string; num_documents: number }[];
  return collections.map((collection) => ({ name: collection.name, documents: collection.num_documents }));
};
