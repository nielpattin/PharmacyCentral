import { randomUUID } from "node:crypto";

import type { Account } from "../domain/account.ts";
import { assertEmail } from "../domain/email-address.ts";
import type { InMemoryAccountRepository } from "../infrastructure/in-memory-account-repository.ts";
import { Argon2idPasswordHasher } from "../infrastructure/security/argon2id-password-hasher.ts";
import { VerificationTokenService } from "./verification-token-service.ts";
import type {
  InMemorySessionRepository,
  CreatedSession,
  Session,
} from "../../sessions/infrastructure/in-memory-session-repository.ts";
import type { GoogleProfile } from "../infrastructure/security/google-oidc-client.ts";

export type VerificationEmailSender = {
  sendVerificationEmail: (input: { email: string; accountId: string; token: string }) => Promise<void>;
  sendPasswordResetEmail?: (input: { email: string; accountId: string; token: string }) => Promise<void>;
};

export type AccountRepository = Pick<
  InMemoryAccountRepository,
  "create" | "findByEmail" | "findById" | "list" | "save"
>;
export type SessionRepository = Pick<InMemorySessionRepository, "create" | "findActive" | "revoke" | "revokeAll">;

export type LoginResult = {
  account: Account;
  session: CreatedSession;
};

export const employeeRoles = ["Platform Admin", "Pharmacy Manager", "Pharmacist", "Warehouse Staff"] as const;

export class AccountService {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly passwordHasher: Argon2idPasswordHasher,
    private readonly verificationTokens: VerificationTokenService,
    private readonly verificationEmailSender: VerificationEmailSender,
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

    if (!account) {
      account = await this.accounts.create({
        actorType: "customer",
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
      throw new Error("An account with this email already exists");
    }

    const account = await this.accounts.create({
      actorType: "customer",
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

  public async login(input: { email: string; password: string }): Promise<LoginResult> {
    const account = await this.accounts.findByEmail(assertEmail(input.email));
    if (!account || !(await this.passwordHasher.verify(input.password, account.passwordHash))) {
      throw new Error("Invalid email or password");
    }
    if (!account.emailVerifiedAt) {
      throw new Error("Email address is not verified");
    }

    if (this.passwordHasher.needsRehash(account.passwordHash)) {
      account.passwordHash = await this.passwordHasher.hash(input.password);
      await this.accounts.save(account);
    }

    const session = await this.sessions.create(account.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    return { account, session };
  }

  public async currentSession(rawToken: string): Promise<{ account: Account; session: Session } | undefined> {
    const session = await this.sessions.findActive(rawToken);
    if (!session) {
      return undefined;
    }

    const account = await this.accounts.findById(session.accountId);
    return account ? { account, session } : undefined;
  }

  public async logout(rawToken: string): Promise<void> {
    const session = await this.sessions.findActive(rawToken);
    if (session) {
      await this.sessions.revoke(session.sessionId);
    }
  }

  public async requestPasswordReset(emailInput: string): Promise<void> {
    const account = await this.accounts.findByEmail(assertEmail(emailInput));
    if (!account) {
      return;
    }

    const reset = await this.passwordResetTokens.issue(account.id, new Date(Date.now() + 60 * 60 * 1000));
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
    account.passwordHash = await this.passwordHasher.hash(nextPassword);
    await this.accounts.save(account);
    await this.sessions.revokeAll(account.id);
  }

  public async changePassword(accountId: string, currentPassword: string, nextPassword: string): Promise<void> {
    const account = await this.requireAccount(accountId);
    if (!(await this.passwordHasher.verify(currentPassword, account.passwordHash))) {
      throw new Error("Current password is invalid");
    }

    account.passwordHash = await this.passwordHasher.hash(nextPassword);
    await this.accounts.save(account);
    await this.sessions.revokeAll(account.id);
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
    await this.accounts.save(account);
    return account;
  }

  public async listRoles(): Promise<readonly string[]> {
    return employeeRoles;
  }

  public async listUsers(): Promise<Account[]> {
    return this.accounts.list();
  }

  public async createEmployee(input: {
    email: string;
    password: string;
    displayName: string;
    roles: string[];
    siteIds: string[];
  }): Promise<Account> {
    const email = assertEmail(input.email);
    if (await this.accounts.findByEmail(email)) {
      throw new Error("An account with this email already exists");
    }
    if (input.roles.some((role) => !employeeRoles.includes(role as (typeof employeeRoles)[number]))) {
      throw new Error("Unknown employee role");
    }

    return this.accounts.create({
      actorType: "employee",
      email,
      displayName: input.displayName.trim(),
      passwordHash: await this.passwordHasher.hash(input.password),
      emailVerifiedAt: new Date(),
      roles: [...input.roles],
      siteIds: [...input.siteIds],
    });
  }

  public async updateUserAccess(accountId: string, roles: string[], siteIds: string[]): Promise<Account> {
    if (roles.some((role) => !employeeRoles.includes(role as (typeof employeeRoles)[number]))) {
      throw new Error("Unknown employee role");
    }
    const account = await this.requireAccount(accountId);
    account.roles = [...roles];
    account.siteIds = [...siteIds];
    await this.accounts.save(account);
    return account;
  }

  public async resetUserPassword(accountId: string, password: string): Promise<void> {
    const account = await this.requireAccount(accountId);
    account.passwordHash = await this.passwordHasher.hash(password);
    await this.accounts.save(account);
    await this.sessions.revokeAll(account.id);
  }

  public async revokeAllSessions(accountId: string): Promise<void> {
    await this.requireAccount(accountId);
    await this.sessions.revokeAll(accountId);
  }

  public async getSetupStatus(): Promise<{ configured: boolean }> {
    const accounts = await this.accounts.list();
    return { configured: accounts.some((account) => account.roles.includes("Platform Admin")) };
  }

  public async createFirstAdmin(input: { email: string; password: string; displayName: string }): Promise<LoginResult> {
    if ((await this.getSetupStatus()).configured) {
      throw new Error("First administrator is already configured");
    }

    const email = assertEmail(input.email);
    if (await this.accounts.findByEmail(email)) {
      throw new Error("An account with this email already exists");
    }

    const account = await this.accounts.create({
      actorType: "employee",
      email,
      displayName: input.displayName.trim(),
      passwordHash: await this.passwordHasher.hash(input.password),
      emailVerifiedAt: new Date(),
      roles: ["Platform Admin"],
      siteIds: [],
    });
    const session = await this.sessions.create(account.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    return { account, session };
  }

  private async requireAccount(accountId: string): Promise<Account> {
    const account = await this.accounts.findById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    return account;
  }
}
