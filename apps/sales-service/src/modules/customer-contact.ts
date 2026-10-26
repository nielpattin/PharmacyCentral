import { z } from "zod";

import { internalServiceHeaders } from "../internal-service-headers.ts";

export type CustomerContact = { id: string; displayName: string; phoneNumber: string | null };

/** identity-service could not answer a contact lookup. The caller fails closed rather than show an order without its customer. */
export class CustomerContactUnavailableError extends Error {
  constructor() {
    super("Customer contact lookup is unavailable");
    this.name = "CustomerContactUnavailableError";
  }
}

/** identity-service accepts at most this many ids per `POST /internal/customers/batch`. */
const BATCH_LIMIT = 200;

const batchResponseSchema = z.object({
  customers: z.array(
    z.object({
      id: z.string().uuid(),
      displayName: z.string(),
      phoneNumber: z.string().nullable(),
    }),
  ),
});

/**
 * The name and phone of the shoppers behind a page of orders, read from identity-service. The caller decides who may
 * see them (Pharmacist, Pharmacy Manager, Platform Admin, at their sites); identity answers only the system actor.
 * Ids that are not active customer accounts are absent from the result.
 */
export const lookupCustomerContacts = async (
  customerIds: readonly string[],
  baseUrl: string | undefined,
): Promise<Map<string, CustomerContact>> => {
  const contacts = new Map<string, CustomerContact>();
  const unique = [...new Set(customerIds)];
  if (unique.length === 0) return contacts;
  if (!baseUrl) throw new CustomerContactUnavailableError();
  for (let start = 0; start < unique.length; start += BATCH_LIMIT) {
    const chunk = unique.slice(start, start + BATCH_LIMIT);
    let body: unknown;
    try {
      const response = await fetch(`${baseUrl}/internal/customers/batch`, {
        method: "POST",
        headers: { "content-type": "application/json", ...internalServiceHeaders() },
        body: JSON.stringify({ ids: chunk }),
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) throw new CustomerContactUnavailableError();
      body = await response.json();
    } catch {
      throw new CustomerContactUnavailableError();
    }
    const parsed = batchResponseSchema.safeParse(body);
    if (!parsed.success) throw new CustomerContactUnavailableError();
    for (const customer of parsed.data.customers) contacts.set(customer.id, customer);
  }
  return contacts;
};
