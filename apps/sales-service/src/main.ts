import express from "express";
import { createServer } from "node:http";

import { Redis } from "ioredis";
import { z } from "zod";

import { internalServiceHeaders } from "./internal-service-headers.ts";
import { createLogger } from "./logger.ts";
import { createTrustedRequestMiddleware, matchesPathPrefix } from "./middleware/trusted-request.ts";

import { DrizzleCredentialStore } from "./infrastructure/drizzle-credential-store.ts";
import { readAiProviderSettings } from "./infrastructure/ai-provider-config.ts";
import { SecretBox } from "./infrastructure/secret-box.ts";
import { DeliveryCalculator } from "./modules/delivery/domain/delivery-calculator.ts";
import { InMemoryDeliveryCache } from "./modules/delivery/infrastructure/in-memory-delivery-cache.ts";
import { OpenRouteServiceClient } from "./modules/delivery/infrastructure/open-route-service-client.ts";
import { RedisDeliveryCache } from "./modules/delivery/infrastructure/redis-delivery-cache.ts";
import { VietmapGeocoder } from "./modules/delivery/infrastructure/vietmap-geocoder.ts";
import { createDeliveryRouter } from "./modules/delivery/presentation/delivery-routes.ts";
import { OrderStock, OrderStockSweeper } from "./modules/orders/application/order-stock.ts";
import { InventoryReservations } from "./modules/orders/infrastructure/inventory-reservations.ts";
import { SalesOutboxPublisher } from "./modules/outbox-publisher.ts";
import { SalesPaymentEventConsumer } from "./modules/payment-event-consumer.ts";
import { createSalesRouter } from "./modules/sales-routes.ts";
import { SalesRepository } from "./modules/sales-repository.ts";
import { createAdapterSource } from "./modules/credentials/ai-adapters.ts";
import { AiCredentialVault } from "./modules/credentials/ai-credential-vault.ts";
import { createCredentialRouter } from "./modules/credentials/credential-routes.ts";
import { ConfiguredPrescriptionReader } from "./modules/prescriptions/infrastructure/configured-prescription-reader.ts";
import { GeminiPrescriptionReader } from "./modules/prescriptions/infrastructure/gemini-prescription-reader.ts";
import { PrescriptionConsultationRepository } from "./modules/prescriptions/infrastructure/prescription-consultation-repository.ts";
import { RedisIntakeRateLimiter } from "./modules/prescriptions/infrastructure/redis-intake-rate-limiter.ts";
import { createPrescriptionConsultationRouter } from "./modules/prescriptions/presentation/prescription-consultation-routes.ts";
import { createPrescriptionIntakeRouter } from "./modules/prescriptions/presentation/prescription-intake-routes.ts";
import { createSalesDatabase } from "./shared/infrastructure/database.ts";
import { createErrorHandler } from "./shared/presentation/error-handler.ts";

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
const portResult = z.coerce.number().int().min(1).max(65535).safeParse(requireEnv("PORT"));
if (!portResult.success) throw new Error("PORT must be an integer from 1 to 65535.");
const port = portResult.data;
const identitySecret = requireEnv("INTERNAL_IDENTITY_SECRET");
/**
 * Every URL this service calls out to is required at boot, so a missing one stops the service instead of sending
 * the request to a hard-coded localhost. The same goes for the shared secret of the outbound internal headers.
 */
const catalogServiceUrl = requireEnv("CATALOG_SERVICE_URL");
const inventoryServiceUrl = requireEnv("INVENTORY_SERVICE_URL");
const identityServiceUrl = requireEnv("IDENTITY_SERVICE_URL");
requireEnv("INTERNAL_SERVICE_SECRET");
const openRouteServiceKey = process.env.OPENROUTESERVICE_API_KEY;
const database = createSalesDatabase();
const salesRepository = database ? new SalesRepository(database) : undefined;
const rabbitmqUrl = requireEnv("RABBITMQ_URL");
const outboxPublisher = database ? new SalesOutboxPublisher(database, logger, rabbitmqUrl) : undefined;
outboxPublisher?.start();
const orderStock = salesRepository
  ? new OrderStock(salesRepository, new InventoryReservations(inventoryServiceUrl), logger)
  : undefined;
