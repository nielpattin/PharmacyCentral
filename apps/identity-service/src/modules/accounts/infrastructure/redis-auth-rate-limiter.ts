import { createHash, randomUUID } from "node:crypto";

import type { Redis } from "ioredis";

import {
  AuthRateLimiterError,
  type AuthAdmission,
  type AuthRateLimitAction,
  type AuthRateLimiter,
} from "../domain/auth-rate-limit.ts";

const KEY_PREFIX = "identity:auth-limit";

/**
 * The read, the prune, and the write run as one script. `TIME` reads the Redis server clock, so every identity-service
 * replica shares one window even when their own clocks drift. A refused attempt is never added to the set, so
 * retrying while blocked does not extend the block.
 */
const ADMIT_SCRIPT = `
local clock = redis.call('TIME')
local nowMs = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local windowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', nowMs - windowMs)
if redis.call('ZCARD', KEYS[1]) >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return math.ceil((tonumber(oldest[2]) + windowMs - nowMs) / 1000)
end

redis.call('ZADD', KEYS[1], nowMs, ARGV[3])
redis.call('PEXPIRE', KEYS[1], windowMs)
return 0
`;

export type AuthRateLimitPolicy = {
  /** Attempts allowed in any span of `windowSeconds`. */
  maxAttempts: number;
  windowSeconds: number;
};

/**
 * The Redis key for one bucket. The subject is an email for login, register, and password reset, or an account id for
 * the token routes. It is hashed, so no address is stored in plain text. The client address stays readable because the
 * key expires with its window.
 */
export const authRateLimitKey = (action: AuthRateLimitAction, subject: string, clientIp: string): string => {
  const subjectDigest = createHash("sha256").update(subject.trim().toLowerCase()).digest("hex");
  return `${KEY_PREFIX}:${action}:${subjectDigest}:${clientIp}`;
};

/** Sliding-window attempt counter shared by every identity-service replica. */
export class RedisAuthRateLimiter implements AuthRateLimiter {
  public constructor(
    private readonly client: Redis,
    private readonly policy: AuthRateLimitPolicy,
  ) {}

  public async admit(action: AuthRateLimitAction, subject: string, clientIp: string): Promise<AuthAdmission> {
    const key = authRateLimitKey(action, subject, clientIp);
    const member = randomUUID();
    let answer: unknown;
    try {
      answer = await this.client.eval(
        ADMIT_SCRIPT,
        1,
        key,
        String(this.policy.windowSeconds * 1_000),
        String(this.policy.maxAttempts),
        member,
      );
    } catch (error) {
      throw new AuthRateLimiterError("Auth rate limiter store is unavailable", { cause: error });
    }
    if (typeof answer !== "number" || !Number.isInteger(answer) || answer < 0) {
      throw new AuthRateLimiterError("Auth rate limiter store is unavailable", {
        cause: new TypeError(`Auth limiter script answered ${String(answer)}`),
      });
    }
    if (answer > 0) return { admitted: false, retryAfterSeconds: answer };
    return { admitted: true, withdraw: () => this.withdraw(key, member) };
  }

  private async withdraw(key: string, member: string): Promise<void> {
    try {
      await this.client.zrem(key, member);
    } catch (error) {
      throw new AuthRateLimiterError("Auth rate limiter store is unavailable", { cause: error });
    }
  }
}
