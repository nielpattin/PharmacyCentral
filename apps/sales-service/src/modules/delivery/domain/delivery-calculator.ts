export type DeliveryPoint = { latitude: number; longitude: number };
export type StoreOrigin = { id: string; latitude: number; longitude: number };
export type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: "LineString"; coordinates: Array<[number, number]> };
};

export type DeliveryProvider = {
  resolveAddress: (point: DeliveryPoint) => Promise<string>;
  route: (origin: StoreOrigin, destination: DeliveryPoint) => Promise<RouteResult>;
};

export type DeliveryCache = {
  get: (key: string) => Promise<DeliveryCalculation | undefined>;
  set: (key: string, value: DeliveryCalculation, ttlSeconds: number) => Promise<void>;
};

export type DeliveryCalculation = {
  selectedStoreId: string;
  origin: StoreOrigin;
  destination: DeliveryPoint;
  providerResolvedAddress: string;
  addressNote: string | null;
  distanceMeters: number;
  durationSeconds: number;
  fee: number;
  currency: "VND";
  route: RouteResult["geometry"];
};

export class DeliveryCalculator {
  public constructor(
    private readonly provider: DeliveryProvider,
    private readonly cache: DeliveryCache,
    private readonly pricing: { perKilometer: number; minimumFee: number; maximumFee: number; cacheTtlSeconds: number },
  ) {}

  public async calculate(input: {
    store: StoreOrigin;
    destination: DeliveryPoint;
    addressNote?: string | undefined;
  }): Promise<DeliveryCalculation> {
    assertPoint(input.destination);
    const cacheKey = this.cacheKey(input.store, input.destination, input.addressNote);
    let cached: DeliveryCalculation | undefined;
    try {
      cached = await this.cache.get(cacheKey);
    } catch {
      cached = undefined;
    }
    if (cached) return cached;

    const [providerResolvedAddress, route] = await Promise.all([
      this.provider.resolveAddress(input.destination),
      this.provider.route(input.store, input.destination),
    ]);
    const rawFee = (route.distanceMeters / 1000) * this.pricing.perKilometer;
    const fee = Math.min(this.pricing.maximumFee, Math.max(this.pricing.minimumFee, Math.round(rawFee)));
    const calculation: DeliveryCalculation = {
      selectedStoreId: input.store.id,
      origin: input.store,
      destination: input.destination,
      providerResolvedAddress,
      addressNote: input.addressNote?.trim() || null,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      fee,
      currency: "VND",
      route: route.geometry,
    };
    try {
      await this.cache.set(cacheKey, calculation, this.pricing.cacheTtlSeconds);
    } catch {
      // Provider output remains usable when the optional distributed cache is unavailable.
    }
    return calculation;
  }

  private cacheKey(store: StoreOrigin, destination: DeliveryPoint, addressNote: string | undefined): string {
    return [
      "sales",
      "delivery",
      "v1",
      store.id,
      destination.longitude.toFixed(6),
      destination.latitude.toFixed(6),
      addressNote?.trim() ?? "",
    ].join(":");
  }
}

export const assertPoint = (point: DeliveryPoint): void => {
  if (
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    point.longitude < -180 ||
    point.longitude > 180
  ) {
    throw new Error("Invalid delivery coordinates");
  }
};
