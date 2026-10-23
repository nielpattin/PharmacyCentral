import { exec, firstLine } from "./exec.mjs";

/** Runs `docker compose <args>` from the repository root and returns stdout; a non-zero exit throws. */
export async function composeCli(args, options) {
  const result = await exec("docker", ["compose", ...args], options);
  if (result.code !== 0) {
    throw new Error(`docker compose ${args.join(" ")} failed: ${firstLine(result.stderr)}`);
  }
  return result.stdout;
}

/** The container of one service (stopped ones included): `{ service, state, health }`, or undefined when none exists. */
export async function containerOf(service) {
  const out = (await composeCli(["ps", "--all", "--format", "json", service])).trim();
  if (out === "") return undefined;
  // Compose prints a JSON array in recent releases and one object per line in older ones.
  const rows = out.startsWith("[")
    ? JSON.parse(out)
    : out
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line));
  const row = rows.find((item) => item.Service === service);
  return row ? { service, state: row.State, health: row.Health ?? "" } : undefined;
}

/** Waits until a service is running and, when it has a healthcheck, healthy. */
export async function waitHealthy(service, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await containerOf(service);
    if (last?.state === "running" && (last.health === "" || last.health === "healthy")) return last;
    if (Date.now() >= deadline) {
      throw new Error(
        `${service} not healthy within ${Math.round(timeoutMs / 1000)}s; last state ${last?.state ?? "missing"}/${last?.health ?? "-"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
