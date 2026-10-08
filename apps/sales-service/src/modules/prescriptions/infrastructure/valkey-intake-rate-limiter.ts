import { randomUUID } from "node:crypto";

import { Script, type GlideClient, type GlideReturnType } from "@valkey/valkey-glide";

import {
  PRESCRIPTION_INTAKE_RATE_LIMIT_WINDOWS,
  PrescriptionIntakeRateLimiterError,
  type PrescriptionIntakeRateLimiter,
} from "../domain/prescription-intake-rate-limiter.ts";

const KEY_PREFIX = "sales:prescription-intake";

/**
 * Counts an attempt in every window at once, and only when every window still has room for it.
 *
 * A window is a sorted set of the timestamps of the attempts that are still inside it. Each call drops the members
 * the window has outlived, then compares the cardinality with the limit; if any window is full the script returns
 * the wait and writes nothing, so a refusal spends no allowance anywhere and cannot push the block further away.
 * Only when every window has room does the attempt join all of them, and the lowest score of a full window is then
 * the instant that window frees a slot.
 *
 * `TIME` reads the clock of the Valkey server, so replicas with skewed clocks still share one window. The arguments
 * are the member, then a `limit` and a window length in milliseconds per key, in `KEYS` order. The script answers 0
 * when the attempt was counted, else the seconds until every full window frees a slot.
 */
const CONSUME_SCRIPT = new Script(`
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
`);

/**
 * Sliding windows counted in Valkey, the one store every sales-service replica shares.
 *
 * Each window holds one sorted set per actor, so the limit covers every span of that length rather than the span of
 * a clock bucket. The Lua script is the whole read-and-write, so two photos that arrive together cannot both see a
 * free slot. The key carries its window's length as an expiry, and a member is a fresh id, so an attempt never
 * overwrites an earlier one.
 *
 * The client may be missing because the app runs without `VALKEY_URL`. Without a store the attempts cannot be
 * counted, so `consume` refuses: photo intake stays closed instead of spending metered reader calls unmetered.
 */
export class ValkeyIntakeRateLimiter implements PrescriptionIntakeRateLimiter {
  public constructor(private readonly client: GlideClient | undefined) {}

  public async consume(actorId: string): Promise<number | undefined> {
    const client = this.client;
    if (!client) throw new PrescriptionIntakeRateLimiterError("No Valkey client is configured for intake limits");
    const keys = PRESCRIPTION_INTAKE_RATE_LIMIT_WINDOWS.map((window) => `${KEY_PREFIX}:${window.name}:${actorId}`);
    const args: string[] = [randomUUID()];
    for (const window of PRESCRIPTION_INTAKE_RATE_LIMIT_WINDOWS) {
      args.push(String(window.limit), String(window.seconds * 1_000));
    }
    let answer: GlideReturnType;
    try {
      answer = await client.invokeScript(CONSUME_SCRIPT, { keys, args });
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
