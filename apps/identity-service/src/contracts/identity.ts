import { z } from "zod";

export const identityContractVersion = "v1" as const;

export const accountCreatedEventSchema = z.object({
  accountId: z.string().uuid(),
  actorType: z.enum(["customer", "employee"]),
  email: z.string().email(),
});

export const registerRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(200),
  displayName: z.string().trim().min(1).max(200),
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  actorType: z.enum(["customer", "employee"]),
  email: z.string().email(),
  displayName: z.string(),
  roles: z.array(z.string()),
  siteIds: z.array(z.string().uuid()),
});

export type AccountCreatedEvent = z.infer<typeof accountCreatedEventSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
