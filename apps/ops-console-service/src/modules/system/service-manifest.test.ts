import { describe, expect, it } from "vitest";

import { PROBED_SERVICES } from "./probed-services.ts";
import { SERVICE_MANIFEST } from "./service-manifest.ts";

const names = SERVICE_MANIFEST.map((entry) => entry.name);
const publishedEvents = new Set(SERVICE_MANIFEST.flatMap((entry) => entry.events.published));

describe("service manifest", () => {
  it("has an entry for every service the System page probes, and for no other", () => {
    expect([...names].sort()).toEqual(PROBED_SERVICES.map((service) => service.name).sort());
  });

  it("depends only on known services, never on itself", () => {
    const known = new Set<string>(names);
    for (const entry of SERVICE_MANIFEST) {
      for (const target of entry.dependsOn) {
        expect(known.has(target), `${entry.name} -> ${target}`).toBe(true);
        expect(target, entry.name).not.toBe(entry.name);
      }
    }
  });

  it("consumes only events that some service publishes", () => {
    for (const entry of SERVICE_MANIFEST) {
      for (const event of entry.events.consumed) {
        expect(publishedEvents.has(event), `${entry.name} consumes ${event}`).toBe(true);
      }
    }
  });

  it("has operations-query-service read every published event, as its pharmacy.events binding does", () => {
    const reader = SERVICE_MANIFEST.find((entry) => entry.name === "operations-query-service");
    expect([...(reader?.events.consumed ?? [])].sort()).toEqual([...publishedEvents].sort());
  });
});
