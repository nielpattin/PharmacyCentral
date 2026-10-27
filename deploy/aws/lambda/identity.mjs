import { createHmac, timingSafeEqual } from "node:crypto";

export const createIdentityContext = ({
  requestId = "unknown",
  correlationId,
  identity,
  audience = "pharmacy-backend",
  ttlMs = 30_000,
  now = new Date(),
} = {}) => {
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const safeRequestId = String(requestId || "unknown").slice(0, 128);
  const safeCorrelationId = String(correlationId || safeRequestId || "unknown").slice(0, 128);

  // Key order is part of the signature: services re-serialize the context in their schema order, actorId fourth.
  const context = {
    version: "v1",
    requestId: safeRequestId,
    correlationId: safeCorrelationId,
    ...(identity?.id ? { actorId: identity.id } : {}),
    actorType: identity?.actorType ?? "anonymous",
    roles: Array.isArray(identity?.roles) ? identity.roles.slice(0, 32) : [],
    siteIds: Array.isArray(identity?.siteIds) ? identity.siteIds.slice(0, 500) : [],
    issuedAt,
    expiresAt,
    audience: String(audience || "pharmacy-backend").slice(0, 128),
  };

  return context;
};

export const signIdentityContext = (context, secret) => {
  if (!secret) {
    throw new Error("INTERNAL_IDENTITY_SECRET is required to sign context");
  }
  const serialized = JSON.stringify(context);
  const signature = createHmac("sha256", secret).update(serialized).digest("hex");
  return {
    context,
    algorithm: "hmac-sha256",
    signature,
  };
};

export const encodeSignedIdentityContext = (signed) => {
  return Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
};

export const decodeAndVerifyIdentityContext = (header, secret, now = new Date()) => {
  if (!header || !secret) return undefined;
  try {
    const raw = Buffer.from(header, "base64url").toString("utf8");
    const signed = JSON.parse(raw);
    if (signed.algorithm !== "hmac-sha256" || !signed.context || !signed.signature) {
      return undefined;
    }

    const serialized = JSON.stringify(signed.context);
    const expected = createHmac("sha256", secret).update(serialized).digest("hex");
    const expectedBytes = Buffer.from(expected, "utf8");
    const providedBytes = Buffer.from(signed.signature, "utf8");

    if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
      return undefined;
    }

    const { context } = signed;
    if (!context.expiresAt || new Date(context.expiresAt).getTime() <= now.getTime()) {
      return undefined;
    }
    return context;
  } catch {
    return undefined;
  }
};
