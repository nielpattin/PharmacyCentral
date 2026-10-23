import { requiredEnv } from "./env.mjs";
import { exec, firstLine } from "./exec.mjs";

const DATABASE = /^[a-z_]+$/;

/** One psql query inside the postgres container, unaligned and without headers. Errors throw. */
export async function sql(db, query) {
  if (!DATABASE.test(db)) throw new Error(`Invalid database name: ${db}`);
  const user = requiredEnv("POSTGRES_USER");
  const result = await exec(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-U", user, "-d", db, "-X", "-v", "ON_ERROR_STOP=1", "-tAc", query],
    { timeoutMs: 60_000 },
  );
  if (result.code !== 0) throw new Error(`psql on ${db} failed: ${firstLine(result.stderr)}`);
  return result.stdout.trim();
}

export async function sqlNumber(db, query) {
  const out = await sql(db, query);
  const value = Number(out);
  if (out === "" || Number.isNaN(value)) throw new Error(`Expected a number from ${db}, got "${out.slice(0, 120)}"`);
  return value;
}

/** For queries that select one `json` value, e.g. `select coalesce(json_agg(t), '[]') from (...) t`. */
export async function sqlJson(db, query) {
  const out = await sql(db, query);
  return out === "" ? null : JSON.parse(out);
}
