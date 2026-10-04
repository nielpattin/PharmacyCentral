import type {
  AddressGeocoder,
  AddressPrediction,
  AddressSearch,
  DeliveryPoint,
  ResolvedAddress,
} from "../domain/delivery-calculator.ts";

/**
 * Names and finds Vietnamese addresses with Vietmap, which is built for this country rather than for the world.
 *
 * OpenStreetMap is missing something delivery cannot do without: house numbers. `addr:housenumber` is an optional
 * OSM tag, so in Vietnam almost nobody enters one, and "268 Tôn Đản, Quận 4" returns nothing at all. Vietmap
 * carries 18 million Vietnamese addresses with the number as a first-class field, so a shopper's own front door
 * survives the round trip instead of degrading to a street name.
 *
 * The service key never leaves the server: this class is the only thing that reads VIETMAP_API_KEY, and the
 * browser reaches these calls through the delivery router. Vietmap's autocompleter is a paid API, so every call
 * here is one a shopper explicitly typed, and the caller debounces their keystrokes.
 */

type VietmapOptions = { baseUrl: string; apiKey: string };

/**
 * Vietmap does not ship a usable default scope: without a city a search for "Quang Trung" returns Thanh Hoa and
 * Khanh Hoa before Ho Chi Minh City, and the shopper has to scroll past other provinces to reach their street.
 */
const VIETMAP_CITY_HCMC = 12;

const REQUEST_TIMEOUT_MS = 8_000;

/** A prediction whose address Vietmap returned as an empty string would render as a blank row. */
const hasText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/**
 * Vietmap joins the parts of an address with a bare comma ("Phường Võ Thị Sáu,Quận 3"), so wherever the label is
 * shown a reader sees two parts run together. Putting the space back is the only change: the wording and the
 * house number stay exactly as Vietmap wrote them.
 */
const tidyLabel = (value: string): string =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(", ");

export class VietmapGeocoder implements AddressGeocoder, AddressSearch {
  public constructor(private readonly options: VietmapOptions) {}

  /**
   * Suggests addresses as the shopper types. Only `ADDRESS` is asked for, so a search for a street name returns
   * buildings on it rather than every pharmacy and ATM in the district competing for the same list.
   */
  public async search(text: string): Promise<AddressPrediction[]> {
    const url = new URL("/api/autocomplete/v4", this.options.baseUrl);
    url.searchParams.set("apikey", this.options.apiKey);
    url.searchParams.set("text", text);
    // 1 is the two-level administrative model Vietnam has used since the 1 July 2025 merger.
    url.searchParams.set("display_type", "1");
    url.searchParams.set("layers", "ADDRESS");
    url.searchParams.set("cityId", String(VIETMAP_CITY_HCMC));

    const rows = await this.getJson(url);
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      const record = row as { ref_id?: unknown; display?: unknown };
      return hasText(record.ref_id) && hasText(record.display)
        ? [{ refId: record.ref_id, displayName: tidyLabel(record.display) }]
        : [];
    });
  }

  /**
   * Turns the prediction the shopper picked into a coordinate. Autocomplete answers with a label and a handle
   * only; the handle is what Place v4 accepts, and Place v4 is what returns `hs_num`, `street`, `lat` and `lng`
   * as separate fields rather than one string this service would have to take apart.
   */
  public async resolvePrediction(refId: string): Promise<ResolvedAddress | undefined> {
    const url = new URL("/api/place/v4", this.options.baseUrl);
    url.searchParams.set("apikey", this.options.apiKey);
    url.searchParams.set("refid", refId);

    const payload = await this.getJson(url);
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as { display?: unknown; lat?: unknown; lng?: unknown };
    if (!hasText(record.display) || typeof record.lat !== "number" || typeof record.lng !== "number") return undefined;
    return { displayName: tidyLabel(record.display), latitude: record.lat, longitude: record.lng };
  }

  /**
   * Names a point the pin was dragged to. A dragged pin has no text of its own, so the label under the map can
   * only stay truthful by asking a geocoder where the pin actually is.
   */
  public async resolveAddress(point: DeliveryPoint): Promise<string> {
    const url = new URL("/api/reverse/v3", this.options.baseUrl);
    url.searchParams.set("apiKey", this.options.apiKey);
    url.searchParams.set("lat", String(point.latitude));
    url.searchParams.set("lng", String(point.longitude));

    const rows = await this.getJson(url);
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("Vietmap did not resolve the destination address");
    const first = rows[0] as { display?: unknown };
    // Vietmap answers 200 with an empty list when the point is in the sea or on no mapped address.
    if (!hasText(first.display)) throw new Error("Vietmap did not resolve the destination address");
    return tidyLabel(first.display);
  }

  private async getJson(url: URL): Promise<unknown> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Vietmap lookup failed with status ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  }
}
