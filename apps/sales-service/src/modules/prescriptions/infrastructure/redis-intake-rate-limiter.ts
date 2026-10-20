import { randomUUID } from "node:crypto";

import type { Redis } from "ioredis";

import {
  PRESCRIPTION_INTAKE_RATE_LIMIT_WINDOWS,
  PrescriptionIntakeRateLimiterError,
  type PrescriptionIntakeRateLimiter,
} from "../domain/prescription-intake-rate-limiter.ts";

const KEY_PREFIX = "sales:prescription-intake";

/**
 * Counts an attempt in every window only when all of them have room, so a refused attempt spends no allowance.
 * The read and the write run as one Lua script. `TIME` reads the Redis server clock, so replicas with skewed clocks
 * still share one window.
 */
const CONSUME_SCRIPT = `
local clock = redis.call('TIME')
local nowMs = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local member = ARGV[1]
local waitSeconds = 0

for index = 1, #KEYS do
  local offset = 1 + (index - 1) * 2
  local limit = tonumber(ARGV[offset + 1])
  local windowMs = tonumber(ARGV[offset + 2])
  redis.call('ZREMRANGEBYSCORE', KEYS[index], '-inf', nowMs - windowMs)
  if redis.call('ZCARD', KEYS[index]) >= limit then
    local oldest = redis.call('ZRANGE', KEYS[index], 0, 0, 'WITHSCORES')
    local secondsUntilFree = math.ceil((tonumber(oldest[2]) + windowMs - nowMs) / 1000)
    if secondsUntilFree > waitSeconds then waitSeconds = secondsUntilFree end
  end
end

if waitSeconds > 0 then
  return waitSeconds
end

for index = 1, #KEYS do
  local windowMs = tonumber(ARGV[3 + (index - 1) * 2])
  redis.call('ZADD', KEYS[index], nowMs, member)
  redis.call('PEXPIRE', KEYS[index], windowMs)
end

return 0
`;

/**
 * Sliding windows counted in Redis, shared by every sales-service replica.
 *
 * Without a client the attempt cannot be counted, so `consume` refuses and intake stays closed rather than making
 * unmetered reader calls. The client is missing when the app runs without `REDIS_URL`.
 */
export class RedisIntakeRateLimiter implements PrescriptionIntakeRateLimiter {
  public constructor(private readonly client: Redis | undefined) {}

  public async consume(actorId: string): Promise<number | undefined> {
    const client = this.client;
    if (!client) throw new PrescriptionIntakeRateLimiterError("No Redis client is configured for intake limits");
    const keys = PRESCRIPTION_INTAKE_RATE_LIMIT_WINDOWS.map((window) => `${KEY_PREFIX}:${window.name}:${actorId}`);
    const args: string[] = [randomUUID()];
    for (const window of PRESCRIPTION_INTAKE_RATE_LIMIT_WINDOWS) {
      args.push(String(window.limit), String(window.seconds * 1_000));
    }
    let answer: unknown;
    try {
      answer = await client.eval(CONSUME_SCRIPT, keys.length, ...keys, ...args);
    } catch (error) {
      throw new PrescriptionIntakeRateLimiterError("Prescription intake rate limiter store is unavailable", {
        cause: error,
      });
    }
    if (typeof answer !== "number" || !Number.isInteger(answer) || answer < 0) {
      throw new PrescriptionIntakeRateLimiterError("Prescription intake rate limiter store is unavailable", {
        cause: new TypeError(`Intake limiter script answered ${String(answer)}`),
      });
    }
    return answer === 0 ? undefined : answer;
  }
}
