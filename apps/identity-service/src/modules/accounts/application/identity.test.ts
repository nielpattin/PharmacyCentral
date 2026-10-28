import { describe, expect, it } from "vitest";

import { AccountService } from "./account-service.ts";
import { InMemoryAccountRepository } from "../infrastructure/in-memory-account-repository.ts";
import { createInMemoryUnitOfWork } from "../infrastructure/unit-of-work.ts";
import { Argon2idPasswordHasher } from "../infrastructure/security/argon2id-password-hasher.ts";
import { InMemorySessionRepository } from "../../sessions/infrastructure/in-memory-session-repository.ts";
import { VerificationTokenService } from "../application/verification-token-service.ts";
import type { AuditEntry, AuditRecorder } from "../../outbox/audit-recorder.ts";
import { AccountError } from "../domain/account-error.ts";
import type { Account } from "../domain/account.ts";

const hasher = new Argon2idPasswordHasher({ memory: 19456, passes: 2, parallelism: 1, tagLength: 32 });
const password = "correct horse battery staple";
const passwordHash = await hasher.hash(password);
const sender = { sendVerificationEmail: async () => undefined };
const adminId = "00000000-0000-4000-8000-0000000000a1";

/** A service over in-memory stores, with the audit entries it writes collected for assertions. */
type Harness = {
  accounts: InMemoryAccountRepository;
  sessions: InMemorySessionRepository;
  service: AccountService;
  entries: AuditEntry[];
};

const createHarness = (audit?: AuditRecorder): Harness => {
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const entries: AuditEntry[] = [];
  const recorder: AuditRecorder = audit ?? {
    record: async (entry) => {
      entries.push(entry);
    },
  };
  const service = new AccountService(
    accounts,
    sessions,
    hasher,
    new VerificationTokenService(),
    sender,
    createInMemoryUnitOfWork(accounts, sessions, recorder),
  );
  return { accounts, sessions, service, entries };
};

const addAccount = (harness: Harness, overrides: Partial<Omit<Account, "id" | "createdAt">> = {}): Promise<Account> =>
  harness.accounts.create({
    actorType: "employee",
    isActive: true,
    mustChangePassword: false,
    email: `user-${Math.random().toString(36).slice(2)}@example.com`,
    displayName: "Nhân viên",
    passwordHash,
    emailVerifiedAt: new Date(),
    roles: ["Pharmacist"],
    siteIds: ["00000000-0000-4000-8000-0000000000b1"],
    ...overrides,
  });

/** An active Platform Admin with an id the service treats as the acting administrator. */
const addAdmin = async (harness: Harness): Promise<Account> =>
  harness.accounts.create({
    actorType: "employee",
    isActive: true,
    mustChangePassword: false,
    email: "admin@example.com",
    displayName: "Quản trị",
    passwordHash,
    emailVerifiedAt: new Date(),
    roles: ["Platform Admin"],
    siteIds: [],
  });

const expectRefusal = async (promise: Promise<unknown>, code: string, status: number): Promise<AccountError> => {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof AccountError)) throw new Error("Expected the change to be refused with an AccountError");
  expect(error.code).toBe(code);
  expect(error.status).toBe(status);
  return error;
};

