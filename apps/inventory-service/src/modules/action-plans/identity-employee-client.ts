import { z } from "zod";

import { internalServiceHeaders } from "../../internal-service-headers.ts";

import type { PlanOwnerCandidate } from "./action-plan.ts";

export type ActiveEmployee = PlanOwnerCandidate & { id: string; displayName: string };

/** Looks up the employee who may own a plan. Resolves undefined for an id that is not an active employee. */
export interface EmployeeDirectory {
  findActiveEmployee(id: string): Promise<ActiveEmployee | undefined>;
}

/** Lists the active employees who hold a site, for the automatic owner of a plan. */
export interface SiteEmployeeDirectory {
  listActiveEmployeesAtSite(siteId: string): Promise<ActiveEmployee[]>;
}

/** identity-service could not answer an owner lookup. The caller fails closed rather than assign an unchecked owner. */
export class EmployeeDirectoryUnavailableError extends Error {
  public constructor() {
    super("Employee lookup is unavailable");
    this.name = "EmployeeDirectoryUnavailableError";
  }
}

const employeeResponseSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  roles: z.array(z.string()),
  siteIds: z.array(z.string().uuid()),
  isActive: z.boolean(),
});

const employeeListResponseSchema = z.object({ employees: z.array(employeeResponseSchema.omit({ isActive: true })) });

/** Reads `GET /internal/employees` and `/internal/employees/:id` on identity-service with the service secret, acting as the system. */
export class IdentityEmployeeClient implements EmployeeDirectory, SiteEmployeeDirectory {
  public constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  public async findActiveEmployee(id: string): Promise<ActiveEmployee | undefined> {
    const headers = { accept: "application/json", "x-actor-type": "system", ...internalServiceHeaders() };
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/internal/employees/${id}`, {
        headers,
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      throw new EmployeeDirectoryUnavailableError();
    }
    if (response.status === 404) return undefined;
    if (!response.ok) throw new EmployeeDirectoryUnavailableError();
    const parsed = employeeResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new EmployeeDirectoryUnavailableError();
    return parsed.data.isActive ? parsed.data : undefined;
  }

  public async listActiveEmployeesAtSite(siteId: string): Promise<ActiveEmployee[]> {
    const headers = { accept: "application/json", "x-actor-type": "system", ...internalServiceHeaders() };
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/internal/employees?siteId=${siteId}`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new EmployeeDirectoryUnavailableError();
    }
    if (!response.ok) throw new EmployeeDirectoryUnavailableError();
    const parsed = employeeListResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new EmployeeDirectoryUnavailableError();
    return parsed.data.employees;
  }
}
