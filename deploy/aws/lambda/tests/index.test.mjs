import assert from "node:assert/strict";
import { test } from "node:test";

test("the Lambda entrypoint loads and exports both handlers", async () => {
  const entrypoint = await import("../index.mjs");
  assert.equal(typeof entrypoint.authorizerHandler, "function");
  assert.equal(typeof entrypoint.csrfHandler, "function");
});
