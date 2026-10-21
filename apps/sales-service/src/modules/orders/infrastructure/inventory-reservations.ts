import { internalServiceHeaders } from "../../../internal-service-headers.ts";

/** The stock of the site cannot cover the order. */
export class InsufficientStockError extends Error {
  public constructor() {
    super("Insufficient stock");
  }
}

/** Inventory-service could not be reached, or refused a request that should have worked. */
export class InventoryRequestError extends Error {}

const REQUEST_TIMEOUT_MS = 5_000;

/**
 * The calls sales-service makes to hold, give back and hand over the stock of an online order. The order id is the
 * reservation id, so every call is safe to repeat: inventory answers a reservation that is no longer active as it
 * is, and a reservation it never saw as not found, which means nothing is held.
 */
export class InventoryReservations {
  public constructor(private readonly baseUrl: string) {}

  /** Holds the lines against the whole site of the store, earliest expiry first, or holds nothing at all. */
  public async reserve(reservationId: string, siteId: string, lines: Array<{ productId: string; quantity: number }>) {
    const response = await this.post("/inventory/reservations", { reservationId, sourceSiteId: siteId, lines });
    if (response.ok) return;
    const problem = (await response.json().catch(() => undefined)) as { code?: string } | undefined;
    if (response.status === 409 && problem?.code === "insufficient_stock") throw new InsufficientStockError();
    throw new InventoryRequestError(`Inventory refused the reservation with status ${response.status}`);
  }

  public async release(reservationId: string): Promise<void> {
    const response = await this.post(`/inventory/reservations/${reservationId}/release`);
    if (!response.ok && response.status !== 404)
      throw new InventoryRequestError(`Inventory refused the release with status ${response.status}`);
  }

  public async consume(reservationId: string, orderId: string): Promise<void> {
    const response = await this.post(`/inventory/reservations/${reservationId}/consume`, { orderId });
    if (!response.ok && response.status !== 404)
      throw new InventoryRequestError(`Inventory refused the hand over with status ${response.status}`);
  }

  private async post(path: string, body?: unknown): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...internalServiceHeaders() },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new InventoryRequestError("Inventory-service could not be reached", { cause: error });
    }
  }
}
