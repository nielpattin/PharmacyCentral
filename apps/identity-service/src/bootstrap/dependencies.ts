import { createLogger } from "../logger.ts";

import type { IdentityDatabase } from "../shared/infrastructure/database.ts";
import { Redis } from "ioredis";
import { DrizzleAccountRepository } from "../modules/accounts/infrastructure/drizzle-account-repository.ts";
import { AccountService } from "../modules/accounts/application/account-service.ts";
import { VerificationTokenService } from "../modules/accounts/application/verification-token-service.ts";
import { InMemoryAccountRepository } from "../modules/accounts/infrastructure/in-memory-account-repository.ts";
import type { AuthRateLimiter } from "../modules/accounts/domain/auth-rate-limit.ts";
import { RedisAuthRateLimiter } from "../modules/accounts/infrastructure/redis-auth-rate-limiter.ts";
import {
  LoggingVerificationEmailSender,
  ResendVerificationEmailSender,
  SmtpVerificationEmailSender,
} from "../modules/accounts/infrastructure/email/verification-email-sender.ts";
import { Argon2idPasswordHasher } from "../modules/accounts/infrastructure/security/argon2id-password-hasher.ts";
import { GoogleOidcClient, type GoogleSignIn } from "../modules/accounts/infrastructure/security/google-oidc-client.ts";
import { createDrizzleUnitOfWork, createInMemoryUnitOfWork } from "../modules/accounts/infrastructure/unit-of-work.ts";

export const createGoogleSignIn = (): GoogleSignIn | undefined => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return undefined;
  }
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!redirectUri)
    throw new Error("Missing required environment variable: GOOGLE_REDIRECT_URI. Please set it in your .env file.");

  const appUrl = process.env.PUBLIC_APP_URL;
  if (!appUrl)
    throw new Error("Missing required environment variable: PUBLIC_APP_URL. Please set it in your .env file.");

  return { client: new GoogleOidcClient({ clientId, clientSecret, redirectUri }), redirectUri, appUrl };
};

/**
 * The attempt limit for the credential routes, counted in Redis. The variables have no defaults: a missing or malformed
 * value stops startup, so guessing is never left unlimited by accident.
 */
export const createAuthRateLimit = (): { limiter: AuthRateLimiter; redis: Redis } => {
  const logger = createLogger({ name: "identity-service" });
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("Missing required environment variable: REDIS_URL. Please set it in your .env file.");
  const maxAttempts = readPositiveIntegerEnv("AUTH_RATE_LIMIT_MAX_ATTEMPTS");
  const windowSeconds = readPositiveIntegerEnv("AUTH_RATE_LIMIT_WINDOW_SECONDS");

  const redis = new Redis(redisUrl, { commandTimeout: 500 });
  redis.on("error", (error: unknown) => logger.warn({ error }, "Redis client error"));
  return { limiter: new RedisAuthRateLimiter(redis, { maxAttempts, windowSeconds }), redis };
};

/** Reads a variable that must be a whole number of at least 1. A missing or malformed value stops startup. */
export const readPositiveIntegerEnv = (name: string): number => {
  const raw = process.env[name];
  if (!raw) throw new Error(`Missing required environment variable: ${name}. Please set it in your .env file.`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer, got "${raw}".`);
  return value;
};

export const createAccountService = (database?: IdentityDatabase): AccountService => {
  const logger = createLogger({ name: "identity-service" });
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("Missing required environment variable: EMAIL_FROM. Please set it in your .env file.");
  const verificationBaseUrl = process.env.PUBLIC_APP_URL;
  if (!verificationBaseUrl)
    throw new Error("Missing required environment variable: PUBLIC_APP_URL. Please set it in your .env file.");
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) throw new Error("Missing required environment variable: SMTP_HOST. Please set it in your .env file.");
  const smtpPortStr = process.env.SMTP_PORT;
  if (!smtpPortStr)
    throw new Error("Missing required environment variable: SMTP_PORT. Please set it in your .env file.");
  const emailOptions = {
    from,
    verificationBaseUrl,
    resendApiKey: process.env.RESEND_API_KEY,
    smtpHost,
    smtpPort: Number.parseInt(smtpPortStr, 10),
  };
  const emailProvider = process.env.EMAIL_PROVIDER ?? (process.env.NODE_ENV === "production" ? "resend" : "smtp");
  const sender =
    emailProvider === "resend"
      ? new ResendVerificationEmailSender(emailOptions)
      : emailProvider === "log"
        ? new LoggingVerificationEmailSender((input) => logger.info(input, "verification email queued"))
        : new SmtpVerificationEmailSender(emailOptions);

  const accounts = database ? new DrizzleAccountRepository(database.db) : new InMemoryAccountRepository();
  return new AccountService(
    accounts,
    new Argon2idPasswordHasher({
      memory: Number.parseInt(
        process.env.ARGON2_MEMORY_KIB ??
          (() => {
            throw new Error(
              "Missing required environment variable: ARGON2_MEMORY_KIB. Please set it in your .env file.",
            );
          })(),
        10,
      ),
      passes: Number.parseInt(
        process.env.ARGON2_PASSES ??
          (() => {
            throw new Error("Missing required environment variable: ARGON2_PASSES. Please set it in your .env file.");
          })(),
        10,
      ),
      parallelism: Number.parseInt(
        process.env.ARGON2_PARALLELISM ??
          (() => {
            throw new Error(
              "Missing required environment variable: ARGON2_PARALLELISM. Please set it in your .env file.",
            );
          })(),
        10,
      ),
      tagLength: 32,
    }),
    new VerificationTokenService(),
    sender,
    database ? createDrizzleUnitOfWork(database) : createInMemoryUnitOfWork(accounts),
  );
};
