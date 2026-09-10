let cachedSdk = null;

export const isSecretsManagerArn = (value) => {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return /^arn:aws[a-z0-9-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/i.test(trimmed);
};

export const extractRegionFromArn = (arn) => {
  if (typeof arn !== "string") {
    return undefined;
  }
  const parts = arn.trim().split(":");
  if (parts.length >= 4 && parts[0] === "arn" && parts[3]) {
    return parts[3];
  }
  return undefined;
};

export const extractSecretValue = (secretPayload, preferredKey) => {
  if (secretPayload == null) {
    return "";
  }

  let raw = secretPayload;

  if (typeof raw === "object" && !(raw instanceof String)) {
    if (raw.SecretBinary) {
      const binary = raw.SecretBinary;
      if (typeof binary === "string") {
        raw = Buffer.from(binary, "base64").toString("utf-8");
      } else {
        raw = Buffer.from(binary).toString("utf-8");
      }
    } else if (typeof raw.SecretString === "string") {
      raw = raw.SecretString;
    }
  }

  if (typeof raw !== "string") {
    if (typeof raw === "object") {
      if (preferredKey && raw[preferredKey] !== undefined) {
        return String(raw[preferredKey]).trim();
      }
      for (const key of ["secret", "value", "password", "key", "token", "apiKey", "secretKey", "SECRET"]) {
        if (raw[key] !== undefined) {
          return String(raw[key]).trim();
        }
      }
      const keys = Object.keys(raw);
      if (keys.length === 1) {
        return String(raw[keys[0]]).trim();
      }
    }
    return "";
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (preferredKey && parsed[preferredKey] !== undefined) {
          return String(parsed[preferredKey]).trim();
        }
        for (const key of ["secret", "value", "password", "key", "token", "apiKey", "secretKey", "SECRET"]) {
          if (parsed[key] !== undefined) {
            return String(parsed[key]).trim();
          }
        }
        const keys = Object.keys(parsed);
        if (keys.length === 1) {
          return String(parsed[keys[0]]).trim();
        }
      }
    } catch {
      // If JSON parsing fails, return the trimmed raw string
    }
  }

  return trimmed;
};

export const loadSecretsManagerSdk = async () => {
  if (cachedSdk) {
    return cachedSdk;
  }
  try {
    const sdk = await import("@aws-sdk/client-secrets-manager");
    cachedSdk = {
      SecretsManagerClient: sdk.SecretsManagerClient,
      GetSecretValueCommand: sdk.GetSecretValueCommand,
    };
    return cachedSdk;
  } catch {
    return null;
  }
};

export const createSecretsResolver = (options = {}) => {
  const cache = options.cache ?? options.secretsCache ?? new Map();
  const secretsClient = options.secretsClient;
  const fetchSecret = options.fetchSecret ?? options.getSecretValue;
  const awsRegion = options.awsRegion ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  const sdkLoader = options.sdkLoader ?? loadSecretsManagerSdk;

  let lazyClient = secretsClient;
  let GetSecretValueCommandClass;

  const resolveSecret = async (valueOrArn, keyName) => {
    if (!valueOrArn || typeof valueOrArn !== "string") {
      return "";
    }

    const trimmed = valueOrArn.trim();
    if (!trimmed) {
      return "";
    }

    if (!isSecretsManagerArn(trimmed)) {
      return trimmed;
    }

    if (cache.has(trimmed)) {
      return cache.get(trimmed);
    }

    let payload;

    if (typeof fetchSecret === "function") {
      payload = await fetchSecret(trimmed, keyName);
    } else {
      if (!lazyClient) {
        const sdk = await sdkLoader();
        if (!sdk || !sdk.SecretsManagerClient) {
          throw new Error(`AWS Secrets Manager SDK is not available to resolve secret ARN: ${trimmed}`);
        }
        GetSecretValueCommandClass = sdk.GetSecretValueCommand;
        const region = awsRegion || extractRegionFromArn(trimmed) || "ap-southeast-1";
        lazyClient = new sdk.SecretsManagerClient({ region });
      }

      if (typeof lazyClient.send === "function") {
        const command = GetSecretValueCommandClass
          ? new GetSecretValueCommandClass({ SecretId: trimmed })
          : { SecretId: trimmed, input: { SecretId: trimmed } };
        payload = await lazyClient.send(command);
      } else if (typeof lazyClient.getSecretValue === "function") {
        payload = await lazyClient.getSecretValue({ SecretId: trimmed });
      } else {
        throw new Error("Invalid secretsClient: missing send or getSecretValue method");
      }
    }

    const resolved = extractSecretValue(payload, keyName);
    if (!resolved) {
      throw new Error(`Secret value resolved from Secrets Manager for ARN ${trimmed} was empty`);
    }

    cache.set(trimmed, resolved);
    return resolved;
  };

  return {
    resolveSecret,
    getCache: () => cache,
    clearCache: () => cache.clear(),
    isCached: (arn) => cache.has(arn),
  };
};

export const resolveSecret = async (valueOrArn, options = {}) => {
  const resolver = createSecretsResolver(options);
  return resolver.resolveSecret(valueOrArn, options.keyName);
};
