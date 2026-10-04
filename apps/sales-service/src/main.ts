import express from "express";
import { createServer } from "node:http";

import type { GlideClient } from "@valkey/valkey-glide";

import { internalServiceHeaders } from "./internal-service-headers.ts";
import { createLogger } from "./logger.ts";
import { createTrustedRequestMiddleware, matchesPathPrefix } from "./middleware/trusted-request.ts";

import { DeliveryCalculator } from "./modules/delivery/domain/delivery-calculator.ts";
import { InMemoryDeliveryCache } from "./modules/delivery/infrastructure/in-memory-delivery-cache.ts";
import { OpenRouteServiceClient } from "./modules/delivery/infrastructure/open-route-service-client.ts";
import { VietmapGeocoder } from "./modules/delivery/infrastructure/vietmap-geocoder.ts";
import { createDeliveryRouter } from "./modules/delivery/presentation/delivery-routes.ts";
import { SalesOutboxPublisher } from "./modules/outbox-publisher.ts";
import { SalesPaymentEventConsumer } from "./modules/payment-event-consumer.ts";
import { createSalesRouter } from "./modules/sales-routes.ts";
import { SalesRepository } from "./modules/sales-repository.ts";
import { createSalesDatabase } from "./shared/infrastructure/database.ts";

const serviceName = "sales-service";
const logger = createLogger({ name: serviceName });
const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Please set it in your .env file.`);
  }
  return value;
};
const app = express();
const port = Number.parseInt(requireEnv("PORT"), 10);
const openRouteServiceKey = process.env.OPENROUTESERVICE_API_KEY;
const database = createSalesDatabase();
const salesRepository = database ? new SalesRepository(database) : undefined;
const outboxPublisher = database ? new SalesOutboxPublisher(database) : undefined;
if (outboxPublisher)
  await outboxPublisher.start().catch((error: unknown) => logger.warn({ error }, "sales outbox publisher unavailable"));
const paymentEventConsumer = salesRepository ? new SalesPaymentEventConsumer(salesRepository) : undefined;
if (paymentEventConsumer)
  await paymentEventConsumer
    .start()
    .catch((error: unknown) => logger.warn({ error }, "sales payment consumer unavailable"));
const valkeyClient = await createValkeyClient();
const deliveryCache = valkeyClient ? await createValkeyDeliveryCache(valkeyClient) : new InMemoryDeliveryCache();
/**
 * Two providers with two jobs. OpenRouteService prices the route and can only answer in the language its own
 * data happens to hold; Vietmap names the point, and is the one Vietnamese address source that keeps house
 * numbers. OpenStreetMap cannot do this job: `addr:housenumber` is optional there, nobody in Vietnam enters it,
 * and "268 Tôn Đản, Quận 4" returns nothing at all. A rider needs "268 Tôn Đản" to find the door, not just the
 * street it stands on.
 */
const addressGeocoder = new VietmapGeocoder({
  baseUrl: requireEnv("VIETMAP_BASE_URL"),
  apiKey: requireEnv("VIETMAP_API_KEY"),
});
const routeProvider = openRouteServiceKey
  ? new OpenRouteServiceClient({ apiKey: openRouteServiceKey, baseUrl: process.env.OPENROUTESERVICE_BASE_URL })
  : undefined;
const deliveryCalculator = routeProvider
  ? new DeliveryCalculator(routeProvider, addressGeocoder, deliveryCache, {
      perKilometer: Number.parseInt(requireEnv("DELIVERY_FEE_PER_KILOMETER"), 10),
      minimumFee: Number.parseInt(requireEnv("DELIVERY_FEE_MINIMUM"), 10),
      maximumFee: Number.parseInt(requireEnv("DELIVERY_FEE_MAXIMUM"), 10),
      cacheTtlSeconds: 300,
    })
  : undefined;
const storeCoordinates = new Map<string, { id: string; latitude: number; longitude: number }>();
try {
  const configuredStores = JSON.parse(process.env.RETAIL_STORE_COORDINATES_JSON ?? "[]") as Array<{
    id: string;
    latitude: number;
    longitude: number;
  }>;
  for (const store of configuredStores) storeCoordinates.set(store.id, store);
} catch {
  logger.warn("invalid RETAIL_STORE_COORDINATES_JSON");
}
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
// Guest carts and delivery estimates are public. Customer orders and staff routes require signed identity context.
app.use(
  createTrustedRequestMiddleware({
    expectedAudience: serviceName,
    isPublic: (request) =>
      (matchesPathPrefix(request.path, "/carts") && !matchesPathPrefix(request.path, "/carts/merge")) ||
      matchesPathPrefix(request.path, "/delivery/calculate") ||
      matchesPathPrefix(request.path, "/delivery/reverse-geocode") ||
      matchesPathPrefix(request.path, "/delivery/addresses/search") ||
      matchesPathPrefix(request.path, "/delivery/addresses/resolve"),
  }),
);
app.get("/health/live", (_request, response) => response.json({ status: "ok", service: serviceName }));
app.get("/health/ready", (_request, response) =>
  response
    .status(database ? 200 : 503)
    .json({ status: database ? "ok" : "degraded", service: serviceName, valkey: Boolean(valkeyClient) }),
);
const lookupStore = async (
  storeId: string,
): Promise<{ id: string; latitude: number; longitude: number } | undefined> => {
  const configured = storeCoordinates.get(storeId);
  if (configured) return configured;
  const catalogUrl = process.env.CATALOG_SERVICE_URL;
  if (!catalogUrl) return undefined;
  try {
    const upstream = await fetch(`${catalogUrl}/sites/${storeId}`, {
      headers: internalServiceHeaders(),
      signal: AbortSignal.timeout(2_000),
    });
    if (!upstream.ok) return undefined;
    const site = (await upstream.json()) as { id: string; location?: { x: number; y: number } | null };
    return site.location ? { id: site.id, longitude: site.location.x, latitude: site.location.y } : undefined;
  } catch {
    return undefined;
  }
};
app.use(
  createSalesRouter(salesRepository, {
    catalogServiceUrl: requireEnv("CATALOG_SERVICE_URL"),
    inventoryServiceUrl: requireEnv("INVENTORY_SERVICE_URL"),
    deliveryCalculator,
    lookupStore,
  }),
);
app.use(createDeliveryRouter(deliveryCalculator, lookupStore, addressGeocoder));
app.use((_request, response) => response.status(404).json({ title: "Not Found", status: 404 }));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logger.error({ error }, "unhandled request error");
  response.status(500).json({ title: "Internal Server Error", status: 500 });
});

const server = createServer(app);
const shutdown = (signal: string): void => {
  logger.info({ signal }, "shutting down");
  server.close((error) => {
    if (error) {
      logger.error({ error }, "shutdown failed");
      process.exitCode = 1;
    }
  });
  valkeyClient?.close();
  void outboxPublisher?.close();
  void paymentEventConsumer?.close();
  void database?.pool.end();
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
server.listen(port, "0.0.0.0", () => logger.info({ port }, "listening"));

async function createValkeyClient(): Promise<GlideClient | undefined> {
  const configuredUrl = process.env.VALKEY_URL;
  if (!configuredUrl) return undefined;
  const url = new URL(configuredUrl);
  try {
    const { GlideClient: NativeGlideClient } = await import("@valkey/valkey-glide");
    return await NativeGlideClient.createClient({
      addresses: [{ host: url.hostname, port: Number(url.port || 6379) }],
      requestTimeout: 500,
    });
  } catch (error) {
    logger.warn({ error }, "Valkey connection failed during sales startup");
    return undefined;
  }
}

async function createValkeyDeliveryCache(client: GlideClient) {
  const { ValkeyDeliveryCache } = await import("./modules/delivery/infrastructure/valkey-delivery-cache.ts");
  return new ValkeyDeliveryCache(client);
}
