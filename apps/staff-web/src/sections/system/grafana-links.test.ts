import { describe, expect, it } from "vitest";

import { grafanaLinks, serviceDashboardUrl, serviceLogsUrl, serviceTracesUrl } from "./grafana-links.ts";

type DecodedQuery = {
  refId: string;
  datasource: { type: string; uid: string };
  queryType?: string;
  query?: string;
  expr?: string;
};
type DecodedPane = { datasource: string; queries: DecodedQuery[]; range: { from: string; to: string } };

/** Reads `panes` back the way Grafana does: URL decoding, then JSON.
 * Pane ids are not fixed, so the first pane is returned. */
const firstPane = (url: string): DecodedPane => {
  const parsed = new URL(url);
  expect(parsed.pathname).toBe("/explore");
  expect(parsed.searchParams.get("schemaVersion")).toBe("1");
  expect(parsed.searchParams.get("orgId")).toBe("1");
  const panes = JSON.parse(parsed.searchParams.get("panes") ?? "{}") as Record<string, DecodedPane>;
  const [pane] = Object.values(panes);
  if (pane === undefined) throw new Error(`no pane in ${url}`);
  return pane;
};

describe("grafanaLinks", () => {
  it("lists the bookmarks that replace the System page sections, in order", () => {
    expect(grafanaLinks("http://localhost:3030").map((link) => link.key)).toEqual([
      "start",
      "service_overview",
      "latency_heatmap",
      "service_graph",
      "traces",
      "logs",
      "async_messaging",
      "outbox",
    ]);
  });

  it("handles a base URL with or without a trailing slash", () => {
    const withSlash = grafanaLinks("http://localhost:3030/");
    const withoutSlash = grafanaLinks("http://localhost:3030");
    expect(withSlash).toEqual(withoutSlash);
    for (const link of withSlash) {
      expect(link.url.startsWith("http://localhost:3030/")).toBe(true);
      expect(link.url.startsWith("http://localhost:3030//")).toBe(false);
    }
  });

  it("links the dashboards by uid and the heatmap by its panel", () => {
    const byKey = Object.fromEntries(grafanaLinks("http://g").map((link) => [link.key, link.url]));
    expect(byKey.start).toBe("http://g/d/pharmacy-start");
    expect(byKey.service_overview).toBe("http://g/d/pc-service-overview");
    expect(byKey.latency_heatmap).toBe("http://g/d/pc-service-overview?viewPanel=panel-19");
    expect(byKey.async_messaging).toBe("http://g/d/pc-async-messaging");
    expect(byKey.outbox).toBe("http://g/d/pc-business-health");
  });

  it("opens the service map on Tempo with the serviceMap query type", () => {
    const link = grafanaLinks("http://g").find((candidate) => candidate.key === "service_graph");
    if (link === undefined) throw new Error("no service_graph link");
    const pane = firstPane(link.url);
    expect(pane.datasource).toBe("tempo");
    expect(pane.queries[0]?.datasource).toEqual({ type: "tempo", uid: "tempo" });
    expect(pane.queries[0]?.queryType).toBe("serviceMap");
  });

  it("searches root traces without a service filter and excludes health checks", () => {
    const link = grafanaLinks("http://g").find((candidate) => candidate.key === "traces");
    if (link === undefined) throw new Error("no traces link");
    const pane = firstPane(link.url);
    const query = pane.queries[0]?.query ?? "";
    expect(pane.queries[0]?.queryType).toBe("traceql");
    expect(query).toBe('{ nestedSetParent < 0 && (kind = server || kind = consumer) && span.url.path !~ "/health.*" }');
    expect(query).not.toContain("resource.service.name");
  });

  it("searches Loki for every service", () => {
    const link = grafanaLinks("http://g").find((candidate) => candidate.key === "logs");
    if (link === undefined) throw new Error("no logs link");
    const pane = firstPane(link.url);
    expect(pane.datasource).toBe("loki");
    expect(pane.queries[0]?.datasource).toEqual({ type: "loki", uid: "loki" });
    expect(pane.queries[0]?.expr).toBe('{service_name=~".+"}');
  });
});

describe("serviceDashboardUrl", () => {
  it("puts the service name into var-service of the Service Overview", () => {
    const url = serviceDashboardUrl("http://localhost:3030/", "sales-service");
    expect(url).toBe("http://localhost:3030/d/pc-service-overview?var-service=sales-service");
    expect(new URL(url).searchParams.get("var-service")).toBe("sales-service");
  });
});

describe("serviceTracesUrl", () => {
  it("filters the Tempo root-span search to the service and keeps the health filter", () => {
    const pane = firstPane(serviceTracesUrl("http://localhost:3030/", "sales-service"));
    const query = pane.queries[0]?.query ?? "";
    expect(pane.datasource).toBe("tempo");
    expect(pane.queries[0]?.datasource).toEqual({ type: "tempo", uid: "tempo" });
    expect(query).toBe(
      '{ resource.service.name = "sales-service" && nestedSetParent < 0 && (kind = server || kind = consumer) && span.url.path !~ "/health.*" }',
    );
  });

  it("escapes quotes in the service name", () => {
    const pane = firstPane(serviceTracesUrl("http://g", 'odd"name'));
    expect(pane.queries[0]?.query).toContain('resource.service.name = "odd\\"name"');
  });
});

describe("serviceLogsUrl", () => {
  it("selects the Loki stream by service_name", () => {
    const pane = firstPane(serviceLogsUrl("http://localhost:3030", "payment-service"));
    expect(pane.datasource).toBe("loki");
    expect(pane.queries[0]?.datasource).toEqual({ type: "loki", uid: "loki" });
    expect(pane.queries[0]?.expr).toBe('{service_name="payment-service"}');
    expect(pane.range).toEqual({ from: "now-1h", to: "now" });
  });
});
