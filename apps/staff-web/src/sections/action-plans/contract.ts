import { z } from "zod";

/**
 * The action plan routes (design 0007, "Action plans") and the staff directory they name owners from. Field names match
 * the contract exactly. A row that does not match is not shown as a plan; the list says so instead of guessing.
 */

export const ACTION_PLANS_KEY = ["staff-action-plans"] as const;

export const ACTION_PLANS_PATH = "/api/inventory/action-plans";

export const STAFF_DIRECTORY_KEY = ["staff-directory"] as const;

export const STAFF_DIRECTORY_PATH = "/api/auth/staff-directory";

export const ACTION_PLAN_STATUSES = ["open", "in_progress", "done"] as const;
export type ActionPlanStatus = (typeof ACTION_PLAN_STATUSES)[number];

export const ACTION_PLAN_SOURCE_TYPES = ["replenishment", "expiry", "dead_stock", "price_warning"] as const;
export type ActionPlanSourceType = (typeof ACTION_PLAN_SOURCE_TYPES)[number];

export const isActionPlanStatus = (value: string): value is ActionPlanStatus =>
  (ACTION_PLAN_STATUSES as readonly string[]).includes(value);

const actionPlanSchema = z.object({
  id: z.string(),
  sourceType: z.enum(ACTION_PLAN_SOURCE_TYPES),
  sourceRef: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  siteId: z.string().nullable(),
  productId: z.string().nullable(),
  ownerId: z.string(),
  dueDate: z.string(),
  status: z.enum(ACTION_PLAN_STATUSES),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});

export type ActionPlan = z.infer<typeof actionPlanSchema>;

/** One list row as a plan, or `undefined` when the row does not match the contract. */
export const parseActionPlan = (value: unknown): ActionPlan | undefined => {
  const parsed = actionPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const staffEmployeeSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  roles: z.array(z.string()),
  siteIds: z.array(z.string()),
});

export type StaffEmployee = z.infer<typeof staffEmployeeSchema>;

const staffDirectorySchema = z.object({ employees: z.array(staffEmployeeSchema) });

/** Throws when the answer does not match the contract, so the screen shows an error instead of wrong owners. */
export const parseStaffDirectory = (value: unknown): StaffEmployee[] => {
  const parsed = staffDirectorySchema.safeParse(value);
  if (!parsed.success) throw new Error("Unexpected staff directory response.");
  return parsed.data.employees;
};

export const actionPlanPath = (id: string): string => `${ACTION_PLANS_PATH}/${encodeURIComponent(id)}`;
