import type { IdentityDatabase } from "../../../shared/infrastructure/database.ts";
import { createTransactionalAuditRecorder, noAuditRecorder, type AuditRecorder } from "../../outbox/audit-recorder.ts";
import type { AccountRepository, UnitOfWork } from "../application/account-service.ts";
import { DrizzleAccountRepository } from "./drizzle-account-repository.ts";

/** One Postgres transaction holds the change and its audit entry. */
export const createDrizzleUnitOfWork = (database: IdentityDatabase): UnitOfWork => ({
  run: (work) =>
    database.db.transaction((transaction) =>
      work({
        accounts: new DrizzleAccountRepository(transaction),
        audit: createTransactionalAuditRecorder(transaction),
      }),
    ),
});

/** Without a database there is nothing to roll back to, so the work runs directly on the in-memory stores. */
export const createInMemoryUnitOfWork = (
  accounts: AccountRepository,
  audit: AuditRecorder = noAuditRecorder,
): UnitOfWork => ({
  run: (work) => work({ accounts, audit }),
});
