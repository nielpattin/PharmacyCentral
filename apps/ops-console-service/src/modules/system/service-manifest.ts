import type { ProbedServiceName } from "./probed-services.ts";

/**
 * What the System page says about each probed service. Hand-maintained from the code, and checked by tests:
 *
 * - `dependsOn` lists the services a service calls over HTTP, from its `*_SERVICE_URL` variables and its `fetch` calls.
 *   Message flow is not in it; it is in `events`.
 * - `events.published` is what the service writes to its outbox, and `events.consumed` what its queue is bound to.
 *   operations-query-service binds `#` on `pharmacy.events`, so it reads every published event.
 * - Route prefixes are not here: they come from the gateway route table, so they are not written twice.
 */
export type ServiceManifestEntry = {
  name: ProbedServiceName;
  description: string;
  port: number;
  /** The owned PostgreSQL database. Null for a service without one. */
  database: string | null;
  dependsOn: readonly ProbedServiceName[];
  events: { published: readonly string[]; consumed: readonly string[] };
};

const SALES_EVENTS = [
  "sales.order.created.v1",
  "sales.order.status-changed.v1",
  "sales.prescription.created.v1",
  "sales.prescription.dispensed.v1",
  "sales.prescription.cancelled.v1",
  "sales.prescription-consultation.requested.v1",
  "sales.prescription-consultation.answered.v1",
] as const;

const PAYMENT_EVENTS = [
  "payment.invoice.created.v1",
  "payment.invoice.paid.v1",
  "payment.invoice.refunded.v1",
] as const;

const AVAILABILITY_EVENTS = ["inventory.availability.changed.v1"] as const;
const INVENTORY_EVENTS = [...AVAILABILITY_EVENTS, "inventory.audit.v1"] as const;
const IDENTITY_EVENTS = ["identity.audit.v1"] as const;
const CATALOG_EVENTS = ["catalog.audit.v1"] as const;

export const SERVICE_MANIFEST: readonly ServiceManifestEntry[] = [
  {
    name: "identity-service",
    description: "Authentication, users, sessions, roles and Google sign-in.",
    port: 3001,
    database: "identity_service",
    dependsOn: [],
    events: { published: IDENTITY_EVENTS, consumed: [] },
  },
  {
    name: "catalog-service",
    description: "Products, units, sites, storage locations, suppliers, pricing and the product search index.",
    port: 3002,
    database: "catalog_service",
    dependsOn: [],
    events: { published: CATALOG_EVENTS, consumed: AVAILABILITY_EVENTS },
  },
  {
    name: "search-service",
    description: "Product list reads from Typesense, falling back to catalog-service when Typesense cannot answer.",
    port: 3009,
    database: null,
    dependsOn: ["catalog-service"],
    events: { published: [], consumed: [] },
  },
  {
    name: "inventory-service",
    description: "Stock, batches, movements, procurement, transfers, stocktakes and quality.",
    port: 3004,
    database: "inventory_service",
    dependsOn: ["catalog-service"],
    events: { published: INVENTORY_EVENTS, consumed: [] },
  },
  {
    name: "sales-service",
    description: "Carts, orders, counter sales, prescriptions and delivery calculation.",
    port: 3005,
    database: "sales_service",
    dependsOn: ["catalog-service", "identity-service", "inventory-service"],
    events: { published: SALES_EVENTS, consumed: ["payment.invoice.paid.v1", "payment.invoice.refunded.v1"] },
  },
  {
    name: "payment-service",
    description: "Invoices, payments and SePay webhook processing.",
    port: 3006,
    database: "payment_service",
    dependsOn: ["catalog-service", "sales-service"],
    events: { published: PAYMENT_EVENTS, consumed: [] },
  },
  {
    name: "chatbot-service",
    description: "Customer consultation assistant that answers from catalog lookups.",
    port: 3008,
    database: "chatbot_service",
    dependsOn: ["catalog-service"],
    events: { published: [], consumed: [] },
  },
  {
    name: "operations-query-service",
    description: "Read models for dashboards, finance and the audit log.",
    port: 3007,
    database: "operations_query_service",
    dependsOn: ["catalog-service", "inventory-service", "sales-service"],
    events: {
      published: [],
      consumed: [...IDENTITY_EVENTS, ...CATALOG_EVENTS, ...INVENTORY_EVENTS, ...SALES_EVENTS, ...PAYMENT_EVENTS],
    },
  },
];
