import { z } from "zod";

import { internalServiceHeaders } from "../internal-service-headers.ts";

/** Turns employee ids into display names. An id it cannot name is left out of the answer, never guessed. */
export interface EmployeeNames {
  namesOf(ids: readonly string[]): Promise<Map<string, string>>;
}

const employeeSchema = z.object({ displayName: z.string().min(1) });

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 500;

/**
 * Reads `GET /internal/employees/:id` on identity-service with the service secret, acting as the system. The answer
 * holds a name, roles and sites, never an email. A deactivated account answers 404 and an unreachable identity-service
 * fails the lookup; both leave the id unnamed, so the History tab falls back to what it knows and never breaks.
 * Names are cached for a few minutes, a miss included, so a busy order does not call identity-service on every read.
 */
export class IdentityEmployeeNames implements EmployeeNames {
  private readonly cache = new Map<string, { name: string | undefined; expiresAt: number }>();

  public constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  public async namesOf(ids: readonly string[]): Promise<Map<string, string>> {
    const named = new Map<string, string>();
    await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const name = await this.nameOf(id);
        if (name !== undefined) named.set(id, name);
      }),
    );
    return named;
  }

  private async nameOf(id: string): Promise<string | undefined> {
    const cached = this.cache.get(id);
    if (cached && cached.expiresAt > this.now()) return cached.name;
    let name: string | undefined;
    let answered = false;
    try {
      const response = await this.fetchImplementation(`${this.baseUrl}/internal/employees/${encodeURIComponent(id)}`, {
        headers: { accept: "application/json", "x-actor-type": "system", ...internalServiceHeaders() },
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status === 404) {
        answered = true;
      } else if (response.ok) {
        const parsed = employeeSchema.safeParse(await response.json().catch(() => undefined));
        if (parsed.success) {
          name = parsed.data.displayName;
          answered = true;
        }
      }
    } catch {
      // identity-service did not answer; the id stays unnamed and is asked again on the next read.
    }
    if (answered) {
      if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.clear();
      this.cache.set(id, { name, expiresAt: this.now() + CACHE_TTL_MS });
    }
    return name;
  }
}
