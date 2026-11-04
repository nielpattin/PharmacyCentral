import { afterEach, describe, expect, it, vi } from "vitest";
import { createCatalogStoreLookup } from "./catalog-store-lookup.ts";

const store = { id: "store-1", code: "SITE-RTL", name: "Cầu Giấy", address: null };

describe("catalog store lookup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the public store route and returns the store's coordinates", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      Response.json({ ...store, coordinates: { latitude: 21.04, longitude: 105.78 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const found = await createCatalogStoreLookup("http://catalog.test")("store-1");

    expect(found).toEqual({ id: "store-1", latitude: 21.04, longitude: 105.78 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://catalog.test/stores/store-1");
  });

  it("returns undefined for an unknown store, a store with no coordinates, or an unreachable catalog", async () => {
    const lookup = createCatalogStoreLookup("http://catalog.test");

    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    expect(await lookup("store-1")).toBeUndefined();

    vi.stubGlobal("fetch", async () => Response.json({ ...store, coordinates: null }));
    expect(await lookup("store-1")).toBeUndefined();

    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect(await lookup("store-1")).toBeUndefined();
  });
});
