import type { RouteRow, ServiceCatalog, ServiceCatalogEntry } from "../../contracts/system.ts";
import type { ServiceManifestEntry } from "./service-manifest.ts";

/** Each service mapped to the services that call it, from every entry's `dependsOn`. Sorted by name. */
export const calledByIndex = (
  manifest: readonly Pick<ServiceManifestEntry, "name" | "dependsOn">[],
): Map<string, string[]> => {
  const callers = new Map<string, string[]>();
  for (const entry of manifest) {
    for (const target of entry.dependsOn) {
      callers.set(target, [...(callers.get(target) ?? []), entry.name].sort());
    }
  }
  return callers;
};

/** The System page's service catalog: the manifest, the route prefixes of each service, and who calls whom. */
export const buildServiceCatalog = (
  manifest: readonly ServiceManifestEntry[],
  routes: readonly RouteRow[],
): ServiceCatalog => {
  const callers = calledByIndex(manifest);
  const services: ServiceCatalogEntry[] = manifest.map((entry) => ({
    name: entry.name,
    description: entry.description,
    port: entry.port,
    database: entry.database,
    routePrefixes: routes
      .filter((row) => row.service === entry.name)
      .map((row) => (row.method === undefined ? row.path : `${row.method} ${row.path}`)),
    dependsOn: [...entry.dependsOn],
    calledBy: callers.get(entry.name) ?? [],
    events: { published: [...entry.events.published], consumed: [...entry.events.consumed] },
  }));
  return { services };
};