describe("identity security primitives", () => {
  it("hashes and verifies passwords with a serialized Argon2id policy", async () => {
    const encoded = await hasher.hash("correct horse battery staple");

    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await hasher.verify("correct horse battery staple", encoded)).toBe(true);
    expect(await hasher.verify("wrong password", encoded)).toBe(false);
  });

  it("creates one-time verification tokens and consumes them once", async () => {
    const service = new VerificationTokenService();
    const issued = await service.issue("account-1", new Date(Date.now() + 60_000));

    expect(await service.consume(issued.token, "account-1")).toBe(true);
    expect(await service.consume(issued.token, "account-1")).toBe(false);
    expect(await service.consume(issued.token, "account-2")).toBe(false);
  });

  it("registers verified customers and creates sessions after verification", async () => {
    const accountRepository = new InMemoryAccountRepository();
    const sessions = new InMemorySessionRepository();
    const tokenService = new VerificationTokenService();
    const sentTokens: string[] = [];
    const service = new AccountService(
      accountRepository,
      sessions,
      hasher,
      tokenService,
      {
        sendVerificationEmail: async ({ token }) => {
          sentTokens.push(token);
        },
      },
      createInMemoryUnitOfWork(accountRepository, sessions),
    );

    const registration = await service.registerCustomer({
      email: " Customer@Example.com ",
      password: "correct horse battery staple",
      displayName: "Customer",
    });
    await expect(
      service.login({ email: "customer@example.com", password: "correct horse battery staple" }),
    ).rejects.toThrow("not verified");
    await service.verifyEmail(registration.account.id, sentTokens[0]!);
    const login = await service.login({ email: "customer@example.com", password: "correct horse battery staple" });

    expect(login.account.actorType).toBe("customer");
    expect(await service.currentSession(login.session.rawToken)).toMatchObject({
      account: { email: "customer@example.com" },
    });
  });

  it("uses one-time password reset tokens without revealing account existence", async () => {
    const accountRepository = new InMemoryAccountRepository();
    const sessions = new InMemorySessionRepository();
    const resetTokens: string[] = [];
    const service = new AccountService(
      accountRepository,
      sessions,
      hasher,
      new VerificationTokenService(),
      {
        sendVerificationEmail: async () => undefined,
        sendPasswordResetEmail: async ({ token }) => {
          resetTokens.push(token);
        },
      },
      createInMemoryUnitOfWork(accountRepository, sessions),
    );

    const account = await accountRepository.create({
      actorType: "customer",
      isActive: true,
      mustChangePassword: false,
      email: "reset@example.com",
      displayName: "Reset",
      passwordHash: await hasher.hash("old password phrase"),
      emailVerifiedAt: new Date(),
      roles: [],
      siteIds: [],
    });
    await service.requestPasswordReset("reset@example.com");
    await service.resetPassword(account.id, resetTokens[0]!, "new password phrase");
    await expect(service.login({ email: account.email, password: "old password phrase" })).rejects.toThrow(
      "Invalid email or password",
    );
    await expect(service.login({ email: account.email, password: "new password phrase" })).resolves.toBeDefined();
    await service.requestPasswordReset("missing@example.com");
    expect(resetTokens).toHaveLength(1);
  });

  it("creates the first administrator once", async () => {
    const harness = createHarness();

    const result = await harness.service.createFirstAdmin({
      email: "first-admin@example.com",
      password: "correct horse battery staple",
      displayName: "Admin",
    });
    expect(result.account.roles).toEqual(["Platform Admin"]);
    expect(result.account.mustChangePassword).toBe(false);
    await expect(
      harness.service.createFirstAdmin({
        email: "other@example.com",
        password: "correct horse battery staple",
        displayName: "Other",
      }),
    ).rejects.toThrow("already configured");
  });

  it("revokes opaque sessions and supports global revocation", async () => {
    const repository = new InMemorySessionRepository();
    const first = await repository.create("account-1", new Date(Date.now() + 60_000));
    const second = await repository.create("account-1", new Date(Date.now() + 60_000));

    expect(await repository.findActive(first.rawToken)).toMatchObject({ accountId: "account-1" });
    await repository.revoke(first.sessionId);
    expect(await repository.findActive(first.rawToken)).toBeUndefined();

    await repository.revokeAll("account-1");
    expect(await repository.findActive(second.rawToken)).toBeUndefined();
  });
});

