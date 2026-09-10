import { createLogger } from "../logger.ts";

import type { IdentityDatabase } from "../shared/infrastructure/database.ts";
import { DrizzleAccountRepository } from "../modules/accounts/infrastructure/drizzle-account-repository.ts";
import { DrizzleSessionRepository } from "../modules/sessions/infrastructure/drizzle-session-repository.ts";
import { AccountService } from "../modules/accounts/application/account-service.ts";
import { VerificationTokenService } from "../modules/accounts/application/verification-token-service.ts";
import { InMemoryAccountRepository } from "../modules/accounts/infrastructure/in-memory-account-repository.ts";
import {
  LoggingVerificationEmailSender,
  ResendVerificationEmailSender,
  SmtpVerificationEmailSender,
} from "../modules/accounts/infrastructure/email/verification-email-sender.ts";
import { Argon2idPasswordHasher } from "../modules/accounts/infrastructure/security/argon2id-password-hasher.ts";
import { GoogleOidcClient } from "../modules/accounts/infrastructure/security/google-oidc-client.ts";
import { InMemorySessionRepository } from "../modules/sessions/infrastructure/in-memory-session-repository.ts";

export const createGoogleOidcClient = (): GoogleOidcClient | undefined => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return undefined;
  }

  return new GoogleOidcClient({
    clientId,
    clientSecret,
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3001/auth/google/callback",
  });
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

  return new AccountService(
    database ? new DrizzleAccountRepository(database) : new InMemoryAccountRepository(),
    database ? new DrizzleSessionRepository(database) : new InMemorySessionRepository(),
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
  );
};
