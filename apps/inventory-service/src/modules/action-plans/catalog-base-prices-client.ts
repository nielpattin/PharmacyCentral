import { z } from "zod";

import { internalServiceHeaders } from "../../internal-service-headers.ts";

import type { ListedProduct } from "./auto-plan-alerts.ts";

/** `GET /pricing/base-prices` of catalog-service: one row per active product, `unitPrice` null when none qualifies. */
const basePricesSchema = z.array(
  z.object({ productId: z.string().uuid(), productName: z.string(), unitPrice: z.number().nullable() }),
);

/** The catalog could not answer. The run is dropped and retried whole, so no plan is titled from a guess. */
export class CatalogUnavailableError extends Error {
  public constructor() {
    super("Catalog base prices are unavailable");
    this.name = "CatalogUnavailableError";
  }
}

/** Reads the product names and today's base prices from catalog-service with the service secret. */
export class CatalogBasePriceClient {
  private readonly baseUrl: string;

  public constructor(
    baseUrl: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, "");
  }

  public async listProducts(): Promise<ListedProduct[]> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/pricing/base-prices`, {
        headers: { accept: "application/json", ...internalServiceHeaders() },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new CatalogUnavailableError();
    }
    if (!response.ok) throw new CatalogUnavailableError();
    const parsed = basePricesSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new CatalogUnavailableError();
    return parsed.data;
  }
}