describe("account lifecycle", () => {
  it("ends the sessions of a deactivated account and refuses its sign-in with the generic message", async () => {
    const harness = createHarness();
    const admin = await addAdmin(harness);
    const employee = await addAccount(harness);
    const session = await harness.service.login({ email: employee.email, password });

    await harness.service.deactivateEmployee(admin.id, employee.id);

    expect(await harness.service.currentSession(session.session.rawToken)).toBeUndefined();
    const refusal = await expectRefusal(
      harness.service.login({ email: employee.email, password }),
      "request_failed",
      401,
    );
    expect(refusal.message).toBe("Invalid email or password");
    expect(refusal.detail).toBe("Email hoặc mật khẩu không đúng.");
    expect(refusal.reason).toBe("inactive");
    expect(harness.entries.map((entry) => entry.action)).toEqual(["identity.user.deactivated"]);
  });

  it("keeps the roles, sites and password of a deactivated account and restores sign-in on activation", async () => {
    const harness = createHarness();
    const admin = await addAdmin(harness);
    const employee = await addAccount(harness, { roles: ["Pharmacy Manager"] });
    const siteIds = [...employee.siteIds];

    await harness.service.deactivateEmployee(admin.id, employee.id);
    await harness.service.activateEmployee(admin.id, employee.id);

    const restored = await harness.service.login({ email: employee.email, password });
    expect(restored.account).toMatchObject({ isActive: true, roles: ["Pharmacy Manager"], siteIds });
    expect(harness.entries.map((entry) => entry.action)).toEqual([
      "identity.user.deactivated",
      "identity.user.activated",
    ]);
  });

  it("refuses a deactivated account a password reset token and a reset", async () => {
    const resetEmails: string[] = [];
    const accounts = new InMemoryAccountRepository();
    const sessions = new InMemorySessionRepository();
    const service = new AccountService(
      accounts,
      sessions,
      hasher,
      new VerificationTokenService(),
      {
        sendVerificationEmail: async () => undefined,
        sendPasswordResetEmail: async ({ email }) => {
          resetEmails.push(email);
        },
      },
      createInMemoryUnitOfWork(accounts, sessions),
    );
    const admin = await accounts.create({
      actorType: "employee",
      isActive: true,
      mustChangePassword: false,
      email: "admin@example.com",
      displayName: "Quản trị",
      passwordHash,
      emailVerifiedAt: new Date(),
      roles: ["Platform Admin"],
      siteIds: [],
    });
    const employee = await accounts.create({
      actorType: "employee",
      isActive: true,
      mustChangePassword: false,
      email: "gone@example.com",
      displayName: "Đã nghỉ",
      passwordHash,
      emailVerifiedAt: new Date(),
      roles: ["Pharmacist"],
      siteIds: ["00000000-0000-4000-8000-0000000000b1"],
    });

    await service.deactivateEmployee(admin.id, employee.id);
    await service.requestPasswordReset(employee.email);
    expect(resetEmails).toEqual([]);

    await expectRefusal(
      service.resetUserPassword(admin.id, employee.id, "a brand new phrase"),
      "account_deactivated",
      409,
    );
  });

  it("refuses a password reset token consumed after the account was deactivated", async () => {
    const tokens: string[] = [];
    const accounts = new InMemoryAccountRepository();
    const sessions = new InMemorySessionRepository();
    const service = new AccountService(
      accounts,
      sessions,
      hasher,
      new VerificationTokenService(),
      {
        sendVerificationEmail: async () => undefined,
        sendPasswordResetEmail: async ({ token }) => {
          tokens.push(token);
        },
      },
      createInMemoryUnitOfWork(accounts, sessions),
    );
    const customer = await accounts.create({
      actorType: "customer",
      isActive: true,
      mustChangePassword: false,
      email: "shopper@example.com",
      displayName: "Khách",
      passwordHash,
      emailVerifiedAt: new Date(),
      roles: [],
      siteIds: [],
    });
    await service.requestPasswordReset(customer.email);
    await accounts.save({ ...customer, isActive: false });

    await expect(service.resetPassword(customer.id, tokens[0]!, "a brand new phrase")).rejects.toThrow(
      "Invalid or expired password reset token",
    );
  });

  it("refuses a customer at employee sign-in and accepts the same customer without the audience", async () => {
    const harness = createHarness();
    const customer = await addAccount(harness, { actorType: "customer", roles: [], siteIds: [] });

    const refusal = await expectRefusal(
      harness.service.login({ email: customer.email, password, audience: "employee" }),
      "employee_required",
      403,
    );
    expect(refusal.detail).toBe("Cần tài khoản nhân viên để vào khu vực này.");
    expect(refusal.reason).toBe("not_employee");
    expect(refusal.accountId).toBe(customer.id);
    await expect(harness.service.login({ email: customer.email, password })).resolves.toMatchObject({
      account: { actorType: "customer" },
    });
  });

  it("refuses an inactive customer at sign-in and a Google sign-in for an employee", async () => {
    const harness = createHarness();
    await addAccount(harness, {
      actorType: "customer",
      roles: [],
      siteIds: [],
      isActive: false,
      email: "off@example.com",
    });
    await addAccount(harness, { actorType: "employee", email: "staff@example.com" });

    await expectRefusal(harness.service.login({ email: "off@example.com", password }), "request_failed", 401);
    await expectRefusal(
      harness.service.loginWithGoogle({ subject: "sub-1", email: "staff@example.com", displayName: "Nhân viên" }),
      "password_sign_in_required",
      403,
    );
  });

  it("refuses an employee with a wrong password with the reason, and no account id for an unknown email", async () => {
    const harness = createHarness();
    const employee = await addAccount(harness);

    const wrongPassword = await expectRefusal(
      harness.service.login({ email: employee.email, password: "wrong password here", audience: "employee" }),
      "request_failed",
      401,
    );
    expect(wrongPassword.reason).toBe("invalid_credentials");
    expect(wrongPassword.accountId).toBe(employee.id);

    const unknown = await expectRefusal(
      harness.service.login({ email: "nobody@example.com", password, audience: "employee" }),
      "request_failed",
      401,
    );
    expect(unknown.reason).toBe("invalid_credentials");
    expect(unknown.accountId).toBeUndefined();
  });
});

