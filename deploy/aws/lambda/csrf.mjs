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

export const createCsrfCookie = (token, isProduction = false) => {
  return `pharmacy_csrf=${token}; SameSite=Lax; Path=/; Max-Age=3600${isProduction ? "; Secure" : ""}`;
};

export const createCsrfHandler = (options = {}) => {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
  const randomBytesFn = options.randomBytesFn ?? generateCsrfToken;

  return async (_event = {}) => {
    const token = randomBytesFn();
    const cookie = createCsrfCookie(token, isProduction);

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

export const handler = createCsrfHandler();
export const csrfHandler = handler;
