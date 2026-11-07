import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentityEmployeeNames } from "./employee-names.ts";

const a = "00000000-0000-4000-8000-000000000003";
const b = "00000000-0000-4000-8000-000000000004";
const baseUrl = "http://identity.test";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("IdentityEmployeeNames", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names each distinct id once with the service secret, acting as the system", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "secret");
    const fetchImplementation = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(json(200, { id: a, displayName: "Dược sĩ A", roles: [], siteIds: [], isActive: true })),
    );
    const names = new IdentityEmployeeNames(baseUrl, fetchImplementation as unknown as typeof fetch);

    const named = await names.namesOf([a, a]);

    expect(named.get(a)).toBe("Dược sĩ A");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe(`${baseUrl}/internal/employees/${a}`);
    expect(init?.headers).toMatchObject({ "x-internal-service-secret": "secret", "x-actor-type": "system" });
  });

  it("leaves out an id identity-service does not know or cannot answer", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "secret");
    const fetchImplementation = vi.fn((url: string) =>
      url.endsWith(a) ? Promise.resolve(json(404, {})) : Promise.reject(new Error("down")),
    );
    const names = new IdentityEmployeeNames(baseUrl, fetchImplementation as unknown as typeof fetch);

    expect((await names.namesOf([a, b])).size).toBe(0);
  });

  it("caches a name until it expires, and asks again after a failure", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "secret");
    let clock = 0;
    const fetchImplementation = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(json(200, { displayName: "Dược sĩ A" }));
    const names = new IdentityEmployeeNames(baseUrl, fetchImplementation as unknown as typeof fetch, () => clock);

    expect((await names.namesOf([a])).size).toBe(0);
    expect((await names.namesOf([a])).get(a)).toBe("Dược sĩ A");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    await names.namesOf([a]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    clock = 6 * 60_000;
    await names.namesOf([a]);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });
});
