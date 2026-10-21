import {
  recordDeliveryCacheLookup,
  recordDeliveryCalculation,
  type DeliveryCalculationOutcome,
} from "./delivery-metrics.ts";

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

/** The route from the selected store is too long to deliver, so the order has to be picked up instead. */
export class DeliveryOutOfRangeError extends Error {
  public constructor(
    public readonly distanceMeters: number,
    public readonly maxDistanceMeters: number,
  ) {
    super(`Delivery is limited to routes shorter than ${maxDistanceMeters} meters from the selected store`);
    this.name = "DeliveryOutOfRangeError";
  }
}

export class DeliveryCalculator {
  public constructor(
    private readonly router: RouteProvider,
    private readonly geocoder: AddressGeocoder,
    private readonly cache: DeliveryCache,
    private readonly pricing: {
      /** Routes shorter than this many meters are delivered for free. */
      freeDistanceMeters: number;
      /** Fee for a route that reaches the free distance but not one full kilometer beyond it. */
      baseFee: number;
      /** Added for every full kilometer beyond the free distance. */
      perKilometer: number;
      /** Only routes shorter than this many meters are delivered; anything at or past it is refused. */
      maxDistanceMeters: number;
      cacheTtlSeconds: number;
    },
  ) {}

  public async calculate(input: {
    store: StoreOrigin;
    destination: DeliveryPoint;
    addressNote?: string | undefined;
  }): Promise<DeliveryCalculation> {
    assertPoint(input.destination);
    const cacheKey = this.cacheKey(input.store, input.destination, input.addressNote);
    const startedAt = performance.now();
    let outcome: DeliveryCalculationOutcome = "ok";
    try {
      let cached: DeliveryCalculation | undefined;
      try {
        cached = await this.cache.get(cacheKey);
      } catch {
        cached = undefined;
      }
      recordDeliveryCacheLookup(cached ? "hit" : "miss");
      if (cached) return cached;

      const [providerResolvedAddress, route] = await Promise.all([
        this.geocoder.resolveAddress(input.destination),
        this.router.route(input.store, input.destination),
      ]).catch((error: unknown) => {
        outcome = "provider_error";
        throw error;
      });
      if (route.distanceMeters >= this.pricing.maxDistanceMeters) {
        outcome = "out_of_range";
        throw new DeliveryOutOfRangeError(route.distanceMeters, this.pricing.maxDistanceMeters);
      }
      const fee = this.priceRoute(route.distanceMeters);
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
    } finally {
      recordDeliveryCalculation(outcome, (performance.now() - startedAt) / 1000);
    }
  }

  private priceRoute(distanceMeters: number): number {
    const { freeDistanceMeters, baseFee, perKilometer } = this.pricing;
    if (distanceMeters < freeDistanceMeters) return 0;
    const extraKilometers = Math.floor((distanceMeters - freeDistanceMeters) / 1000);
    return baseFee + extraKilometers * perKilometer;
  }

  private cacheKey(store: StoreOrigin, destination: DeliveryPoint, addressNote: string | undefined): string {
    return [
      "sales",
      "delivery",
      "v6",
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
