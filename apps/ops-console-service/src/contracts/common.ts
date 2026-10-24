import { z } from "zod";

export const internalIdentityContextSchema = z.object({
  version: z.literal("v1"),
  requestId: z.string().min(1).max(128),
  correlationId: z.string().min(1).max(128),
  actorId: z.string().uuid().optional(),
  actorType: z.enum(["customer", "employee", "system"]),
  roles: z.array(z.string()).max(32),
  siteIds: z.array(z.string().uuid()).max(500),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  audience: z.string().min(1).max(128),
});

export const signedInternalIdentityContextSchema = z.object({
  context: internalIdentityContextSchema,
  algorithm: z.literal("hmac-sha256"),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

export type InternalIdentityContext = z.infer<typeof internalIdentityContextSchema>;
export type SignedInternalIdentityContext = z.infer<typeof signedInternalIdentityContextSchema>;
