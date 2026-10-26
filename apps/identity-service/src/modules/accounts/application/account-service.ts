import { randomUUID } from "node:crypto";

import type { Account, CustomerMatch } from "../domain/account.ts";
import { AccountError, accountErrors } from "../domain/account-error.ts";
import { assertEmail } from "../domain/email-address.ts";
import { canonicalPhoneDigits } from "../domain/phone-number.ts";
import type { InMemoryAccountRepository } from "../infrastructure/in-memory-account-repository.ts";
import { Argon2idPasswordHasher } from "../infrastructure/security/argon2id-password-hasher.ts";
import { VerificationTokenService } from "./verification-token-service.ts";
import type {
  InMemorySessionRepository,
  CreatedSession,
  Session,
} from "../../sessions/infrastructure/in-memory-session-repository.ts";
import type { GoogleProfile } from "../infrastructure/security/google-oidc-client.ts";
import type { AuditEntry, AuditRecorder } from "../../outbox/audit-recorder.ts";

export type VerificationEmailSender = {
  sendVerificationEmail: (input: { email: string; accountId: string; token: string }) => Promise<void>;
  sendPasswordResetEmail?: (input: { email: string; accountId: string; token: string }) => Promise<void>;
};

export type AccountRepository = Pick<
  InMemoryAccountRepository,
  | "create"
  | "findByEmail"
  | "findById"
  | "list"
  | "save"
  | "searchActiveCustomers"
  | "findActiveCustomerById"
  | "findActiveCustomersByIds"
>;
export type SessionRepository = Pick<InMemorySessionRepository, "create" | "findActive" | "revoke" | "revokeAll">;

/** The repositories and the audit writer one change runs on. In production they share a single transaction. */
export type WriteScope = { accounts: AccountRepository; sessions: SessionRepository; audit: AuditRecorder };

/**
 * Runs a change and its audit entry together: either both commit or neither does, so a change whose entry cannot be
 * written is refused rather than left unrecorded.
 */
export type UnitOfWork = { run: <T>(work: (scope: WriteScope) => Promise<T>) => Promise<T> };

export type LoginResult = {
  account: Account;
  session: CreatedSession;
};

export const employeeRoles = ["Platform Admin", "Pharmacy Manager", "Pharmacist", "Warehouse Staff"] as const;

const platformAdminRole = "Platform Admin";

/** A counter picker only has to tell one patient from another, so a search never returns the whole customer base. */
const customerLookupLimit = 5;

const passwordResetLifetimeMs = 60 * 60 * 1000;

/** Validates an access grant: known roles, at least one role, and a site unless the grant includes Platform Admin. */
const assertAccessGrant = (roles: readonly string[], siteIds: readonly string[]): void => {
  if (roles.some((role) => !(employeeRoles as readonly string[]).includes(role))) throw accountErrors.unknownRole();
  if (roles.length === 0) throw accountErrors.roleRequired();
  if (!roles.includes(platformAdminRole) && siteIds.length === 0) throw accountErrors.siteRequired();
};

