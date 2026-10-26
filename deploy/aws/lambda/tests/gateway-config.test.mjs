import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Guards the local nginx gateways against forwarding client-supplied actor headers to a service (RFC 0003). The files
// are read as text because nginx itself is not available to the Lambda test run.
const gatewayDir = new URL("../../../local/gateway/", import.meta.url);
const read = (name) => readFileSync(new URL(name, gatewayDir), "utf8");

const serverGateways = ["nginx.conf", "nginx.dev.conf.template"];
const routesFile = "routes.conf";
const actorHeaders = ["X-Actor-Id", "X-Actor-Type", "X-Actor-Site-Ids"];
const includeLine = "include /etc/nginx/pharmacy-routes.conf;";

// Returns the text of the first `server { ... }` block, matching braces so nested blocks stay inside it.
const serverBlock = (text) => {
  const start = text.indexOf("server {");
  assert.notEqual(start, -1, "gateway has no server block");

  let depth = 0;
  for (let index = text.indexOf("{", start); index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error("gateway server block is not closed");
};

const emptyHeaderDirective = (header) => new RegExp(`^\\s*proxy_set_header\\s+${header}\\s+"";\\s*$`, "im");

describe("local gateway - client actor headers are stripped", () => {
  for (const file of serverGateways) {
    describe(file, () => {
      const text = read(file);
      const block = serverBlock(text);

      it("clears X-Actor-Id, X-Actor-Type and X-Actor-Site-Ids in the server block", () => {
        for (const header of actorHeaders) {
          assert.match(block, emptyHeaderDirective(header), `${header} is not cleared in the server block`);
        }
      });

      it("applies the server block to routes.conf by including it there", () => {
        assert.ok(block.includes(includeLine), "server block does not include the route table");
      });
    });
  }

  it("keeps the route table free of proxy_set_header so the server-level clears apply to every location", () => {
    assert.doesNotMatch(read(routesFile), /proxy_set_header/i);
  });

  it("does not strip the signed x-internal-identity-context header in any gateway file", () => {
    for (const file of [...serverGateways, routesFile]) {
      assert.doesNotMatch(read(file), /proxy_set_header\s+X-Internal-Identity-Context\b/i, file);
    }
  });
});
