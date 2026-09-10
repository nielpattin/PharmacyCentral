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
