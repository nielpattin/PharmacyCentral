/** Reads a required environment variable. There are no fallbacks: a missing value stops the run before any fault. */
export function requiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
