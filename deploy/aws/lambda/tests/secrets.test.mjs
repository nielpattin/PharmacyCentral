import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createSecretsResolver,
  extractRegionFromArn,
  extractSecretValue,
  isSecretsManagerArn,
  loadSecretsManagerSdk,
  resolveSecret,
} from "../secrets.mjs";

describe("secrets - AWS Secrets Manager integration", () => {
  const sampleArn = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:pharmacy-central/staging/internal-identity-123456";
  const sampleServiceArn = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:pharmacy-central/staging/internal-service-654321";
  const govCloudArn = "arn:aws-us-gov:secretsmanager:us-gov-west-1:123456789012:secret:custom-secret-abcdef";

  describe("isSecretsManagerArn", () => {
    it("identifies valid Secrets Manager ARNs across partitions", () => {
      assert.equal(isSecretsManagerArn(sampleArn), true);
      assert.equal(isSecretsManagerArn(sampleServiceArn), true);
      assert.equal(isSecretsManagerArn(govCloudArn), true);
      assert.equal(isSecretsManagerArn("arn:aws-cn:secretsmanager:cn-north-1:123456789012:secret:my-secret"), true);
    });

    it("returns false for non-ARN strings, URLs, numbers, and null", () => {
      assert.equal(isSecretsManagerArn("plain-literal-secret"), false);
      assert.equal(isSecretsManagerArn("http://localhost:3001"), false);
      assert.equal(isSecretsManagerArn("arn:aws:s3:::my-bucket"), false);
      assert.equal(isSecretsManagerArn(""), false);
      assert.equal(isSecretsManagerArn(null), false);
      assert.equal(isSecretsManagerArn(undefined), false);
      assert.equal(isSecretsManagerArn(12345), false);
    });
  });

  describe("extractRegionFromArn", () => {
    it("extracts AWS region from valid ARN", () => {
      assert.equal(extractRegionFromArn(sampleArn), "ap-southeast-1");
      assert.equal(extractRegionFromArn(govCloudArn), "us-gov-west-1");
    });

    it("returns undefined for invalid ARN strings or non-strings", () => {
      assert.equal(extractRegionFromArn("not-an-arn"), undefined);
      assert.equal(extractRegionFromArn(""), undefined);
      assert.equal(extractRegionFromArn(null), undefined);
    });
  });

  describe("extractSecretValue", () => {
    it("returns plain text secret string as-is", () => {
      assert.equal(extractSecretValue("my-plain-secret"), "my-plain-secret");
      assert.equal(extractSecretValue({ SecretString: "my-plain-secret" }), "my-plain-secret");
    });

    it("extracts secret value by preferredKey from JSON payload", () => {
      const jsonPayload = JSON.stringify({
        INTERNAL_IDENTITY_SECRET: "identity-secret-value",
        OTHER_KEY: "other-value",
      });
      assert.equal(extractSecretValue(jsonPayload, "INTERNAL_IDENTITY_SECRET"), "identity-secret-value");
      assert.equal(
        extractSecretValue({ SecretString: jsonPayload }, "INTERNAL_IDENTITY_SECRET"),
        "identity-secret-value",
      );
    });

    it("extracts secret value from JSON payload using common key aliases", () => {
      assert.equal(extractSecretValue(JSON.stringify({ secret: "secret-val" })), "secret-val");
      assert.equal(extractSecretValue(JSON.stringify({ value: "value-val" })), "value-val");
      assert.equal(extractSecretValue(JSON.stringify({ password: "password-val" })), "password-val");
      assert.equal(extractSecretValue(JSON.stringify({ key: "key-val" })), "key-val");
      assert.equal(extractSecretValue(JSON.stringify({ token: "token-val" })), "token-val");
      assert.equal(extractSecretValue(JSON.stringify({ apiKey: "api-key-val" })), "api-key-val");
    });

    it("extracts secret value when JSON object has exactly one property", () => {
      assert.equal(extractSecretValue(JSON.stringify({ customProperty: "custom-val" })), "custom-val");
    });

    it("decodes SecretBinary payload when present", () => {
      const buffer = Buffer.from("binary-secret-value", "utf-8");
      assert.equal(extractSecretValue({ SecretBinary: buffer }), "binary-secret-value");
      assert.equal(extractSecretValue({ SecretBinary: buffer.toString("base64") }), "binary-secret-value");
    });

    it("returns empty string for null, undefined, or empty payload", () => {
      assert.equal(extractSecretValue(null), "");
      assert.equal(extractSecretValue(undefined), "");
      assert.equal(extractSecretValue("   "), "");
      assert.equal(extractSecretValue({}), "");
    });
  });

  describe("createSecretsResolver & lazy caching", () => {
    it("returns literal strings immediately without calling fetcher or client", async () => {
      let callCount = 0;
      const resolver = createSecretsResolver({
        fetchSecret: async () => {
          callCount++;
          return "fetched-secret";
        },
      });

      const secret = await resolver.resolveSecret("literal-secret-key");
      assert.equal(secret, "literal-secret-key");
      assert.equal(callCount, 0);
    });

    it("resolves secret ARN using injected fetchSecret and caches the result", async () => {
      let callCount = 0;
      const resolver = createSecretsResolver({
        fetchSecret: async (arn, key) => {
          callCount++;
          assert.equal(arn, sampleArn);
          assert.equal(key, "INTERNAL_IDENTITY_SECRET");
          return { SecretString: JSON.stringify({ INTERNAL_IDENTITY_SECRET: "resolved-identity-secret" }) };
        },
      });

      // First call: fetches and caches
      const first = await resolver.resolveSecret(sampleArn, "INTERNAL_IDENTITY_SECRET");
      assert.equal(first, "resolved-identity-secret");
      assert.equal(callCount, 1);

      // Second call: returns from cache
      const second = await resolver.resolveSecret(sampleArn, "INTERNAL_IDENTITY_SECRET");
      assert.equal(second, "resolved-identity-secret");
      assert.equal(callCount, 1);

      assert.equal(resolver.isCached(sampleArn), true);
    });

    it("resolves secret ARN using injected secretsClient with .send()", async () => {
      let sendCalls = 0;
      const mockClient = {
        send: async (command) => {
          sendCalls++;
          assert.equal(command.SecretId || command.input?.SecretId, sampleArn);
          return { SecretString: "secret-from-send" };
        },
      };

      const resolver = createSecretsResolver({
        secretsClient: mockClient,
      });

      const secret = await resolver.resolveSecret(sampleArn);
      assert.equal(secret, "secret-from-send");
      assert.equal(sendCalls, 1);

      // Cached on subsequent resolution
      const cached = await resolver.resolveSecret(sampleArn);
      assert.equal(cached, "secret-from-send");
      assert.equal(sendCalls, 1);
    });

    it("resolves secret ARN using injected secretsClient with .getSecretValue()", async () => {
      let getCalls = 0;
      const mockClient = {
        getSecretValue: async ({ SecretId }) => {
          getCalls++;
          assert.equal(SecretId, sampleArn);
          return { SecretString: "secret-from-get" };
        },
      };

      const resolver = createSecretsResolver({
        secretsClient: mockClient,
      });

      const secret = await resolver.resolveSecret(sampleArn);
      assert.equal(secret, "secret-from-get");
      assert.equal(getCalls, 1);
    });

    it("clearCache invalidates cached secrets so subsequent call fetches again", async () => {
      let callCount = 0;
      const resolver = createSecretsResolver({
        fetchSecret: async () => {
          callCount++;
          return `secret-version-${callCount}`;
        },
      });

      const first = await resolver.resolveSecret(sampleArn);
      assert.equal(first, "secret-version-1");
      assert.equal(callCount, 1);

      resolver.clearCache();
      assert.equal(resolver.isCached(sampleArn), false);

      const second = await resolver.resolveSecret(sampleArn);
      assert.equal(second, "secret-version-2");
      assert.equal(callCount, 2);
    });

    it("throws error when secret resolution returns an empty value", async () => {
      const resolver = createSecretsResolver({
        fetchSecret: async () => ({ SecretString: "" }),
      });

      await assert.rejects(
        () => resolver.resolveSecret(sampleArn),
        /Secret value resolved from Secrets Manager for ARN .* was empty/,
      );
    });

    it("throws error when SDK is unavailable and no client is injected for ARN", async () => {
      const resolver = createSecretsResolver({
        sdkLoader: async () => null,
      });

      await assert.rejects(
        () => resolver.resolveSecret(sampleArn),
        /AWS Secrets Manager SDK is not available/,
      );
    });

    it("returns empty string when valueOrArn is empty or undefined", async () => {
      const resolver = createSecretsResolver();
      assert.equal(await resolver.resolveSecret(""), "");
      assert.equal(await resolver.resolveSecret(undefined), "");
      assert.equal(await resolver.resolveSecret(null), "");
    });
  });

  describe("resolveSecret standalone helper", () => {
    it("resolves secret using standalone helper function", async () => {
      const result = await resolveSecret("my-standalone-secret");
      assert.equal(result, "my-standalone-secret");
    });
  });
});
