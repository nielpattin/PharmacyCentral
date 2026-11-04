import type { JsonRecord, SystemOverview, SystemService } from "../../staff-api.ts";
import { toEmployeeAccount } from "../governance/employees.ts";
import { auditActionLabel } from "../governance/audit-query.ts";

/** How many failed sign-ins one request reads. A count that reaches it is shown as "100+", not as an exact figure. */
export const FAILED_SIGN_IN_LIMIT = 100;

/** The audit action recorded for a refused staff sign-in (`identity-service`, account routes). */
const FAILED_SIGN_IN_ACTION = ".login-failed";

export type UserSummary = { active: number; deactivated: number; withoutRole: number };

/** Employee accounts by state. An active account with no role cannot sign in (BR-USER-009), so it needs a look. */
export const summarizeUsers = (rows: readonly JsonRecord[]): UserSummary => {
  const summary: UserSummary = { active: 0, deactivated: 0, withoutRole: 0 };
  for (const row of rows) {
    const account = toEmployeeAccount(row);
    if (account.actorType !== "employee") continue;
    if (!account.isActive) {
      summary.deactivated += 1;
      continue;
    }
    summary.active += 1;
    if (account.roles.length === 0) summary.withoutRole += 1;
  }
  return summary;
};

export type ServiceSummary = { up: number; total: number; down: string[] };

/**
 * The services the System page lists, counted by their probe status. Null when that section did not load, so the
 * caller shows "—": an unanswered section is not "no service is up".
 */
export const summarizeServices = (overview: Pick<SystemOverview, "services"> | undefined): ServiceSummary | null => {
  if (overview?.services.status !== "ok") return null;
  const services: readonly SystemService[] = overview.services.data;
  return {
    up: services.filter((service) => service.status === "up").length,
    total: services.length,
    down: services.filter((service) => service.status !== "up").map((service) => service.name),
  };
};

/** The count of failed sign-ins, with a "+" once the request's limit is reached and more may exist. */
export const failedSignInFigure = (count: number, format: (value: number) => string): string =>
  count >= FAILED_SIGN_IN_LIMIT ? `${format(FAILED_SIGN_IN_LIMIT)}+` : format(count);

/** The audit action as the feed shows it. A refused sign-in has no verb in the audit labels, so it is named here. */
export const adminActionLabel = (action: string, entityType: string, translate: (text: string) => string): string =>
  action.replace(/\.v\d+$/, "").endsWith(FAILED_SIGN_IN_ACTION)
    ? translate("Failed sign-in")
    : auditActionLabel(action, entityType, translate);
