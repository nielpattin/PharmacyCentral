import type { StatusTone } from "@pharmacy/ui";

import type { ActionPlan, ActionPlanSourceType, ActionPlanStatus } from "./contract.ts";

/** Days a new plan's due date is set ahead of today. */
export const DEFAULT_DUE_DAYS = 7;

/** A batch that expires within this many days from today is a plan candidate, as is one already expired. */
export const EXPIRY_WINDOW_DAYS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** A calendar date written YYYY-MM-DD that exists (2026-02-30 does not). */
export const isIsoDate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
};

/** Adds whole days to a YYYY-MM-DD date. Calendar arithmetic in UTC, so no time zone or daylight saving shifts it. */
export const addDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Today's calendar date in the browser's time zone, as YYYY-MM-DD. */
export const todayIsoDate = (now: Date = new Date()): string => {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
};

export const defaultDueDate = (today: string): string => addDays(today, DEFAULT_DUE_DAYS);

/** An open or in-progress plan whose due date is before today. A done plan is never overdue. */
export const isOverdue = (plan: Pick<ActionPlan, "status" | "dueDate">, today: string): boolean =>
  plan.status !== "done" && plan.dueDate < today;

export type ExpiryState = "expired" | "expiring" | "ok";

/** Whether a batch expiry date is past, within the window from today, or further away. */
export const expiryState = (expiryDate: string, today: string): ExpiryState => {
  if (expiryDate < today) return "expired";
  if (expiryDate <= addDays(today, EXPIRY_WINDOW_DAYS)) return "expiring";
  return "ok";
};

/** The English text of each source, translated where it is shown. */
export const SOURCE_LABELS: Record<ActionPlanSourceType, string> = {
  replenishment: "Replenishment suggestion",
  expiry: "Expiring batch",
  dead_stock: "Dead stock",
  price_warning: "Price warning",
};

/** The English text of each status, translated where it is shown. */
export const STATUS_LABELS: Record<ActionPlanStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
};

export const STATUS_TONES: Record<ActionPlanStatus, StatusTone> = {
  open: "info",
  in_progress: "warning",
  done: "success",
};
