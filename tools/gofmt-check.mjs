import { spawn } from "node:child_process";

/**
 * Fails when any Go file in the current directory is not gofmt-formatted, and lists those files.
 * `gofmt -l` exits 0 even when it prints file names, so the printed list decides the result.
 */

const child = spawn("gofmt", ["-l", "."], { stdio: ["ignore", "pipe", "inherit"] });

let unformatted = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  unformatted += chunk;
});

child.once("error", (error) => {
  console.error(
    error.code === "ENOENT"
      ? "Go toolchain not found: install Go 1.26 or newer (`gofmt` is not on PATH)."
      : error.message,
  );
  process.exit(1);
});

child.once("close", (code, signal) => {
  if (signal || code !== 0) {
    console.error(`gofmt failed (${signal ?? `exit code ${code}`}).`);
    process.exit(1);
  }
  const files = unformatted.split(/\r?\n/).filter((line) => line !== "");
  if (files.length === 0) return;
  console.error("These Go files are not gofmt-formatted (run `gofmt -w` on them):");
  for (const file of files) console.error(`  ${file}`);
  process.exit(1);
});
