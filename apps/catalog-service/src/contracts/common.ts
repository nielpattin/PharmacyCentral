import { z } from "zod";

export const apiVersionSchema = z.literal("v1");

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().min(1).optional(),
});

export const idempotencyKeySchema = z.string().trim().min(1).max(128);

export const requestHeadersSchema = z.object({
  requestId: z.string().min(1).max(128),
  correlationId: z.string().min(1).max(128),
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().optional(),
  requestId: z.string().optional(),
});

export const requestContextSchema = z.object({
  requestId: z.string().min(1),
  correlationId: z.string().min(1),
  actorId: z.string().uuid().optional(),
  actorType: z.enum(["anonymous", "customer", "employee", "system"]),
  roles: z.array(z.string()).default([]),
  siteIds: z.array(z.string().uuid()).default([]),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  audience: z.string().min(1),
});

export const eventMetadataSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  schemaVersion: z.string().regex(/^v[0-9]+$/),
  producer: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  correlationId: z.string().min(1),
  causationId: z.string().min(1).optional(),
  aggregateId: z.string().uuid().optional(),
});

export const eventEnvelopeSchema = z.object({
  metadata: eventMetadataSchema,
  payload: z.unknown(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type RequestHeaders = z.infer<typeof requestHeadersSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
export type RequestContext = z.infer<typeof requestContextSchema>;
export type EventMetadata = z.infer<typeof eventMetadataSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
