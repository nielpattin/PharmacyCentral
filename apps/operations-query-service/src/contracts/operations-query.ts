import { z } from "zod";

export const operationsQueryContractVersion = "v1" as const;

export const auditEventSchema = z.object({
  eventId: z.string().uuid(),
  actorId: z.string().uuid().optional(),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().uuid().optional(),
});

export const siteScopeQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const dashboardSummarySchema = z.object({
  totalSites: z.number().int().nonnegative(),
  activeSites: z.number().int().nonnegative(),
  totalProducts: z.number().int().nonnegative(),
  totalQuantityOnHand: z.number().nonnegative(),
  totalQuantityReserved: z.number().nonnegative(),
  pendingTransferCount: z.number().int().nonnegative(),
  openPrescriptionCount: z.number().int().nonnegative(),
  recentActivity: z.array(
    z.object({
      eventId: z.string().uuid(),
      eventType: z.string(),
      occurredAt: z.string().datetime({ offset: true }),
    }),
  ),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type SiteScopeQuery = z.infer<typeof siteScopeQuerySchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
