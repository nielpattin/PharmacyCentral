import { describe, expect, it } from "vitest";

import { AccountService } from "./account-service.ts";
import { InMemoryAccountRepository } from "../infrastructure/in-memory-account-repository.ts";
import { Argon2idPasswordHasher } from "../infrastructure/security/argon2id-password-hasher.ts";
import { InMemorySessionRepository } from "../../sessions/infrastructure/in-memory-session-repository.ts";
import { VerificationTokenService } from "../application/verification-token-service.ts";

const hasher = new Argon2idPasswordHasher({ memory: 19456, passes: 2, parallelism: 1, tagLength: 32 });

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
    const tokenService = new VerificationTokenService();
    const sentTokens: string[] = [];
    const service = new AccountService(accountRepository, new InMemorySessionRepository(), hasher, tokenService, {
      sendVerificationEmail: async ({ token }) => {
        sentTokens.push(token);
      },
    });

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
    const resetTokens: string[] = [];
    const service = new AccountService(
      accountRepository,
      new InMemorySessionRepository(),
      hasher,
      new VerificationTokenService(),
      {
        sendVerificationEmail: async () => undefined,
        sendPasswordResetEmail: async ({ token }) => {
          resetTokens.push(token);
        },
      },
    );

    const account = await accountRepository.create({
      actorType: "customer",
      isActive: true,
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
    const service = new AccountService(
      new InMemoryAccountRepository(),
      new InMemorySessionRepository(),
      hasher,
      new VerificationTokenService(),
      { sendVerificationEmail: async () => undefined },
    );

    const result = await service.createFirstAdmin({
      email: "admin@example.com",
      password: "correct horse battery staple",
      displayName: "Admin",
    });
    expect(result.account.roles).toEqual(["Platform Admin"]);
    await expect(
      service.createFirstAdmin({
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

describe("customer lookup", () => {
  const createService = (accountRepository: InMemoryAccountRepository): AccountService => {
    const sender = { sendVerificationEmail: async () => undefined };
    return new AccountService(
      accountRepository,
      new InMemorySessionRepository(),
      hasher,
      new VerificationTokenService(),
      sender,
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

  it("resolves only an active customer account for a service caller", async () => {
    const accountRepository = new InMemoryAccountRepository();
    const service = createService(accountRepository);
    const customer = await createAccount(accountRepository, {
      actorType: "customer",
      email: "khach@example.com",
      displayName: "Nguyễn Thị B",
    });
    const employee = await createAccount(accountRepository, {
      actorType: "employee",
      email: "duocsi@example.com",
      displayName: "Dược sĩ",
    });

    await expect(service.findActiveCustomer(customer.id)).resolves.toEqual({
      id: customer.id,
      displayName: "Nguyễn Thị B",
    });
    await expect(service.findActiveCustomer(employee.id)).resolves.toBeUndefined();
    await expect(service.findActiveCustomer("00000000-0000-4000-8000-000000000009")).resolves.toBeUndefined();
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
