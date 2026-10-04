import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { VietmapGeocoder } from "./vietmap-geocoder.ts";

const geocoder = new VietmapGeocoder({ baseUrl: "https://vietmap.test", apiKey: "secret-key" });

const answerWith = (payload: unknown, status = 200) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const requestedUrl = (fetchMock: Mock): URL => new URL(String(fetchMock.mock.calls[0]?.[0]));

describe("VietmapGeocoder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts the space back after the bare commas Vietmap joins a reverse-geocoded label with", async () => {
    answerWith([{ display: "166/60 Đoàn Văn Bơ Phường 15,Quận 4,Thành Phố Hồ Chí Minh" }]);

    await expect(geocoder.resolveAddress({ latitude: 10.7589, longitude: 106.7093 })).resolves.toBe(
      "166/60 Đoàn Văn Bơ Phường 15, Quận 4, Thành Phố Hồ Chí Minh",
    );
  });

  it("refuses a point Vietmap has no address for, so the caller keeps the last good label", async () => {
    answerWith([]);

    await expect(geocoder.resolveAddress({ latitude: 10.2, longitude: 107.9 })).rejects.toThrow(
      "Vietmap did not resolve the destination address",
    );
  });

  it("scopes a search to Ho Chi Minh City and drops predictions that would render as blank rows", async () => {
    const fetchMock = answerWith([
      { ref_id: "auto:1", display: "268 Tôn Đản, Phường Khánh Hội, Thành phố Hồ Chí Minh" },
      { ref_id: "auto:2", display: "  " },
      { ref_id: "", display: "No handle, Quận 4" },
    ]);

    await expect(geocoder.search("268 Tôn Đản")).resolves.toEqual([
      { refId: "auto:1", displayName: "268 Tôn Đản, Phường Khánh Hội, Thành phố Hồ Chí Minh" },
    ]);
    const url = requestedUrl(fetchMock);
    expect(url.searchParams.get("cityId")).toBe("12");
    expect(url.searchParams.get("layers")).toBe("ADDRESS");
    expect(url.searchParams.get("text")).toBe("268 Tôn Đản");
  });

  it("resolves a chosen prediction to the point the rider has to reach", async () => {
    answerWith({ display: "268 Tôn Đản,Phường Khánh Hội", lat: 10.7589, lng: 106.7093 });

    await expect(geocoder.resolvePrediction("auto:1")).resolves.toEqual({
      displayName: "268 Tôn Đản, Phường Khánh Hội",
      latitude: 10.7589,
      longitude: 106.7093,
    });
  });

  it("has no point for a prediction whose coordinates are missing", async () => {
    answerWith({ display: "268 Tôn Đản" });

    await expect(geocoder.resolvePrediction("auto:1")).resolves.toBeUndefined();
  });

  it("reports an upstream failure with its status so the caller can answer a bad gateway", async () => {
    answerWith({ message: "Your request is limited" }, 423);

    await expect(geocoder.search("Quang Trung")).rejects.toThrow("Vietmap lookup failed with status 423");
  });
});