const orderStockSweeper = orderStock ? new OrderStockSweeper(orderStock, logger) : undefined;
orderStockSweeper?.start();
const paymentEventConsumer =
  salesRepository && orderStock
    ? new SalesPaymentEventConsumer(salesRepository, orderStock, logger, rabbitmqUrl)
    : undefined;
paymentEventConsumer?.start();
const redisClient = await createRedisClient();
const deliveryCache = redisClient ? new RedisDeliveryCache(redisClient) : new InMemoryDeliveryCache();
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
      freeDistanceMeters: Number.parseInt(requireEnv("DELIVERY_FREE_DISTANCE_METERS"), 10),
      baseFee: Number.parseInt(requireEnv("DELIVERY_FEE_BASE"), 10),
      perKilometer: Number.parseInt(requireEnv("DELIVERY_FEE_PER_KILOMETER"), 10),
      maxDistanceMeters: Number.parseInt(requireEnv("DELIVERY_MAX_DISTANCE_METERS"), 10),
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
    .json({ status: database ? "ok" : "degraded", service: serviceName, redis: Boolean(redisClient) }),
);
const lookupStore = async (
  storeId: string,
): Promise<{ id: string; latitude: number; longitude: number } | undefined> => {
  const configured = storeCoordinates.get(storeId);
  if (configured) return configured;
  try {
    const upstream = await fetch(`${catalogServiceUrl}/sites/${storeId}`, {
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

const environmentSettings = readAiProviderSettings("prescription-reader", process.env);
const vault = database
  ? new AiCredentialVault({
      store: new DrizzleCredentialStore(database),
      sealer: new SecretBox(requireEnv("SECRETS_ENCRYPTION_KEY")),
      purpose: "prescription-reader",
      fallback: environmentSettings,
      cacheMs: 60_000,
    })
  : undefined;
const prescriptionReader = new ConfiguredPrescriptionReader(
  createAdapterSource(async () => (vault ? vault.current() : undefined), {
    gemini: (settings) => new GeminiPrescriptionReader(settings),
  }),
);
const prescriptionIntakeLimiter = new RedisIntakeRateLimiter(redisClient);
const prescriptionConsultationRepository = database ? new PrescriptionConsultationRepository(database) : undefined;
app.use(createCredentialRouter({ vault, identitySecret, audience: serviceName }));
app.use(
  createPrescriptionIntakeRouter({
    reader: prescriptionReader,
    limiter: prescriptionIntakeLimiter,
    catalogServiceUrl,
  }),
);
// Mounted before `createSalesRouter`: its `GET /prescriptions/:id` would swallow `/prescriptions/consultations`.
app.use(createPrescriptionConsultationRouter(prescriptionConsultationRepository, { catalogServiceUrl }));
app.use(
  createSalesRouter(salesRepository, {
    catalogServiceUrl,
    inventoryServiceUrl,
    orderStock,
    identityServiceUrl,
    deliveryCalculator,
    lookupStore,
  }),
);
app.use(createDeliveryRouter(deliveryCalculator, lookupStore, addressGeocoder));
app.use((_request, response) => response.status(404).json({ title: "Not Found", status: 404 }));
app.use(createErrorHandler(logger));

const server = createServer(app);
const shutdown = (signal: string): void => {
  logger.info({ signal }, "shutting down");
  server.close((error) => {
    if (error) {
      logger.error({ error }, "shutdown failed");
      process.exitCode = 1;
    }
  });
  redisClient?.disconnect();
  void outboxPublisher?.close();
  orderStockSweeper?.close();
  void paymentEventConsumer?.close();
  void database?.pool.end();
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
server.listen(port, "0.0.0.0", () => logger.info({ port }, "listening"));

async function createRedisClient(): Promise<Redis | undefined> {
  const configuredUrl = process.env.REDIS_URL;
  if (!configuredUrl) return undefined;
  const client = new Redis(configuredUrl, { commandTimeout: 500, lazyConnect: true });
  client.on("error", (error: unknown) => logger.warn({ error }, "Redis client error"));
  try {
    await client.connect();
    return client;
  } catch (error) {
    client.disconnect();
    logger.warn({ error }, "Redis connection failed during sales startup");
    return undefined;
  }
}
