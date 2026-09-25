/**
 * Some secrets in the root `.env` are written as `$$value$$` so Docker Compose hands a literal value
 * to a container. Compose unwraps them; Node's `--env-file` does not, so anything reading `.env`
 * directly (service dev runs, scripts) has to unwrap them the same way.
 */
export const unwrapEnvironmentEscaping = (value: string): string =>
  value.startsWith("$$") && value.endsWith("$$") ? value.slice(1, -1) : value;

export const requiredEnvironmentVariable = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Please set it in your .env file.`);
  return value;
};

export const requiredEnvironmentSecret = (name: string): string =>
  unwrapEnvironmentEscaping(requiredEnvironmentVariable(name));
