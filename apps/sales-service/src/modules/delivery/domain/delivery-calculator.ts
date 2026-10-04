export type DeliveryPoint = { latitude: number; longitude: number };
export type StoreOrigin = { id: string; latitude: number; longitude: number };
export type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: "LineString"; coordinates: Array<[number, number]> };
};

/**
 * Naming a point and pricing a route are separate jobs, and they are served by separate providers.
 *
 * OpenRouteService prices the route but names places in whatever language its own data holds, which for Ho Chi
 * Minh City means "Le Loi Street" where a Vietnamese reader looks for "Lê Lợi". Vietmap names the point and
 * finds addresses, so the label a rider reads never comes from the router.
 */
export type AddressGeocoder = {
  resolveAddress: (point: DeliveryPoint) => Promise<string>;
};

export type RouteProvider = {
  route: (origin: StoreOrigin, destination: DeliveryPoint) => Promise<RouteResult>;
};

/** A prediction before the shopper picks one. */
export type AddressPrediction = {
  /** Opaque handle the provider issues for this prediction; resolving it yields coordinates. */
  refId: string;
  /** The address as it should be shown in the suggestion list. */
  displayName: string;
};

/** A prediction the shopper chose, resolved to the point the rider has to reach. */
export type ResolvedAddress = {
  displayName: string;
  latitude: number;
  longitude: number;
};

export type AddressSearch = {
  search: (text: string) => Promise<AddressPrediction[]>;
  resolvePrediction: (refId: string) => Promise<ResolvedAddress | undefined>;
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
    private readonly router: RouteProvider,
    private readonly geocoder: AddressGeocoder,
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
      this.geocoder.resolveAddress(input.destination),
      this.router.route(input.store, input.destination),
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
      "v2",
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
