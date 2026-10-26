import type { IdentityDatabase } from "../../../shared/infrastructure/database.ts";
import { createTransactionalAuditRecorder, noAuditRecorder, type AuditRecorder } from "../../outbox/audit-recorder.ts";
import type { AccountRepository, SessionRepository, UnitOfWork } from "../application/account-service.ts";
import { DrizzleAccountRepository } from "./drizzle-account-repository.ts";
import { DrizzleSessionRepository } from "../../sessions/infrastructure/drizzle-session-repository.ts";

/** One Postgres transaction holds the change, its session revocations and its audit entry. */
export const createDrizzleUnitOfWork = (database: IdentityDatabase): UnitOfWork => ({
  run: (work) =>
    database.db.transaction((transaction) =>
      work({
        accounts: new DrizzleAccountRepository(transaction),
        sessions: new DrizzleSessionRepository(transaction),
        audit: createTransactionalAuditRecorder(transaction),
      }),
    ),
});

/** Without a database there is nothing to roll back to, so the work runs directly on the in-memory stores. */
export const createInMemoryUnitOfWork = (
  accounts: AccountRepository,
  sessions: SessionRepository,
  audit: AuditRecorder = noAuditRecorder,
): UnitOfWork => ({
  run: (work) => work({ accounts, sessions, audit }),
});
