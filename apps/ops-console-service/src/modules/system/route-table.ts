import type { RouteRow } from "../../contracts/system.ts";

/**
 * Every `/api` path the gateway forwards, with the service that owns it and who may call it. Rows follow gateway order:
 * the exact product list comes before its prefix, and a credential path comes after the prefix it sits under.
 *
 * The container cannot read deploy/ at runtime, so this is a constant. route-table.test.ts fails when it disagrees with
 * deploy/local/gateway/routes.conf or the ALB path rules in deploy/aws/main.tf. Access summarises what each owning
 * service enforces on the caller's access token; the service's trusted-request middleware is the authority.
 */

// Every staff role that the owning service lets through on a route with no role of its own. Platform Admin reads every staff
// route and writes only on the paths marked platform-admin, so it is not listed.
const STAFF_ROLES = ["Pharmacy Manager", "Pharmacist", "Warehouse Staff"];

export const ROUTE_TABLE: readonly RouteRow[] = [
  {
    path: "/api/auth*",
    service: "identity-service",
    access: { kind: "signed-in" },
    note: "Login, registration, email verification, setup status and Google sign-in are public.",
  },
  { path: "/api/admin*", service: "identity-service", access: { kind: "platform-admin" } },
  { path: "/api/customers*", service: "identity-service", access: { kind: "roles", roles: ["Pharmacist"] } },
  {
    path: "/api/products",
    method: "GET",
    service: "search-service",
    access: { kind: "public" },
    note: "The product list. Other methods on this path go to catalog-service.",
  },
  {
    path: "/api/products*",
    service: "catalog-service",
    access: { kind: "public" },
    note: "Writes need the Pharmacy Manager role.",
  },
  {
    path: "/api/products/search-credential",
    service: "catalog-service",
    access: { kind: "platform-admin" },
  },
  {
    path: "/api/sites*",
    service: "catalog-service",
    access: { kind: "roles", roles: STAFF_ROLES },
    note: "Reads are staff reads. Writes need Platform Admin.",
  },
  {
    path: "/api/storage-locations*",
    service: "catalog-service",
    access: { kind: "roles", roles: STAFF_ROLES },
    note: "Reads are staff reads. Writes need Platform Admin.",
  },
  {
    path: "/api/suppliers*",
    service: "catalog-service",
    access: { kind: "roles", roles: STAFF_ROLES },
    note: "Reads are staff reads. Writes need Platform Admin.",
  },
  {
    path: "/api/pricing*",
    service: "catalog-service",
    access: { kind: "public" },
    note: "Active prices and the Published price list are public. Other price reads are staff reads; writes need the Pharmacy Manager role.",
  },
  { path: "/api/stores*", service: "catalog-service", access: { kind: "public" } },
  { path: "/api/availability*", service: "catalog-service", access: { kind: "public" } },
  {
    path: "/api/procurement*",
    service: "inventory-service",
    access: { kind: "roles", roles: ["Pharmacy Manager", "Warehouse Staff"] },
    note: "Purchase order writes need the Pharmacy Manager role. Goods receipts need Warehouse Staff.",
  },
  {
    path: "/api/inventory*",
    service: "inventory-service",
    access: { kind: "roles", roles: STAFF_ROLES },
    note: "Balances are read by every employee. Warehouse Staff act on stock; Pharmacy Manager approves and reads; Pharmacist reads batches and its replenishment requests.",
  },
  {
    path: "/api/carts*",
    service: "sales-service",
    access: { kind: "signed-in" },
    note: "A signed-out cart stays in the browser. Carts need a sign-in.",
  },
  {
    path: "/api/orders*",
    service: "sales-service",
    access: { kind: "signed-in" },
    note: "Shoppers read and withdraw their own orders. Staff read the orders at their sites and move them: Pharmacist and Pharmacy Manager.",
  },
  {
    path: "/api/delivery*",
    service: "sales-service",
    access: { kind: "signed-in" },
    note: "Delivery fee estimates, reverse geocoding and address lookup are public.",
  },
  {
    path: "/api/prescriptions*",
    service: "sales-service",
    access: { kind: "roles", roles: ["Pharmacist", "Pharmacy Manager"] },
    note: "Shoppers can upload their own prescriptions and request consultations.",
  },
  {
    path: "/api/prescriptions/intake-credential",
    service: "sales-service",
    access: { kind: "platform-admin" },
  },
  {
    path: "/api/counter-transactions*",
    service: "sales-service",
    access: { kind: "roles", roles: ["Pharmacist", "Pharmacy Manager"] },
  },
  {
    path: "/api/sales-targets*",
    service: "sales-service",
    access: { kind: "roles", roles: ["Pharmacy Manager"] },
    note: "A Pharmacy Manager sets a site's monthly goal; Platform Admin reads the report but writes nothing.",
  },
  {
    path: "/api/payments*",
    service: "payment-service",
    access: { kind: "roles", roles: ["Pharmacist", "Pharmacy Manager"] },
    note: "Shoppers can create and read their own invoices. The SePay webhook is public and HMAC-verified.",
  },
  {
    path: "/api/chatbot*",
    service: "chatbot-service",
    access: { kind: "signed-in" },
  },
  {
    path: "/api/chatbot/credential",
    service: "chatbot-service",
    access: { kind: "platform-admin" },
  },
  {
    path: "/api/chatbot/intent-gate-credential",
    service: "chatbot-service",
    access: { kind: "platform-admin" },
  },
  {
    path: "/api/operations*",
    service: "operations-query-service",
    access: { kind: "roles", roles: ["Pharmacy Manager", "Warehouse Staff"] },
    note: "Dashboard reads are Pharmacy Manager and Warehouse Staff. The finance read is Pharmacy Manager; the audit read is Platform Admin.",
  },
  {
    path: "/api/dashboard*",
    service: "operations-query-service",
    access: { kind: "roles", roles: ["Pharmacy Manager", "Warehouse Staff"] },
  },
  {
    path: "/api/finance*",
    service: "operations-query-service",
    access: { kind: "roles", roles: ["Pharmacy Manager"] },
  },
  { path: "/api/audit*", service: "operations-query-service", access: { kind: "platform-admin" } },
  { path: "/api/system*", service: "ops-console-service", access: { kind: "platform-admin" } },
];