describe("administrator changes", () => {
  it("refuses every change an administrator makes to their own account", async () => {
    const harness = createHarness();
    const admin = await addAdmin(harness);

    const selfDetails = [
      await expectRefusal(
        harness.service.updateUserAccess(admin.id, admin.id, ["Platform Admin"], []),
        "self_change_forbidden",
        403,
      ),
      await expectRefusal(
        harness.service.resetUserPassword(admin.id, admin.id, "a brand new phrase"),
        "self_change_forbidden",
        403,
      ),
      await expectRefusal(harness.service.revokeAllSessions(admin.id, admin.id), "self_change_forbidden", 403),
      await expectRefusal(harness.service.deactivateEmployee(admin.id, admin.id), "self_change_forbidden", 403),
    ];
    expect(selfDetails.map((error) => error.detail)).toEqual([
      "Bạn không thể tự đổi quyền của mình.",
      "Bạn không thể tự đặt lại mật khẩu của mình tại đây.",
      "Bạn không thể tự đăng xuất các phiên của mình tại đây.",
      "Bạn không thể tự vô hiệu hóa tài khoản của mình.",
    ]);
    expect(harness.entries).toEqual([]);
  });

  it("keeps a Platform Admin from being turned off or stripped while they are the last active one", async () => {
    const harness = createHarness();
    const onlyAdmin = await addAdmin(harness);
    const inactiveAdmin = await addAccount(harness, {
      email: "old-admin@example.com",
      isActive: false,
      roles: ["Platform Admin"],
      siteIds: [],
    });

    // The acting administrator is a different account from the target, so only the last-admin guard can refuse.
    await expectRefusal(
      harness.service.deactivateEmployee("00000000-0000-4000-8000-0000000000c9", onlyAdmin.id),
      "last_platform_admin",
      409,
    );
    await expectRefusal(
      harness.service.updateUserAccess(
        "00000000-0000-4000-8000-0000000000c9",
        onlyAdmin.id,
        ["Pharmacist"],
        ["00000000-0000-4000-8000-0000000000b1"],
      ),
      "last_platform_admin",
      409,
    );
    // An inactive administrator is not an active one, so their own role may change without leaving no admin behind.
    await expect(
      harness.service.updateUserAccess(
        onlyAdmin.id,
        inactiveAdmin.id,
        ["Pharmacist"],
        ["00000000-0000-4000-8000-0000000000b1"],
      ),
    ).resolves.toMatchObject({ roles: ["Pharmacist"] });
  });

  it("allows a Platform Admin to be turned off while another active Platform Admin remains", async () => {
    const harness = createHarness();
    const admin = await addAdmin(harness);
    const other = await addAccount(harness, {
      email: "other-admin@example.com",
      roles: ["Platform Admin"],
      siteIds: [],
    });

    await harness.service.deactivateEmployee(admin.id, other.id);

    expect((await harness.accounts.findById(other.id))?.isActive).toBe(false);
  });

  it("refuses an access grant with no role, a non-admin grant with no site, and an unknown role", async () => {
    const harness = createHarness();
    const admin = await addAdmin(harness);
    const employee = await addAccount(harness);
    const site = "00000000-0000-4000-8000-0000000000b1";

    const noRole = await expectRefusal(
      harness.service.updateUserAccess(admin.id, employee.id, [], [site]),
      "role_required",
      400,
    );
    expect(noRole.detail).toBe("Chọn ít nhất một vai trò.");
    const noSite = await expectRefusal(
      harness.service.updateUserAccess(admin.id, employee.id, ["Pharmacist"], []),
      "site_required",
      400,
    );
    expect(noSite.detail).toBe("Chọn ít nhất một site.");
    const unknown = await expectRefusal(
      harness.service.updateUserAccess(admin.id, employee.id, ["Janitor"], [site]),
      "request_failed",
      400,
    );
    expect(unknown.detail).toBe("Vai trò không hợp lệ.");

    // A Platform Admin needs no site.
    await expect(
      harness.service.updateUserAccess(admin.id, employee.id, ["Platform Admin"], []),
    ).resolves.toMatchObject({
      roles: ["Platform Admin"],
      siteIds: [],
    });
  });

  it("refuses a new employee with no role, no site for a non-admin, or an email in use", async () => {
    const harness = createHarness();
    const admin = await addAdmin(harness);
    const site = "00000000-0000-4000-8000-0000000000b1";
    const base = { password, displayName: "Mới" };

    await expectRefusal(
      harness.service.createEmployee(admin.id, { ...base, email: "new@example.com", roles: [], siteIds: [site] }),
      "role_required",
      400,
    );
    await expectRefusal(
      harness.service.createEmployee(admin.id, {
        ...base,
        email: "new@example.com",
        roles: ["Pharmacist"],
        siteIds: [],
      }),
      "site_required",
      400,
    );
    await addAccount(harness, { email: "taken@example.com" });
    const taken = await expectRefusal(
      harness.service.createEmployee(admin.id, {
        ...base,
        email: "taken@example.com",
        roles: ["Pharmacist"],
        siteIds: [site],
      }),
      "conflict",
      409,
    );
    expect(taken.detail).toBe("Email này đã có tài khoản.");
  });

  it("creates an employee who must change the password, and audits the grant without the password", async () => {
    const harness = createHarness();
    const admin = await addAdmin(harness);
    const site = "00000000-0000-4000-8000-0000000000b1";

    const created = await harness.service.createEmployee(admin.id, {
      email: "new@example.com",
      password: "a-secret-password-1",
      displayName: "Mới",
      roles: ["Pharmacist"],
      siteIds: [site],
    });

    expect(created).toMatchObject({ mustChangePassword: true, isActive: true, roles: ["Pharmacist"] });
    expect(harness.entries).toEqual([
      {
        action: "identity.user.created",
        entityType: "user",
        entityId: created.id,
        actorId: admin.id,
        details: { roles: "Pharmacist", sites: 1 },
      },
    ]);
    expect(JSON.stringify(harness.entries)).not.toContain("a-secret-password-1");
  });

  it("answers 404 for a customer id on every administrator route", async () => {
    const harness = createHarness();
    const admin = await addAdmin(harness);
    const customer = await addAccount(harness, { actorType: "customer", roles: [], siteIds: [] });
    const site = "00000000-0000-4000-8000-0000000000b1";

    for (const attempt of [
      harness.service.updateUserAccess(admin.id, customer.id, ["Pharmacist"], [site]),
      harness.service.resetUserPassword(admin.id, customer.id, "a brand new phrase"),
      harness.service.revokeAllSessions(admin.id, customer.id),
      harness.service.deactivateEmployee(admin.id, customer.id),
      harness.service.activateEmployee(admin.id, customer.id),
    ]) {
      await expectRefusal(attempt, "employee_not_found", 404);
    }
    expect((await harness.accounts.findById(customer.id))?.isActive).toBe(true);
  });

  it("lists employees only, narrowed by status when asked", async () => {
    const harness = createHarness();
    const admin = await addAdmin(harness);
    const employee = await addAccount(harness);
    await addAccount(harness, { actorType: "customer", roles: [], siteIds: [], email: "shopper@example.com" });
    await harness.service.deactivateEmployee(admin.id, employee.id);

    const everyone = await harness.service.listUsers();
    expect(everyone.map((account) => account.actorType)).toEqual(["employee", "employee"]);
    expect((await harness.service.listUsers("deactivated")).map((account) => account.id)).toEqual([employee.id]);
    expect((await harness.service.listUsers("active")).map((account) => account.id)).toEqual([admin.id]);
  });

  it("resets a password, flags it for change, ends the sessions and audits without the password", async () => {
    const harness = createHarness();
    const admin = await addAdmin(harness);
    const employee = await addAccount(harness);
    const session = await harness.service.login({ email: employee.email, password });

    await harness.service.resetUserPassword(admin.id, employee.id, "a brand new phrase");

    expect(await harness.service.currentSession(session.session.rawToken)).toBeUndefined();
    const reflagged = await harness.accounts.findById(employee.id);
    expect(reflagged?.mustChangePassword).toBe(true);
    await expect(
      harness.service.login({ email: employee.email, password: "a brand new phrase" }),
    ).resolves.toBeDefined();
    expect(harness.entries.map((entry) => entry.action)).toEqual(["identity.user.password-reset"]);
    expect(JSON.stringify(harness.entries)).not.toContain("brand new phrase");
  });

  it("clears the change flag when the holder changes the password, and ends their sessions", async () => {
    const harness = createHarness();
    const employee = await addAccount(harness, { mustChangePassword: true });
    const session = await harness.service.login({ email: employee.email, password });

    await harness.service.changePassword(employee.id, password, "a brand new phrase");

    expect(await harness.service.currentSession(session.session.rawToken)).toBeUndefined();
    expect((await harness.accounts.findById(employee.id))?.mustChangePassword).toBe(false);
    expect(harness.entries.map((entry) => entry.action)).toEqual(["identity.account.password-changed"]);
  });

  it("refuses the change and its audit entry together when the entry cannot be written", async () => {
    const harness = createHarness({
      record: async () => {
        throw new Error("outbox unavailable");
      },
    });
    const admin = await addAdmin(harness);
    const employee = await addAccount(harness);

    await expectRefusal(
      harness.service.updateUserAccess(
        admin.id,
        employee.id,
        ["Warehouse Staff"],
        ["00000000-0000-4000-8000-0000000000b1"],
      ),
      "audit_unavailable",
      503,
    );
  });

  it("revokes the sessions of a deactivated account in the same change that turns it off", async () => {
    const harness = createHarness();
    const admin = await addAdmin(harness);
    const employee = await addAccount(harness);
    const session = await harness.service.login({ email: employee.email, password });

    await harness.service.deactivateEmployee(admin.id, employee.id);

    expect(await harness.sessions.findActive(session.session.rawToken)).toBeUndefined();
    expect(harness.entries.map((entry) => [entry.action, entry.entityId, entry.actorId])).toEqual([
      ["identity.user.deactivated", employee.id, admin.id],
    ]);
  });
});

