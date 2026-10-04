import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AddressGeocoder, AddressSearch } from "../domain/delivery-calculator.ts";
import { createDeliveryRouter } from "./delivery-routes.ts";

const lookupStore = async (): Promise<undefined> => undefined;

const unused = () => {
  throw new Error("This test should not reach the provider");
};

const createAddresses = (
  overrides: Partial<AddressGeocoder & AddressSearch> = {},
): AddressGeocoder & AddressSearch => ({
  resolveAddress: unused,
  search: unused,
  resolvePrediction: unused,
  ...overrides,
});

describe("delivery address endpoints", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  const start = async (addresses: AddressGeocoder & AddressSearch): Promise<string> => {
    const app = express();
    app.use(express.json());
    app.use(createDeliveryRouter(undefined, lookupStore, addresses));
    server = createServer(app);
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
    return `http://127.0.0.1:${address.port}`;
  };

  const post = (url: string, body: unknown): Promise<Response> =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  describe("POST /delivery/reverse-geocode", () => {
    it("names the point the shopper dragged the pin to, without needing a store", async () => {
      const resolveAddress = vi.fn().mockResolvedValue("Hẻm 150 Nguyễn Trãi, Quận 1");
      const url = await start(createAddresses({ resolveAddress }));

      const response = await post(`${url}/delivery/reverse-geocode`, {
        destination: { latitude: 10.7806, longitude: 106.6991 },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        destination: { latitude: 10.7806, longitude: 106.6991 },
        providerResolvedAddress: "Hẻm 150 Nguyễn Trãi, Quận 1",
      });
      expect(resolveAddress).toHaveBeenCalledWith({ latitude: 10.7806, longitude: 106.6991 });
    });

    it("rejects a point outside the coordinate range instead of asking the provider", async () => {
      const resolveAddress = vi.fn();
      const url = await start(createAddresses({ resolveAddress }));

      const response = await post(`${url}/delivery/reverse-geocode`, {
        destination: { latitude: 10.7806, longitude: 999 },
      });

      expect(response.status).toBe(400);
      expect(resolveAddress).not.toHaveBeenCalled();
    });

    it("reports the provider failure as a bad gateway so the label can stay put", async () => {
      const url = await start(
        createAddresses({
          resolveAddress: async () => {
            throw new Error("Vietmap did not resolve the destination address");
          },
        }),
      );

      const response = await post(`${url}/delivery/reverse-geocode`, {
        destination: { latitude: 10.7806, longitude: 106.6991 },
      });

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({ code: "delivery_provider_failed" });
    });
  });

  describe("GET /delivery/addresses/search", () => {
    it("returns the suggestions for what the shopper typed", async () => {
      const search = vi.fn().mockResolvedValue([{ refId: "ref-1", displayName: "268 Tôn Đản, Quận 4" }]);
      const url = await start(createAddresses({ search }));

      const response = await fetch(`${url}/delivery/addresses/search?q=${encodeURIComponent("268 Tôn Đản")}`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        results: [{ refId: "ref-1", displayName: "268 Tôn Đản, Quận 4" }],
      });
      expect(search).toHaveBeenCalledWith("268 Tôn Đản");
    });

    it("does not spend a paid lookup on a prefix too short to mean anything", async () => {
      const search = vi.fn();
      const url = await start(createAddresses({ search }));

      const response = await fetch(`${url}/delivery/addresses/search?q=a`);

      expect(response.status).toBe(400);
      expect(search).not.toHaveBeenCalled();
    });

    it("reports a provider failure as a bad gateway", async () => {
      const url = await start(
        createAddresses({
          search: async () => {
            throw new Error("Vietmap lookup failed with status 423");
          },
        }),
      );

      const response = await fetch(`${url}/delivery/addresses/search?q=Quang%20Trung`);

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({ code: "address_search_failed" });
    });
  });

  describe("POST /delivery/addresses/resolve", () => {
    it("turns the chosen suggestion into the point the rider has to reach", async () => {
      const resolvePrediction = vi
        .fn()
        .mockResolvedValue({ displayName: "268 Tôn Đản, Quận 4", latitude: 10.7589, longitude: 106.7093 });
      const url = await start(createAddresses({ resolvePrediction }));

      const response = await post(`${url}/delivery/addresses/resolve`, { refId: "ref-1" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        refId: "ref-1",
        displayName: "268 Tôn Đản, Quận 4",
        destination: { latitude: 10.7589, longitude: 106.7093 },
      });
      expect(resolvePrediction).toHaveBeenCalledWith("ref-1");
    });

    it("answers 404 when the provider has no point for the handle", async () => {
      const url = await start(createAddresses({ resolvePrediction: async () => undefined }));

      const response = await post(`${url}/delivery/addresses/resolve`, { refId: "stale" });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: "address_not_found" });
    });

    it("rejects a request without a handle", async () => {
      const resolvePrediction = vi.fn();
      const url = await start(createAddresses({ resolvePrediction }));

      const response = await post(`${url}/delivery/addresses/resolve`, {});

      expect(response.status).toBe(400);
      expect(resolvePrediction).not.toHaveBeenCalled();
    });
  });
});
