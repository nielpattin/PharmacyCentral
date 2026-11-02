import { createAccessTokenSigner, type AccessTokenSigner, type AccessTokenSignerOptions } from "@pharmacy/auth";

const missing = (name: string): Error =>
  new Error(`Missing required environment variable: ${name}. Run "pnpm run auth:keygen" and add its output to .env.`);

/**
 * Builds the access token signer from `ACCESS_TOKEN_PRIVATE_KEY` (PKCS#8 PEM, `\n` escapes allowed),
 * `ACCESS_TOKEN_PUBLIC_JWK` (JSON) and `ACCESS_TOKEN_KEY_ID`. A missing or malformed value stops startup, so the
 * service never runs unable to sign.
 */
export const createAccessTokenSignerFromEnv = async (
  env: Record<string, string | undefined> = process.env,
): Promise<AccessTokenSigner> => {
  const privateKey = env.ACCESS_TOKEN_PRIVATE_KEY;
  if (!privateKey) throw missing("ACCESS_TOKEN_PRIVATE_KEY");
  const publicJwkJson = env.ACCESS_TOKEN_PUBLIC_JWK;
  if (!publicJwkJson) throw missing("ACCESS_TOKEN_PUBLIC_JWK");
  const keyId = env.ACCESS_TOKEN_KEY_ID;
  if (!keyId) throw missing("ACCESS_TOKEN_KEY_ID");

  let publicJwk: unknown;
  try {
    publicJwk = JSON.parse(publicJwkJson);
  } catch {
    throw new Error("ACCESS_TOKEN_PUBLIC_JWK must be a JSON object.");
  }
  if (typeof publicJwk !== "object" || publicJwk === null || Array.isArray(publicJwk)) {
    throw new Error("ACCESS_TOKEN_PUBLIC_JWK must be a JSON object.");
  }

  try {
    return await createAccessTokenSigner({
      privateKeyPem: privateKey.replaceAll("\\n", "\n"),
      keyId,
      publicJwk: publicJwk as AccessTokenSignerOptions["publicJwk"],
    });
  } catch (error) {
    throw new Error("ACCESS_TOKEN_PRIVATE_KEY must be a PKCS#8 PEM ES256 private key.", { cause: error });
  }
};
