import type { DeliveryPoint, DeliveryProvider, RouteResult, StoreOrigin } from "../domain/delivery-calculator.ts";

export class OpenRouteServiceClient implements DeliveryProvider {
  public constructor(
    private readonly options: { apiKey: string; baseUrl?: string | undefined; timeoutMs?: number | undefined },
  ) {}

  public async resolveAddress(point: DeliveryPoint): Promise<string> {
    const url = new URL("/geocode/reverse", this.options.baseUrl ?? "https://api.openrouteservice.org");
    url.searchParams.set("point.lon", String(point.longitude));
    url.searchParams.set("point.lat", String(point.latitude));
    url.searchParams.set("size", "1");
    const payload = await this.request<{ features?: Array<{ properties?: { label?: string } }> }>(url, {
      method: "GET",
    });
    const label = payload.features?.[0]?.properties?.label;
    if (!label) throw new Error("OpenRouteService did not resolve the destination address");
    return label;
  }

  public async route(origin: StoreOrigin, destination: DeliveryPoint): Promise<RouteResult> {
    const directionsUrl = new URL(
      "/v2/directions/driving-car/geojson",
      this.options.baseUrl ?? "https://api.openrouteservice.org",
    );
    const matrixUrl = new URL("/v2/matrix/driving-car", this.options.baseUrl ?? "https://api.openrouteservice.org");
    const coordinates = [
      [origin.longitude, origin.latitude],
      [destination.longitude, destination.latitude],
    ] as const;
    const [directions, matrix] = await Promise.all([
      this.request<{
        features?: Array<{
          geometry?: RouteResult["geometry"];
          properties?: { segments?: Array<{ distance?: number; duration?: number }> };
        }>;
      }>(directionsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coordinates }),
      }),
      this.request<{ distances?: Array<Array<number | null>>; durations?: Array<Array<number | null>> }>(matrixUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locations: coordinates,
          sources: [0],
          destinations: [1],
          metrics: ["distance", "duration"],
        }),
      }),
    ]);
    const feature = directions.features?.[0];
    const segment = feature?.properties?.segments?.[0];
    const matrixDistance = matrix.distances?.[0]?.[0];
    const matrixDuration = matrix.durations?.[0]?.[0];
    if (!feature?.geometry || segment?.distance === undefined || segment.duration === undefined)
      throw new Error("OpenRouteService did not return a route");
    return {
      distanceMeters:
        typeof matrixDistance === "number" && Number.isFinite(matrixDistance) ? matrixDistance : segment.distance,
      durationSeconds:
        typeof matrixDuration === "number" && Number.isFinite(matrixDuration) ? matrixDuration : segment.duration,
      geometry: feature.geometry,
    };
  }

  private async request<T>(url: URL, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", this.options.apiKey);
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
      headers,
    });
    if (!response.ok) throw new Error(`OpenRouteService request failed with status ${response.status}`);
    return (await response.json()) as T;
  }
}
