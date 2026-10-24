/**
 * The unauthenticated routes a password, token, or account can be guessed through. `setup-admin` is absent because it
 * answers 409 after the first administrator exists, and `change-password` is absent because it already requires a
 * session.
 */
export type AuthRateLimitAction = "login" | "register" | "request-password-reset" | "reset-password" | "verify-email";

/**
 * The outcome of one attempt. A refused attempt is never recorded. An admitted attempt is recorded until `withdraw`
 * removes it. The login route withdraws after a successful sign-in, so only failed sign-ins spend the budget.
 */
export type AuthAdmission =
  | { admitted: false; retryAfterSeconds: number }
  | { admitted: true; withdraw: () => Promise<void> };

export interface AuthRateLimiter {
  /**
   * Checks the bucket and, when the attempt may go ahead, records it in the same step, so concurrent attempts cannot
   * overshoot the limit.
   */
  admit(action: AuthRateLimitAction, subject: string, clientIp: string): Promise<AuthAdmission>;
}

/**
 * The counter store could not be read or written. Credential checks must not run unmetered, so the route refuses the
 * attempt instead.
 */
export class AuthRateLimiterError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthRateLimiterError";
  }
}