describe("customer lookup", () => {
  const createService = (accountRepository: InMemoryAccountRepository): AccountService => {
    const sessions = new InMemorySessionRepository();
    return new AccountService(
      accountRepository,
      sessions,
      hasher,
      new VerificationTokenService(),
      sender,
      createInMemoryUnitOfWork(accountRepository, sessions),
    );
  };

  const createAccount = (
    accountRepository: InMemoryAccountRepository,
    input: {
      actorType: "customer" | "employee";
      email: string;
      displayName: string;
      phoneNumber?: string;
      isActive?: boolean;
    },
  ) => {
    const roles = input.actorType === "employee" ? ["Pharmacist"] : [];
    return accountRepository.create({
      actorType: input.actorType,
      isActive: input.isActive ?? true,
      mustChangePassword: false,
      email: input.email,
      displayName: input.displayName,
      passwordHash: "hash",
      ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
      roles,
      siteIds: [],
    });
  };

  it("matches a customer by exact email or phone digits and never an employee", async () => {
    const accountRepository = new InMemoryAccountRepository();
    const service = createService(accountRepository);
    const customer = await createAccount(accountRepository, {
      actorType: "customer",
      email: "khach@example.com",
      displayName: "Nguyễn Thị B",
      phoneNumber: "0901 234 567",
    });
    await createAccount(accountRepository, {
      actorType: "employee",
      email: "duocsi@example.com",
      displayName: "Dược sĩ",
      phoneNumber: "0901234567",
    });

    const match = {
      id: customer.id,
      displayName: "Nguyễn Thị B",
      email: "khach@example.com",
      phoneNumber: "0901 234 567",
    };
    await expect(service.searchCustomers("  KHACH@Example.com  ")).resolves.toEqual([match]);
    // A spaced-out phone number is the same number as the digits it holds.
    await expect(service.searchCustomers("0901234567")).resolves.toEqual([match]);
    await expect(service.searchCustomers("0901 234 567")).resolves.toEqual([match]);
    // Counter staff never see a colleague, and a partial number is not a match.
    await expect(service.searchCustomers("duocsi@example.com")).resolves.toEqual([]);
    await expect(service.searchCustomers("0901")).resolves.toEqual([]);
  });

  it("finds a number stored in the country-code form from the local form", async () => {
    const accountRepository = new InMemoryAccountRepository();
    const service = createService(accountRepository);
    const customer = await createAccount(accountRepository, {
      actorType: "customer",
      email: "quoc-te@example.com",
      displayName: "Nguyễn Văn A",
      phoneNumber: "+84 901 234 567",
    });

    // The patient reads the number as `0901 234 567`, the account stores the same subscriber number with `+84`.
    await expect(service.searchCustomers("0901234567")).resolves.toEqual([
      {
        id: customer.id,
        displayName: "Nguyễn Văn A",
        email: "quoc-te@example.com",
        phoneNumber: "+84 901 234 567",
      },
    ]);
  });

  it("finds a number stored in the local form from the country-code form", async () => {
    const accountRepository = new InMemoryAccountRepository();
    const service = createService(accountRepository);
    const customer = await createAccount(accountRepository, {
      actorType: "customer",
      email: "noi-dia@example.com",
      displayName: "Trần Thị B",
      phoneNumber: "0901-234-567",
    });

    await expect(service.searchCustomers("+84901234567")).resolves.toEqual([
      {
        id: customer.id,
        displayName: "Trần Thị B",
        email: "noi-dia@example.com",
        phoneNumber: "0901-234-567",
      },
    ]);
  });

  it("caps the lookup at five accounts", async () => {
    const accountRepository = new InMemoryAccountRepository();
    const service = createService(accountRepository);
    for (let index = 0; index < 6; index += 1) {
      await createAccount(accountRepository, {
        actorType: "customer",
        email: `khach${index}@example.com`,
        displayName: `Khách ${index}`,
        phoneNumber: "0901234567",
      });
    }

    await expect(service.searchCustomers("0901234567")).resolves.toHaveLength(5);
  });

  it("resolves only an active customer account for a service caller, with its phone", async () => {
    const accountRepository = new InMemoryAccountRepository();
    const service = createService(accountRepository);
    const customer = await createAccount(accountRepository, {
      actorType: "customer",
      email: "khach@example.com",
      displayName: "Nguyễn Thị B",
      phoneNumber: "0901234567",
    });
    const employee = await createAccount(accountRepository, {
      actorType: "employee",
      email: "duocsi@example.com",
      displayName: "Dược sĩ",
    });

    await expect(service.findActiveCustomer(customer.id)).resolves.toEqual({
      id: customer.id,
      displayName: "Nguyễn Thị B",
      phoneNumber: "0901234567",
    });
    await expect(service.findActiveCustomer(employee.id)).resolves.toBeUndefined();
    await expect(service.findActiveCustomer("00000000-0000-4000-8000-000000000009")).resolves.toBeUndefined();
  });

  it("resolves a batch of customers, leaving out employees, inactive and unknown ids", async () => {
    const accountRepository = new InMemoryAccountRepository();
    const service = createService(accountRepository);
    const customer = await createAccount(accountRepository, {
      actorType: "customer",
      email: "khach@example.com",
      displayName: "Nguyễn Thị B",
    });
    const inactive = await createAccount(accountRepository, {
      actorType: "customer",
      email: "nghi@example.com",
      displayName: "Lê Thị C",
      isActive: false,
    });
    const employee = await createAccount(accountRepository, {
      actorType: "employee",
      email: "duocsi@example.com",
      displayName: "Dược sĩ",
    });

    await expect(
      service.findActiveCustomers([
        customer.id,
        customer.id,
        inactive.id,
        employee.id,
        "00000000-0000-4000-8000-000000000009",
      ]),
    ).resolves.toEqual([{ id: customer.id, displayName: "Nguyễn Thị B", phoneNumber: null }]);
  });

  it("leaves a deactivated customer out of the lookup and the service read", async () => {
    const accountRepository = new InMemoryAccountRepository();
    const service = createService(accountRepository);
    const deactivated = await createAccount(accountRepository, {
      actorType: "customer",
      email: "nghi@example.com",
      displayName: "Lê Thị C",
      phoneNumber: "0901234567",
      isActive: false,
    });
    const active = await createAccount(accountRepository, {
      actorType: "customer",
      email: "dang-lam@example.com",
      displayName: "Phạm Văn D",
      phoneNumber: "0901234567",
    });

    // The active colleague holding the same number is the only match the counter picker may return.
    await expect(service.searchCustomers("0901234567")).resolves.toEqual([
      {
        id: active.id,
        displayName: "Phạm Văn D",
        email: "dang-lam@example.com",
        phoneNumber: "0901234567",
      },
    ]);
    await expect(service.searchCustomers("nghi@example.com")).resolves.toEqual([]);
    await expect(service.findActiveCustomer(deactivated.id)).resolves.toBeUndefined();
  });
});

