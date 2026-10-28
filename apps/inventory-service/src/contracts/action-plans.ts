import { z } from "zod";

/** The origin kinds a plan can be made from (design 0007). */
export const ACTION_PLAN_SOURCE_TYPES = ["replenishment", "expiry", "dead_stock", "price_warning"] as const;
export const ACTION_PLAN_STATUSES = ["open", "in_progress", "done"] as const;
/** The fields a `PATCH` may change, in the order the owner and the manager rules name them. */
export const ACTION_PLAN_PATCH_FIELDS = ["status", "ownerId", "dueDate", "title", "detail"] as const;

export type ActionPlanSourceType = (typeof ACTION_PLAN_SOURCE_TYPES)[number];
export type ActionPlanStatus = (typeof ACTION_PLAN_STATUSES)[number];
export type ActionPlanPatchField = (typeof ACTION_PLAN_PATCH_FIELDS)[number];

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

export const actionPlanSourceTypeSchema = z.enum(ACTION_PLAN_SOURCE_TYPES);
export const actionPlanStatusSchema = z.enum(ACTION_PLAN_STATUSES);

/** A calendar date as text; whether the date exists and lies in the future is decided by `action-plan.ts`. */
const dueDateSchema = z.string().regex(DATE_TEXT);

export const createActionPlanRequestSchema = z.object({
  sourceType: actionPlanSourceTypeSchema,
  sourceRef: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  detail: z.string().trim().max(2000).nullish(),
  siteId: z.string().uuid().nullish(),
  productId: z.string().uuid().nullish(),
  ownerId: z.string().uuid(),
  dueDate: dueDateSchema,
});

/** At least one field must be present; `detail: null` clears the note. */
export const updateActionPlanRequestSchema = z
  .object({
    status: actionPlanStatusSchema.optional(),
    ownerId: z.string().uuid().optional(),
    dueDate: dueDateSchema.optional(),
    title: z.string().trim().min(1).max(300).optional(),
    detail: z.string().trim().max(2000).nullish(),
  })
  .refine((body) => ACTION_PLAN_PATCH_FIELDS.some((field) => body[field] !== undefined), {
    message: "At least one field must be changed",
  });

/** A blank query value means the filter is absent, as the other lists read their optional filters. */
const blankAsAbsent = (value: unknown): unknown => (value === "" ? undefined : value);

export const actionPlanListQuerySchema = z.object({
  ownerId: z.preprocess(blankAsAbsent, z.string().uuid().optional()),
  status: z.preprocess(blankAsAbsent, actionPlanStatusSchema.optional()),
  sourceType: z.preprocess(blankAsAbsent, actionPlanSourceTypeSchema.optional()),
  siteId: z.preprocess(blankAsAbsent, z.string().uuid().optional()),
});

export type CreateActionPlanRequest = z.infer<typeof createActionPlanRequestSchema>;
export type UpdateActionPlanRequest = z.infer<typeof updateActionPlanRequestSchema>;
export type ActionPlanListQuery = z.infer<typeof actionPlanListQuerySchema>;
