import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Credentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  type: string;
}

let cachedToken: { value: string; expiry: number } | null = null;
let explicitCredentialsPath: string | null = null;

export function setCredentialsPath(path: string): void {
  explicitCredentialsPath = path;
}

function resolveCredentialPath(): string {
  if (explicitCredentialsPath) {
    return explicitCredentialsPath;
  }

  const envPath = process.env.GWS_CREDENTIALS_PATH;
  if (envPath) {
    return envPath;
  }

  // Look relative to this file's location
  // src/auth.ts -> tools/jira-sheet-sync/src/ -> go up 3 to repo root
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(__dirname, '..', '..', '..', 'credentials.json'),  // repo root
    join(__dirname, '..', '..', '..', '..', 'credentials.json'), // one more up
    'credentials.json', // cwd
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Could not find credentials.json. Set GWS_CREDENTIALS_PATH env var or place credentials.json in repo root.',
  );
}

function loadCredentials(): Credentials {
  const path = resolveCredentialPath();
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as Credentials;

  if (!parsed.client_id || !parsed.client_secret || !parsed.refresh_token) {
    throw new Error(
      `credentials.json at ${path} is missing required fields: client_id, client_secret, refresh_token`,
    );
  }

  return parsed;
}

export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (5 min buffer)
  if (cachedToken && cachedToken.expiry > Date.now() + 300_000) {
    return cachedToken.value;
  }

  const creds = loadCredentials();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to refresh Google OAuth2 token (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };

  cachedToken = {
    value: data.access_token,
    expiry: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}
