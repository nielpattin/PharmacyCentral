import { randomBytes, timingSafeEqual } from "node:crypto";

const csrfCookiePattern = /(?:^|;\s*)pharmacy_csrf=([^;]+)/;

export const extractCsrfCookie = (cookieHeader) => {
  if (!cookieHeader) return undefined;
  const cookieStr = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : String(cookieHeader);
  return csrfCookiePattern.exec(cookieStr)?.[1];
};

export const extractHeader = (headers = {}, name) => {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
};

export const validateCsrfToken = (cookieHeader, headers) => {
  const expected = extractCsrfCookie(cookieHeader);
  const provided = extractHeader(headers, "x-csrf-token");
  if (!expected || !provided) return false;

  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");

  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
    return false;
  }

  return true;
};

export const generateCsrfToken = (byteLength = 32) => randomBytes(byteLength).toString("base64url");

/**
 * Reads the required COOKIE_SECURE flag. It has no default, so a missing or misspelt value stops the handler from
 * being created instead of silently dropping `Secure` from the cookie (ADR 0010).
 */
export const readCookieSecure = (value) => {
  if (value === undefined || value === "") {
    throw new Error("Missing required environment variable: COOKIE_SECURE");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error('Invalid COOKIE_SECURE: expected "true" or "false"');
};

export const createCsrfCookie = (token, cookieSecure) => {
  return `pharmacy_csrf=${token}; SameSite=Lax; Path=/; Max-Age=3600${cookieSecure ? "; Secure" : ""}`;
};

export const createCsrfHandler = (options = {}) => {
  const cookieSecure = options.cookieSecure ?? readCookieSecure(process.env.COOKIE_SECURE);
  const randomBytesFn = options.randomBytesFn ?? generateCsrfToken;

  return async (_event = {}) => {
    const token = randomBytesFn();
    const cookie = createCsrfCookie(token, cookieSecure);

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": cookie,
      },
      cookies: [cookie],
      body: JSON.stringify({ token }),
    };
  };
};

let lambdaHandler;

// The package also loads for the authorizer Lambda, which has no COOKIE_SECURE. Creating the handler on first
// invocation keeps that import safe, and a missing flag still fails every CSRF request loudly.
export const csrfHandler = async (event = {}) => {
  lambdaHandler ??= createCsrfHandler();
  return lambdaHandler(event);
};
