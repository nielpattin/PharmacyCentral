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
  /** `employee`: a staff sign-in, which refuses a customer account before any session is created. */
  audience: z.enum(["employee"]).optional(),
});

export const updateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^[0-9+()\s-]{8,20}$/, "Số điện thoại chỉ gồm chữ số và các ký tự + ( ) -")
    .nullable()
    .optional(),
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
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