export class AccountService {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly passwordHasher: Argon2idPasswordHasher,
    private readonly verificationTokens: VerificationTokenService,
    private readonly verificationEmailSender: VerificationEmailSender,
    private readonly unitOfWork: UnitOfWork,
    private readonly passwordResetTokens = new VerificationTokenService(),
  ) {}

  private readonly googleSubjects = new Map<string, string>();

  public async loginWithGoogle(profile: GoogleProfile): Promise<LoginResult> {
    let account: Account | undefined;
    const linkedAccountId = this.googleSubjects.get(profile.subject);
    if (linkedAccountId) {
      account = await this.accounts.findById(linkedAccountId);
    }

    if (!account) {
      account = await this.accounts.findByEmail(assertEmail(profile.email));
    }

    // Google signs in customers only: an employee signs in with a password, and an inactive account is refused.
    if (account?.actorType === "employee") throw accountErrors.passwordSignInRequired();
    if (account && !account.isActive) throw refused(accountErrors.invalidCredentials(), "inactive", account.id);

    if (!account) {
      account = await this.accounts.create({
        actorType: "customer",
        isActive: true,
        mustChangePassword: false,
        email: assertEmail(profile.email),
        displayName: profile.displayName.trim(),
        passwordHash: await this.passwordHasher.hash(randomUUID()),
        emailVerifiedAt: new Date(),
        roles: [],
        siteIds: [],
      });
    }

    account.emailVerifiedAt ??= new Date();
    await this.accounts.save(account);
    this.googleSubjects.set(profile.subject, account.id);
    const session = await this.sessions.create(account.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    return { account, session };
  }

  public async registerCustomer(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ account: Account; token: string }> {
    const email = assertEmail(input.email);
    if (await this.accounts.findByEmail(email)) {
      throw accountErrors.emailTaken();
    }

    const account = await this.accounts.create({
      actorType: "customer",
      isActive: true,
      mustChangePassword: false,
      email,
      displayName: input.displayName.trim(),
      passwordHash: await this.passwordHasher.hash(input.password),
      roles: [],
      siteIds: [],
    });
    const verification = await this.verificationTokens.issue(account.id, new Date(Date.now() + 60 * 60 * 1000));
    await this.verificationEmailSender.sendVerificationEmail({
      email,
      accountId: account.id,
      token: verification.token,
    });
    return { account, token: verification.token };
  }

  public async verifyEmail(accountId: string, token: string): Promise<Account> {
    if (!(await this.verificationTokens.consume(token, accountId))) {
      throw new Error("Invalid or expired verification token");
    }

    const account = await this.requireAccount(accountId);
    account.emailVerifiedAt = new Date();
    await this.accounts.save(account);
    return account;
  }

  /**
   * Signs in with a password. An inactive account gets the same answer as a wrong password, so a deactivated account
   * is not revealed. With `audience: "employee"` a customer is refused before any session exists.
   */
  public async login(input: {
    email: string;
    password: string;
    audience?: "employee" | undefined;
  }): Promise<LoginResult> {
    const account = await this.accounts.findByEmail(assertEmail(input.email));
    if (!account || !(await this.passwordHasher.verify(input.password, account.passwordHash))) {
      throw refused(accountErrors.invalidCredentials(), "invalid_credentials", account?.id);
    }
    if (!account.isActive) {
      throw refused(accountErrors.invalidCredentials(), "inactive", account.id);
    }
    if (!account.emailVerifiedAt) {
      throw refused(accountErrors.notVerified(), "unverified", account.id);
    }
    if (input.audience === "employee" && account.actorType !== "employee") {
      throw refused(accountErrors.employeeRequired(), "not_employee", account.id);
    }

    if (this.passwordHasher.needsRehash(account.passwordHash)) {
      account.passwordHash = await this.passwordHasher.hash(input.password);
      await this.accounts.save(account);
    }

    const session = await this.sessions.create(account.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    return { account, session };
  }

  /** A session of an inactive account ends at the next request: it resolves to nothing. */
  public async currentSession(rawToken: string): Promise<{ account: Account; session: Session } | undefined> {
    const session = await this.sessions.findActive(rawToken);
    if (!session) {
      return undefined;
    }

    const account = await this.accounts.findById(session.accountId);
    return account?.isActive ? { account, session } : undefined;
  }

  public async logout(rawToken: string): Promise<void> {
    const session = await this.sessions.findActive(rawToken);
    if (session) {
      await this.sessions.revoke(session.sessionId);
    }
  }

  public async requestPasswordReset(emailInput: string): Promise<void> {
    const account = await this.accounts.findByEmail(assertEmail(emailInput));
    // A deactivated account cannot obtain a reset token (its request is answered the same as an unknown address).
    if (!account || !account.isActive) {
      return;
    }

    const reset = await this.passwordResetTokens.issue(account.id, new Date(Date.now() + passwordResetLifetimeMs));
    if (this.verificationEmailSender.sendPasswordResetEmail) {
      await this.verificationEmailSender.sendPasswordResetEmail({
        email: account.email,
        accountId: account.id,
        token: reset.token,
      });
    }
  }

  public async resetPassword(accountId: string, token: string, nextPassword: string): Promise<void> {
    if (!(await this.passwordResetTokens.consume(token, accountId))) {
      throw new Error("Invalid or expired password reset token");
    }

    const account = await this.requireAccount(accountId);
    if (!account.isActive) {
      throw new Error("Invalid or expired password reset token");
    }
    const passwordHash = await this.passwordHasher.hash(nextPassword);
    await this.unitOfWork.run(async (scope) => {
      account.passwordHash = passwordHash;
      account.mustChangePassword = false;
      await scope.accounts.save(account);
      await scope.sessions.revokeAll(account.id);
    });
  }

  public async changePassword(accountId: string, currentPassword: string, nextPassword: string): Promise<void> {
    const account = await this.requireAccount(accountId);
    if (!(await this.passwordHasher.verify(currentPassword, account.passwordHash))) {
      throw accountErrors.currentPasswordInvalid();
    }

    const passwordHash = await this.passwordHasher.hash(nextPassword);
    await this.unitOfWork.run(async (scope) => {
      account.passwordHash = passwordHash;
      account.mustChangePassword = false;
      await scope.accounts.save(account);
      await scope.sessions.revokeAll(account.id);
      await this.auditOwnEmployeeChange(scope, account, "identity.account.password-changed");
    });
  }

  /**
   * Updates the contact details the account holder keeps in their own profile. Email is deliberately not editable
   * here: it is the login key, so changing it needs the separate verification flow.
   */
  public async updateProfile(
    accountId: string,
    input: { displayName?: string | undefined; phoneNumber?: string | null | undefined },
  ): Promise<Account> {
    const account = await this.requireAccount(accountId);
    if (input.displayName !== undefined) account.displayName = input.displayName;
    if (input.phoneNumber !== undefined) {
      const phoneNumber = input.phoneNumber?.trim() ?? "";
      account.phoneNumber = phoneNumber.length > 0 ? phoneNumber : undefined;
    }
    await this.unitOfWork.run(async (scope) => {
      await scope.accounts.save(account);
      await this.auditOwnEmployeeChange(scope, account, "identity.account.profile-updated");
    });
    return account;
  }

  public async listRoles(): Promise<readonly string[]> {
    return employeeRoles;
  }

  /** Employee accounts only. `status` narrows the list to active or deactivated accounts; omitted, it lists both. */
  public async listUsers(status?: "active" | "deactivated"): Promise<Account[]> {
    const employees = (await this.accounts.list()).filter((account) => account.actorType === "employee");
    if (status === undefined) return employees;
    return employees.filter((account) => (status === "active" ? account.isActive : !account.isActive));
  }

  /**
   * The counter links a prescription to a customer account, so staff look one up by the exact phone or email the
   * patient gives them. Only customer accounts match: an employee's email must never surface in this picker.
   */
  public async searchCustomers(query: string): Promise<CustomerMatch[]> {
    const trimmed = query.trim();
    return this.accounts.searchActiveCustomers({
      email: trimmed.toLowerCase(),
      phoneDigits: canonicalPhoneDigits(trimmed),
      limit: customerLookupLimit,
    });
  }

  public async findActiveCustomer(
    customerId: string,
  ): Promise<{ id: string; displayName: string; phoneNumber: string | null } | undefined> {
    const customer = await this.accounts.findActiveCustomerById(customerId);
    return customer ? toCustomerContact(customer) : undefined;
  }

  /** The active customers among `customerIds`; an unknown or inactive id is left out, and an employee never matches. */
  public async findActiveCustomers(
    customerIds: string[],
  ): Promise<{ id: string; displayName: string; phoneNumber: string | null }[]> {
    const distinct = [...new Set(customerIds)];
    const customers = await this.accounts.findActiveCustomersByIds(distinct);
    return customers.map(toCustomerContact);
  }

  public async createEmployee(
    actorId: string,
    input: { email: string; password: string; displayName: string; roles: string[]; siteIds: string[] },
  ): Promise<Account> {
    const email = assertEmail(input.email);
    const roles = [...new Set(input.roles)];
    const siteIds = [...new Set(input.siteIds)];
    assertAccessGrant(roles, siteIds);
    if (await this.accounts.findByEmail(email)) {
      throw accountErrors.emailTaken();
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    return this.unitOfWork.run(async (scope) => {
      const created = await scope.accounts.create({
        actorType: "employee",
        isActive: true,
        // An administrator chose this password, so the new holder replaces it before working.
        mustChangePassword: true,
        email,
        displayName: input.displayName.trim(),
        passwordHash,
        emailVerifiedAt: new Date(),
        roles,
        siteIds,
      });
      await this.auditAdminChange(scope, actorId, "identity.user.created", created.id, {
        roles: created.roles.join(","),
        sites: created.siteIds.length,
      });
      return created;
    });
  }

  public async updateUserAccess(
    actorId: string,
    accountId: string,
    roles: string[],
    siteIds: string[],
  ): Promise<Account> {
    const account = await this.requireEmployee(accountId);
    if (account.id === actorId) {
      throw accountErrors.selfChange("Bạn không thể tự đổi quyền của mình.");
    }
    const nextRoles = [...new Set(roles)];
    const nextSiteIds = [...new Set(siteIds)];
    assertAccessGrant(nextRoles, nextSiteIds);
    const removesPlatformAdmin = account.roles.includes(platformAdminRole) && !nextRoles.includes(platformAdminRole);
    if (removesPlatformAdmin && account.isActive && (await this.otherActivePlatformAdmins(account.id)) === 0) {
      throw accountErrors.lastPlatformAdmin();
    }

    return this.unitOfWork.run(async (scope) => {
      account.roles = nextRoles;
      account.siteIds = nextSiteIds;
      await scope.accounts.save(account);
      await this.auditAdminChange(scope, actorId, "identity.user.access-updated", account.id, {
        roles: account.roles.join(","),
        sites: account.siteIds.length,
      });
      return account;
    });
  }

  public async resetUserPassword(actorId: string, accountId: string, password: string): Promise<void> {
    const account = await this.requireEmployee(accountId);
    if (account.id === actorId) {
      throw accountErrors.selfChange("Bạn không thể tự đặt lại mật khẩu của mình tại đây.");
    }
    if (!account.isActive) {
      throw accountErrors.accountDeactivated();
    }

    const passwordHash = await this.passwordHasher.hash(password);
    await this.unitOfWork.run(async (scope) => {
      account.passwordHash = passwordHash;
      account.mustChangePassword = true;
      await scope.accounts.save(account);
      await scope.sessions.revokeAll(account.id);
      await this.auditAdminChange(scope, actorId, "identity.user.password-reset", account.id);
    });
  }

  public async revokeAllSessions(actorId: string, accountId: string): Promise<void> {
    const account = await this.requireEmployee(accountId);
    if (account.id === actorId) {
      throw accountErrors.selfChange("Bạn không thể tự đăng xuất các phiên của mình tại đây.");
    }

    await this.unitOfWork.run(async (scope) => {
      await scope.sessions.revokeAll(account.id);
      await this.auditAdminChange(scope, actorId, "identity.user.sessions-revoked", account.id);
    });
  }

  /** Turns the account off: it signs in no more and its sessions end in the same transaction. Nothing is deleted. */
  public async deactivateEmployee(actorId: string, accountId: string): Promise<void> {
    const account = await this.requireEmployee(accountId);
    if (account.id === actorId) {
      throw accountErrors.selfChange("Bạn không thể tự vô hiệu hóa tài khoản của mình.");
    }
    if (account.isActive && account.roles.includes(platformAdminRole)) {
      if ((await this.otherActivePlatformAdmins(account.id)) === 0) throw accountErrors.lastPlatformAdmin();
    }

    await this.unitOfWork.run(async (scope) => {
      account.isActive = false;
      await scope.accounts.save(account);
      await scope.sessions.revokeAll(account.id);
      await this.auditAdminChange(scope, actorId, "identity.user.deactivated", account.id);
    });
  }

  public async activateEmployee(actorId: string, accountId: string): Promise<void> {
    const account = await this.requireEmployee(accountId);
    await this.unitOfWork.run(async (scope) => {
      account.isActive = true;
      await scope.accounts.save(account);
      await this.auditAdminChange(scope, actorId, "identity.user.activated", account.id);
    });
  }

  public async getSetupStatus(): Promise<{ configured: boolean }> {
    const accounts = await this.accounts.list();
    return { configured: accounts.some((account) => account.roles.includes(platformAdminRole)) };
  }

  public async createFirstAdmin(input: { email: string; password: string; displayName: string }): Promise<LoginResult> {
    if ((await this.getSetupStatus()).configured) {
      throw new Error("First administrator is already configured");
    }

    const email = assertEmail(input.email);
    if (await this.accounts.findByEmail(email)) {
      throw accountErrors.emailTaken();
    }

    // The first administrator chose this password, so it is not flagged for change.
    const account = await this.accounts.create({
      actorType: "employee",
      isActive: true,
      mustChangePassword: false,
      email,
      displayName: input.displayName.trim(),
      passwordHash: await this.passwordHasher.hash(input.password),
      emailVerifiedAt: new Date(),
      roles: [platformAdminRole],
      siteIds: [],
    });
    const session = await this.sessions.create(account.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    return { account, session };
  }

  /** Active Platform Admins other than `accountId`. The last active one may not lose the role or be turned off. */
  private async otherActivePlatformAdmins(accountId: string): Promise<number> {
    const accounts = await this.accounts.list();
    return accounts.filter(
      (account) =>
        account.id !== accountId &&
        account.actorType === "employee" &&
        account.isActive &&
        account.roles.includes(platformAdminRole),
    ).length;
  }

  /** The target of an administrator's action. Customers are never managed here, so any other id is not found. */
  private async requireEmployee(accountId: string): Promise<Account> {
    const account = await this.accounts.findById(accountId);
    if (!account || account.actorType !== "employee") {
      throw accountErrors.employeeNotFound();
    }

    return account;
  }

  private async requireAccount(accountId: string): Promise<Account> {
    const account = await this.accounts.findById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    return account;
  }

  private async auditAdminChange(
    scope: WriteScope,
    actorId: string,
    action: string,
    targetId: string,
    details?: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await recordAudit(scope.audit, {
      action,
      entityType: "user",
      entityId: targetId,
      actorId,
      ...(details ? { details } : {}),
    });
  }

  /** An employee's own profile or password change is their trail; a shopper's is not a staff action. */
  private async auditOwnEmployeeChange(scope: WriteScope, account: Account, action: string): Promise<void> {
    if (account.actorType !== "employee") return;
    await recordAudit(scope.audit, { action, entityType: "user", entityId: account.id, actorId: account.id });
  }
}

/**
 * The change and its entry share one transaction, so a refused entry rolls the change back. The refusal says so.
 */
const recordAudit = async (audit: AuditRecorder, entry: AuditEntry): Promise<void> => {
  try {
    await audit.record(entry);
  } catch {
    throw accountErrors.auditUnavailable();
  }
};

/** Records why a sign-in was refused, so a failed staff sign-in can be audited without its password. */
const refused = (error: AccountError, reason: string, accountId: string | undefined): AccountError => {
  error.reason = reason;
  error.accountId = accountId;
  return error;
};

const toCustomerContact = (
  customer: CustomerMatch,
): { id: string; displayName: string; phoneNumber: string | null } => ({
  id: customer.id,
  displayName: customer.displayName,
  phoneNumber: customer.phoneNumber,
});
