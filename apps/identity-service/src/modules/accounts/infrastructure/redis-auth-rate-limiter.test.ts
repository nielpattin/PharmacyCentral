import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthRateLimiterError, type AuthAdmission } from "../domain/auth-rate-limit.ts";
import { authRateLimitKey, RedisAuthRateLimiter } from "./redis-auth-rate-limiter.ts";

const pause = async (ms: number): Promise<void> => {
  // Real wait on purpose: the window is measured by the Redis server clock (`TIME` in the script), which fake timers
  // in this process cannot advance.
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
};

const isAdmitted = (admission: AuthAdmission): admission is Extract<AuthAdmission, { admitted: true }> =>
  admission.admitted;

describe("authRateLimitKey", () => {
  it("keeps the email out of the key and treats case and spacing as one address", () => {
    const key = authRateLimitKey("login", "  Khach@Example.com ", "10.0.0.7");
    expect(key).not.toContain("khach");
    expect(key).not.toContain("example");
    expect(key).toBe(authRateLimitKey("login", "khach@example.com", "10.0.0.7"));
  });

  it("separates the action, the subject, and the client address", () => {
    const base = authRateLimitKey("login", "khach@example.com", "10.0.0.7");
    expect(authRateLimitKey("register", "khach@example.com", "10.0.0.7")).not.toBe(base);
    expect(authRateLimitKey("login", "other@example.com", "10.0.0.7")).not.toBe(base);
    expect(authRateLimitKey("login", "khach@example.com", "10.0.0.8")).not.toBe(base);
  });
});

describe("RedisAuthRateLimiter when the store is unreachable", () => {
  it("refuses the attempt rather than letting it through unmetered", async () => {
    const dead = new Redis({
      host: "127.0.0.1",
      port: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    const limiter = new RedisAuthRateLimiter(dead, { maxAttempts: 3, windowSeconds: 60 });

    await expect(limiter.admit("login", "khach@example.com", "10.0.0.7")).rejects.toBeInstanceOf(AuthRateLimiterError);
    dead.disconnect();
  });
});

// The sliding window lives in a Lua script, so these run against a real Redis when REDIS_URL is set.
const redisUrl = process.env.REDIS_URL;

describe.skipIf(!redisUrl)("RedisAuthRateLimiter against Redis", () => {
  let client: Redis;

  beforeAll(() => {
    if (!redisUrl) throw new Error("REDIS_URL is required for these tests");
    client = new Redis(redisUrl);
  });

  afterAll(() => {
    client.disconnect();
  });

  it("admits attempts up to the limit, then refuses with the seconds until the oldest one leaves", async () => {
    const limiter = new RedisAuthRateLimiter(client, { maxAttempts: 3, windowSeconds: 60 });
    const subject = `${randomUUID()}@example.com`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await limiter.admit("register", subject, "10.1.0.1")).admitted).toBe(true);
    }
    const refused = await limiter.admit("register", subject, "10.1.0.1");
    expect(refused).toMatchObject({ admitted: false });
    if (refused.admitted) throw new Error("the fourth attempt must be refused");
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("does not record a refused attempt, so withdrawing one admitted attempt reopens the bucket", async () => {
    const limiter = new RedisAuthRateLimiter(client, { maxAttempts: 1, windowSeconds: 60 });
    const subject = `${randomUUID()}@example.com`;

    const first = await limiter.admit("login", subject, "10.1.0.2");
    expect(first.admitted).toBe(true);
    expect((await limiter.admit("login", subject, "10.1.0.2")).admitted).toBe(false);
    if (!isAdmitted(first)) throw new Error("the first attempt must be admitted");
    await first.withdraw();

    expect((await limiter.admit("login", subject, "10.1.0.2")).admitted).toBe(true);
  });

  it("lets successful sign-ins through indefinitely, because each one withdraws its own attempt", async () => {
    const limiter = new RedisAuthRateLimiter(client, { maxAttempts: 2, windowSeconds: 60 });
    const subject = `${randomUUID()}@example.com`;

    for (let signIn = 0; signIn < 5; signIn += 1) {
      const admission = await limiter.admit("login", subject, "10.1.0.3");
      if (!isAdmitted(admission)) throw new Error("a successful sign-in must not be refused");
      await admission.withdraw();
    }
  });

  it("keeps failed sign-ins counted, so a success after failures under the limit is still admitted", async () => {
    const limiter = new RedisAuthRateLimiter(client, { maxAttempts: 3, windowSeconds: 60 });
    const subject = `${randomUUID()}@example.com`;

    expect((await limiter.admit("login", subject, "10.1.0.4")).admitted).toBe(true);
    expect((await limiter.admit("login", subject, "10.1.0.4")).admitted).toBe(true);
    const success = await limiter.admit("login", subject, "10.1.0.4");
    if (!isAdmitted(success)) throw new Error("the third attempt must be admitted");
    await success.withdraw();

    expect((await limiter.admit("login", subject, "10.1.0.4")).admitted).toBe(true);
    expect((await limiter.admit("login", subject, "10.1.0.4")).admitted).toBe(false);
  });

  it("admits exactly the limit when attempts arrive concurrently", async () => {
    const limiter = new RedisAuthRateLimiter(client, { maxAttempts: 3, windowSeconds: 60 });
    const subject = `${randomUUID()}@example.com`;

    const admissions = await Promise.all(Array.from({ length: 10 }, () => limiter.admit("login", subject, "10.1.0.5")));
    expect(admissions.filter((admission) => admission.admitted)).toHaveLength(3);
  });

  it("keeps different subjects, actions, and client addresses independent", async () => {
    const limiter = new RedisAuthRateLimiter(client, { maxAttempts: 1, windowSeconds: 60 });
    const subject = `${randomUUID()}@example.com`;
    const other = `${randomUUID()}@example.com`;

    expect((await limiter.admit("login", subject, "10.1.0.6")).admitted).toBe(true);
    expect((await limiter.admit("login", subject, "10.1.0.6")).admitted).toBe(false);
    expect((await limiter.admit("login", other, "10.1.0.6")).admitted).toBe(true);
    expect((await limiter.admit("login", subject, "10.1.0.7")).admitted).toBe(true);
    expect((await limiter.admit("register", subject, "10.1.0.6")).admitted).toBe(true);
  });

  it("lets attempts through again once the window has passed", async () => {
    const limiter = new RedisAuthRateLimiter(client, { maxAttempts: 1, windowSeconds: 1 });
    const subject = `${randomUUID()}@example.com`;

    expect((await limiter.admit("register", subject, "10.1.0.8")).admitted).toBe(true);
    expect((await limiter.admit("register", subject, "10.1.0.8")).admitted).toBe(false);
    await pause(1_100);
    expect((await limiter.admit("register", subject, "10.1.0.8")).admitted).toBe(true);
  });
});
