import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ROUTE_TABLE } from "./route-table.ts";

// This file sits in apps/ops-console-service/src/modules/system, five levels below the repository root.
const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const readDeploy = (...segments: string[]): string => readFileSync(join(repoRoot, ...segments), "utf8");

type Row = { path: string; service: string; method?: string | undefined };

const key = (row: Row): string => `${row.method ?? "*"} ${row.path} ${row.service}`;
const sorted = (values: readonly string[]): string[] => [...values].sort();

// The nginx variable each gateway location proxies to, and the service behind it (see the upstream map in AGENTS.md).
const UPSTREAM_SERVICE: Record<string, string> = {
  identity: "identity-service",
  catalog: "catalog-service",
  inventory: "inventory-service",
  sales: "sales-service",
  payment: "payment-service",
  query: "operations-query-service",
  chatbot: "chatbot-service",
  ops: "ops-console-service",
};

type Block = { header: string; upstream: string | undefined };

/** Splits routes.conf into its location blocks and the upstream each one proxies to. */
const parseGatewayBlocks = (text: string): Block[] => {
  const blocks: Block[] = [];
  let current: Block | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("location ")) {
      current = { header: line, upstream: undefined };
      blocks.push(current);
      continue;
    }
    const proxy = /^proxy_pass\s+\$(\w+);/.exec(line);
    if (proxy && current) current.upstream = proxy[1];
  }
  return blocks;
};

const serviceOf = (upstream: string | undefined): string => {
  const service = upstream === undefined ? undefined : UPSTREAM_SERVICE[upstream];
  if (service === undefined) throw new Error(`routes.conf proxies to an unknown upstream: ${upstream ?? "none"}`);
  return service;
};

const parseGateway = (
  text: string,
): { prefixes: Row[]; exact: Row[]; subLocations: { prefix: string; service: string }[] } => {
  const prefixes: Row[] = [];
  const exact: Row[] = [];
  const subLocations: { prefix: string; service: string }[] = [];
  for (const block of parseGatewayBlocks(text)) {
    const group = /^location ~ \^\/api\/\(([^)]+)\)\(\/\|\$\) \{$/.exec(block.header);
    if (group) {
      const service = serviceOf(block.upstream);
      for (const name of (group[1] ?? "").split("|")) prefixes.push({ path: `/api/${name}*`, service });
      continue;
    }
    const exactLocation = /^location = (\/api\/\S+) \{$/.exec(block.header);
    if (exactLocation) {
      // $products_upstream sends GET to search-service and everything else to catalog-service.
      if (block.upstream !== "products_upstream") throw new Error(`unexpected exact location ${block.header}`);
      exact.push({ path: exactLocation[1] ?? "", method: "GET", service: "search-service" });
      continue;
    }
    const sub = /^location ~ \^(\/api\/[^(]+)\(\/\|\$\) \{$/.exec(block.header);
    if (sub) subLocations.push({ prefix: sub[1] ?? "", service: serviceOf(block.upstream) });
  }
  return { prefixes, exact, subLocations };
};

/** The ALB listener rules in main.tf: the `path_rules` map, plus the product list rule that matches GET only. */
const parseAlb = (text: string): { prefixes: Row[]; exact: Row[] } => {
  const prefixes: Row[] = [];
  for (const rule of text.matchAll(/paths\s*=\s*\[([^\]]*)\]\s*service\s*=\s*"([^"]+)"/g)) {
    for (const path of (rule[1] ?? "").matchAll(/"([^"]+)"/g)) {
      prefixes.push({ path: `/api${path[1] ?? ""}`, service: rule[2] ?? "" });
    }
  }
  const search = /resource "aws_lb_listener_rule" "search_products" \{([\s\S]*?)\n\}/.exec(text)?.[1];
  if (search === undefined) throw new Error("main.tf has no search_products listener rule");
  const path = /path_pattern \{\s*values = \["([^"]+)"\]/.exec(search)?.[1];
  const method = /http_request_method \{\s*values = \["([^"]+)"\]/.exec(search)?.[1];
  const service = /aws_lb_target_group\.service\["([^"]+)"\]/.exec(search)?.[1];
  if (path === undefined || method === undefined || service === undefined) {
    throw new Error("search_products listener rule has no path, method or target group");
  }
  return { prefixes, exact: [{ path: `/api${path}`, method, service }] };
};

const routesConf = readDeploy("deploy", "local", "gateway", "routes.conf");
const mainTf = readDeploy("deploy", "aws", "main.tf");

const gateway = parseGateway(routesConf);
const alb = parseAlb(mainTf);
describe("ROUTE_TABLE against the deploy files", () => {
  it("lists the top-level prefixes that routes.conf and the ALB both forward, to the same service", () => {
    const table = ROUTE_TABLE.filter((row) => row.method === undefined && /^\/api\/[^/]+\*$/.test(row.path)).map(key);
    expect(sorted(table)).toEqual(sorted(gateway.prefixes.map(key)));
    expect(sorted(table)).toEqual(sorted(alb.prefixes.map(key)));
  });

  it("lists the product list GET row that routes.conf and the ALB send to search-service", () => {
    const table = ROUTE_TABLE.filter((row) => row.method !== undefined).map(key);
    expect(sorted(table)).toEqual(sorted(gateway.exact.map(key)));
    expect(sorted(table)).toEqual(sorted(alb.exact.map(key)));
  });

  it("routes each sub-location (the prescription intake body limit) to the service of its prefix", () => {
    expect(gateway.subLocations.length).toBeGreaterThan(0);
    for (const sub of gateway.subLocations) {
      const group = ROUTE_TABLE.find((row) => row.path === `/api/${sub.prefix.split("/")[2] ?? ""}*`);
      expect(group?.service, sub.prefix).toBe(sub.service);
    }
  });

  it("serves each platform-admin path from the same service as the prefix it sits under", () => {
    for (const row of ROUTE_TABLE.filter((candidate) => candidate.access.kind === "platform-admin")) {
      const prefix = `/api/${(row.path.split("/")[2] ?? "").replace(/\*$/, "")}*`;
      expect(ROUTE_TABLE.find((candidate) => candidate.path === prefix)?.service, row.path).toBe(row.service);
    }
  });
});