describe("staff directory", () => {
  const siteA = "00000000-0000-4000-8000-0000000000e1";
  const siteB = "00000000-0000-4000-8000-0000000000e2";

  it("lists active employees by name, narrowed to those sharing a site, and never a customer or a deactivated account", async () => {
    const harness = createHarness();
    const manager = await addAccount(harness, {
      displayName: "Quản lý",
      roles: ["Pharmacy Manager"],
      siteIds: [siteA],
    });
    const pharmacist = await addAccount(harness, {
      displayName: "Dược sĩ",
      roles: ["Pharmacist"],
      siteIds: [siteA, siteB],
    });
    const warehouse = await addAccount(harness, {
      displayName: "Kho hàng",
      roles: ["Warehouse Staff"],
      siteIds: [siteB],
    });
    await addAccount(harness, { displayName: "Nghỉ việc", siteIds: [siteA], isActive: false });
    await addAccount(harness, { actorType: "customer", displayName: "Khách", roles: [], siteIds: [siteA] });

    const everyone = await harness.service.listActiveEmployees();
    expect(everyone.map((member) => member.id)).toEqual([pharmacist.id, warehouse.id, manager.id]);
    expect((await harness.service.listActiveEmployees([siteA])).map((member) => member.id)).toEqual([
      pharmacist.id,
      manager.id,
    ]);
    expect((await harness.service.listActiveEmployees([siteB])).map((member) => member.id)).toEqual([
      pharmacist.id,
      warehouse.id,
    ]);
    await expect(harness.service.listActiveEmployees([])).resolves.toEqual([]);
  });

  it("answers only the name, roles and sites of an employee, never the contact details", async () => {
    const harness = createHarness();
    const employee = await addAccount(harness, {
      displayName: "Dược sĩ",
      phoneNumber: "0901234567",
      roles: ["Pharmacist"],
      siteIds: [siteA],
    });

    const [member] = await harness.service.listActiveEmployees();
    expect(member).toEqual({ id: employee.id, displayName: "Dược sĩ", roles: ["Pharmacist"], siteIds: [siteA] });
  });

  it("finds one active employee by id and refuses a customer, a deactivated employee and an unknown id", async () => {
    const harness = createHarness();
    const employee = await addAccount(harness, { displayName: "Dược sĩ", roles: ["Pharmacist"], siteIds: [siteA] });
    const deactivated = await addAccount(harness, { isActive: false });
    const shopper = await addAccount(harness, { actorType: "customer", roles: [] });

    await expect(harness.service.findActiveEmployee(employee.id)).resolves.toEqual({
      id: employee.id,
      displayName: "Dược sĩ",
      roles: ["Pharmacist"],
      siteIds: [siteA],
    });
    await expect(harness.service.findActiveEmployee(deactivated.id)).resolves.toBeUndefined();
    await expect(harness.service.findActiveEmployee(shopper.id)).resolves.toBeUndefined();
    await expect(harness.service.findActiveEmployee("00000000-0000-4000-8000-000000000009")).resolves.toBeUndefined();
  });
});
