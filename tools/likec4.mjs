import { spawn } from "node:child_process";

/**
 * Runs the LikeC4 CLI for the architecture diagrams of docs/diagrams.
 *
 * Two things stand between the plain CLI and a working preview on a public registry:
 *
 * - The app of LikeC4 1.60.0 loads an optional AI layout helper as soon as a provider key is in
 *   the environment. It installs that helper from inside the package folder of the CLI, and the
 *   dependency tree of that folder holds the private @likec4/devops package, so the install fails
 *   on a public registry and the command stops with "Install package '@tanstack/ai' manually". The
 *   helper is optional, so the provider keys are removed from the environment of the child process.
 * - pnpm asks on the console which packages may run their build scripts during the install, which
 *   blocks a preview that is started without a terminal, so the one package that needs it is
 *   allowed up front.
 */

const aiProviderEnv = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OLLAMA_HOST",
  "MINIMAX_API_KEY",
];

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node tools/likec4.mjs <command> [args...]");
  process.exit(2);
}

const childEnv = { ...process.env };
for (const key of aiProviderEnv) delete childEnv[key];

const likec4Args = ["dlx", "--allow-build", "esbuild", "likec4@1.60.0", ...args];
const quote = (part) => (/[\s"]/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part);

const child =
  process.platform === "win32"
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", ["pnpm", ...likec4Args].map(quote).join(" ")], {
        stdio: "inherit",
        env: childEnv,
      })
    : spawn("pnpm", likec4Args, { stdio: "inherit", env: childEnv });

child.once("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
