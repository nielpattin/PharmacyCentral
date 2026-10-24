/**
 * The services the System page probes. main.ts reads each URL from its environment variable; the catalog and the tests
 * read the names, so a service is listed here once.
 */
export const PROBED_SERVICES = [
  {
    name: "identity-service",
    urlVariable: "IDENTITY_SERVICE_URL",
    healthPath: "/health/ready",
    livePath: "/health/live",
  },
  {
    name: "catalog-service",
    urlVariable: "CATALOG_SERVICE_URL",
    healthPath: "/health/ready",
    livePath: "/health/live",
  },
  {
    name: "search-service",
    urlVariable: "SEARCH_SERVICE_URL",
    healthPath: "/healthz",
    livePath: "/healthz",
  },
  {
    name: "inventory-service",
    urlVariable: "INVENTORY_SERVICE_URL",
    healthPath: "/health/ready",
    livePath: "/health/live",
  },
  {
    name: "sales-service",
    urlVariable: "SALES_SERVICE_URL",
    healthPath: "/health/ready",
    livePath: "/health/live",
  },
  {
    name: "payment-service",
    urlVariable: "PAYMENT_SERVICE_URL",
    healthPath: "/health/ready",
    livePath: "/health/live",
  },
  {
    name: "chatbot-service",
    urlVariable: "CHATBOT_SERVICE_URL",
    healthPath: "/health/ready",
    livePath: "/health/live",
  },
  {
    name: "operations-query-service",
    urlVariable: "OPERATIONS_QUERY_SERVICE_URL",
    healthPath: "/health/ready",
    livePath: "/health/live",
  },
] as const;

export type ProbedServiceName = (typeof PROBED_SERVICES)[number]["name"];
