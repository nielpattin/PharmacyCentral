import {
  createLocalJWKSet,
  createRemoteJWKSet,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importPKCS8,
  jwtVerify,
  SignJWT,
} from "jose";
import type { JSONWebKeySet, JWK, JWTPayload } from "jose";

/** Access tokens are signed with ES256: identity-service holds the private key, every other service the public JWKS. */
export const ACCESS_TOKEN_ALGORITHM = "ES256";
export const ACCESS_TOKEN_ISSUER = "pharmacy-central";
export const ACCESS_TOKEN_AUDIENCE = "pharmacy-api";
/** Lifetime of an access token: one working day. There is no refresh token and no server-side session. */
export const ACCESS_TOKEN_TTL_SECONDS = 86_400;

/** What a verified access token says about the caller. */
export interface AccessIdentity {
  actorId: string;
  actorType: string;
  roles: string[];
  siteIds: string[];
  passwordChangeRequired: boolean;
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
}

export type AccessTokenInput = Pick<AccessIdentity, "actorId" | "actorType" | "roles" | "siteIds"> &
  Partial<Pick<AccessIdentity, "passwordChangeRequired">>;

export interface AccessTokenSignerOptions {
  /** PKCS#8 PEM of the ES256 private key. */
  privateKeyPem: string;
  keyId: string;
  /** The matching public key, published at the JWKS endpoint. */
  publicJwk: JWK;
  issuer?: string;
  audience?: string;
  ttlSeconds?: number;
}

export interface AccessTokenSigner {
  sign(input: AccessTokenInput, now?: Date): Promise<{ token: string; expiresAt: Date }>;
  jwks(): JSONWebKeySet;
}

export async function createAccessTokenSigner(options: AccessTokenSignerOptions): Promise<AccessTokenSigner> {
  const key = await importPKCS8(options.privateKeyPem, ACCESS_TOKEN_ALGORITHM);
  const issuer = options.issuer ?? ACCESS_TOKEN_ISSUER;
  const audience = options.audience ?? ACCESS_TOKEN_AUDIENCE;
  const ttlSeconds = options.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS;
  const publicJwk: JWK = { ...options.publicJwk, kid: options.keyId, alg: ACCESS_TOKEN_ALGORITHM, use: "sig" };
  return {
    async sign(input, now = new Date()) {
      const issuedAt = Math.floor(now.getTime() / 1000);
      const expiresAt = issuedAt + ttlSeconds;
      const token = await new SignJWT({
        actorType: input.actorType,
        roles: input.roles,
        siteIds: input.siteIds,
        ...(input.passwordChangeRequired ? { pcr: true } : {}),
      })
        .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM, kid: options.keyId, typ: "at+jwt" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(input.actorId)
        .setJti(crypto.randomUUID())
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(key);
      return { token, expiresAt: new Date(expiresAt * 1000) };
    },
    jwks: () => ({ keys: [publicJwk] }),
  };
}

export interface AccessTokenVerifierOptions {
  /** A JWKS endpoint (identity-service `/.well-known/jwks.json`) or a key set already in hand. */
  jwks: string | URL | JSONWebKeySet;
  issuer?: string;
  audience?: string;
  /** Clock skew tolerated on `exp` and `iat`, in seconds. */
  clockToleranceSeconds?: number;
}

export interface AccessTokenVerifier {
  /** The identity in a valid token, or undefined when the token is missing, malformed, expired, or not ours. */
  verify(token: string | undefined, now?: Date): Promise<AccessIdentity | undefined>;
}

export function createAccessTokenVerifier(options: AccessTokenVerifierOptions): AccessTokenVerifier {
  const keys =
    typeof options.jwks === "string" || options.jwks instanceof URL
      ? createRemoteJWKSet(new URL(options.jwks), { cooldownDuration: 10_000, cacheMaxAge: 10 * 60_000 })
      : createLocalJWKSet(options.jwks);
  const issuer = options.issuer ?? ACCESS_TOKEN_ISSUER;
  const audience = options.audience ?? ACCESS_TOKEN_AUDIENCE;
  return {
    async verify(token, now = new Date()) {
      if (!token) return undefined;
      try {
        const { payload } = await jwtVerify(token, keys, {
          algorithms: [ACCESS_TOKEN_ALGORITHM],
          issuer,
          audience,
          currentDate: now,
          clockTolerance: options.clockToleranceSeconds ?? 5,
          requiredClaims: ["sub", "exp", "iat", "jti"],
        });
        return identityFrom(payload);
      } catch {
        return undefined;
      }
    },
  };
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function identityFrom(payload: JWTPayload): AccessIdentity | undefined {
  if (!payload.sub || typeof payload.exp !== "number" || typeof payload.iat !== "number" || !payload.jti) {
    return undefined;
  }
  return {
    actorId: payload.sub,
    actorType: typeof payload.actorType === "string" ? payload.actorType : "anonymous",
    roles: stringList(payload.roles),
    siteIds: stringList(payload.siteIds),
    passwordChangeRequired: payload.pcr === true,
    tokenId: payload.jti,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

/** A fresh ES256 key pair, for tests and for generating the deployment key (`pnpm run auth:keygen`). */
export async function generateAccessTokenKey(keyId: string = crypto.randomUUID()) {
  const { publicKey, privateKey } = await generateKeyPair(ACCESS_TOKEN_ALGORITHM, { extractable: true });
  return {
    keyId,
    privateKeyPem: await exportPKCS8(privateKey),
    publicJwk: await exportJWK(publicKey),
  };
}
