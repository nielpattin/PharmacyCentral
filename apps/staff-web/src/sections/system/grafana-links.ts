// Grafana bookmarks that replace what the System page no longer shows. Pure: the page renders the list and the Sheet
// passes the service name through the per-service helpers.
//
// Explore URLs use the format in Grafana's "Get started with Explore" docs (Generate Explore URLs from external tools):
// /explore?schemaVersion=1&orgId=1&panes=<URL-encoded JSON>, where panes maps a pane id to
// { datasource: root datasource uid, queries: [{ refId, datasource: { uid, type }, ...query }], range }.
// Dashboard uids and datasource uids are the ones provisioned under deploy/local/grafana.
export type GrafanaLink = {
  key:
    | "start"
    | "service_overview"
    | "latency_heatmap"
    | "service_graph"
    | "traces"
    | "logs"
    | "async_messaging"
    | "outbox";
  label: string;
  description: string;
  url: string;
};

const START_UID = "pharmacy-start";
const SERVICE_OVERVIEW_UID = "pc-service-overview";
const BUSINESS_HEALTH_UID = "pc-business-health";
const ASYNC_MESSAGING_UID = "pc-async-messaging";

// Panel ids of the Service Overview dashboard (deploy/local/grafana/dashboards/service-overview.json).
const LATENCY_HEATMAP_PANEL_ID = 19;

const PANE_ID = "pc";
const TEMPO = { type: "tempo", uid: "tempo" } as const;
const LOKI = { type: "loki", uid: "loki" } as const;
const DEFAULT_RANGE = { from: "now-1h", to: "now" };

/** Root spans of requests and messages, health checks left out; same filter the old Traces list used. */
const ROOT_SPAN_FILTER = `nestedSetParent < 0 && (kind = server || kind = consumer) && span.url.path !~ "/health.*"`;

type ExplorePane = {
  datasource: "tempo" | "loki";
  queries: [{ refId: "A"; datasource: { type: string; uid: string }; editorMode: "code" } & Record<string, unknown>];
  range: { from: string; to: string };
};

const dashboardUrl = (baseUrl: string, uid: string, query = ""): string =>
  `${baseUrl.replace(/\/$/, "")}/d/${uid}${query ? `?${query}` : ""}`;

const exploreUrl = (baseUrl: string, pane: ExplorePane): string => {
  const panes = encodeURIComponent(JSON.stringify({ [PANE_ID]: pane }));
  return `${baseUrl.replace(/\/$/, "")}/explore?schemaVersion=1&orgId=1&panes=${panes}`;
};

const tracesPane = (service?: string): ExplorePane => {
  const selector =
    service === undefined
      ? ROOT_SPAN_FILTER
      : `resource.service.name = ${JSON.stringify(service)} && ${ROOT_SPAN_FILTER}`;
  return {
    datasource: "tempo",
    queries: [
      {
        refId: "A",
        datasource: TEMPO,
        editorMode: "code",
        queryType: "traceql",
        query: `{ ${selector} }`,
        limit: 20,
        tableType: "traces",
      },
    ],
    range: DEFAULT_RANGE,
  };
};

/** Service Overview dashboard filtered to one service (var-service). */
export const serviceDashboardUrl = (baseUrl: string, service: string): string =>
  dashboardUrl(baseUrl, SERVICE_OVERVIEW_UID, `var-service=${encodeURIComponent(service)}`);

/** Explore on Tempo filtered to one service: root requests and messages, health checks left out. */
export const serviceTracesUrl = (baseUrl: string, service: string): string => exploreUrl(baseUrl, tracesPane(service));

/** Explore on Loki filtered to one service by its `service_name` stream label. */
export const serviceLogsUrl = (baseUrl: string, service: string): string =>
  exploreUrl(baseUrl, {
    datasource: "loki",
    queries: [
      {
        refId: "A",
        datasource: LOKI,
        editorMode: "code",
        queryType: "range",
        expr: `{service_name=${JSON.stringify(service)}}`,
      },
    ],
    range: DEFAULT_RANGE,
  });

/** Links that replace what the System page no longer shows. `baseUrl` is the Grafana public URL from the overview `links` entry labelled "Grafana". */
export const grafanaLinks = (baseUrl: string): GrafanaLink[] => [
  {
    key: "start",
    label: "Start here",
    description: "Where each signal the System page no longer shows lives in Grafana.",
    url: dashboardUrl(baseUrl, START_UID),
  },
  {
    key: "service_overview",
    label: "RED per service",
    description: "Request rate, errors and latency of each service. Choose one in the Service variable.",
    url: dashboardUrl(baseUrl, SERVICE_OVERVIEW_UID),
  },
  {
    key: "latency_heatmap",
    label: "Latency heatmap",
    description: "Latency distribution over time, in the Latency heatmap row of Service Overview.",
    url: dashboardUrl(baseUrl, SERVICE_OVERVIEW_UID, `viewPanel=panel-${LATENCY_HEATMAP_PANEL_ID}`),
  },
  {
    key: "service_graph",
    label: "Service map",
    description: "Services and the calls between them, with rate, errors and duration per link (Tempo, Explore).",
    url: exploreUrl(baseUrl, {
      datasource: "tempo",
      queries: [{ refId: "A", datasource: TEMPO, editorMode: "code", queryType: "serviceMap", query: "" }],
      range: DEFAULT_RANGE,
    }),
  },
  {
    key: "traces",
    label: "Trace search",
    description: "Recent requests and messages that started in a service, health checks left out (Tempo, Explore).",
    url: exploreUrl(baseUrl, tracesPane()),
  },
  {
    key: "logs",
    label: "Log search",
    description: "Log lines by service, with the trace id linked when present (Loki, Explore).",
    url: exploreUrl(baseUrl, {
      datasource: "loki",
      queries: [{ refId: "A", datasource: LOKI, editorMode: "code", queryType: "range", expr: `{service_name=~".+"}` }],
      range: DEFAULT_RANGE,
    }),
  },
  {
    key: "async_messaging",
    label: "Async messaging",
    description: "Publish and consume spans, their traces and broker logs (RabbitMQ).",
    url: dashboardUrl(baseUrl, ASYNC_MESSAGING_UID),
  },
  {
    key: "outbox",
    label: "Outbox and queues",
    description: "Outbox backlog and lag, queue depth, consumers and dead letters.",
    url: dashboardUrl(baseUrl, BUSINESS_HEALTH_UID),
  },
];
