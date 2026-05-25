import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JiraClient } from './jira-client.js';
import { buildPlan } from './timeline-planner.js';
import { GoogleSheetsSync } from './google-sheets-sync.js';
import { getAccessToken, setCredentialsPath } from './auth.js';

// Auto-load .env from repo root or cwd
function loadEnv(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(__dirname, '..', '..', '..', '.env'),  // repo root via src/../../..
    join(process.cwd(), '.env'),                  // cwd
  ];

  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const sepIdx = trimmed.indexOf('=');
      if (sepIdx < 1) continue;
      const key = trimmed.slice(0, sepIdx).trim();
      let value = trimmed.slice(sepIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    break;
  }
}

loadEnv();

interface SyncOptions {
  spreadsheetId: string;
  projectKey: string;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  helperSheetName: string;
  visibleSheetName: string;
  visibleRowLimit: number;
  credentialsPath: string;
}

const SyncDefaults = {
  projectKey: 'PCR',
  helperSheetName: 'Jira Sync',
  visibleSheetName: 'Timeline',
  visibleRowLimit: 150,
} as const;

function parseArguments(args: string[]): Map<string, string | null> {
  const values = new Map<string, string | null>();

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      continue;
    }

    const key = argument.slice(2);
    const value = index + 1 < args.length && !args[index + 1].startsWith('--')
      ? args[++index]
      : 'true';
    values.set(key, value);
  }

  return values;
}

function getValue(values: Map<string, string | null>, key: string, defaultValue: string): string {
  const value = values.get(key);
  if (value && value.trim()) {
    return value;
  }
  return defaultValue;
}

function parseIntValue(value: string, defaultValue: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!isNaN(parsed)) {
    return parsed;
  }
  return defaultValue;
}

function parseOptions(args: string[]): SyncOptions {
  const values = parseArguments(args);

  const spreadsheetId = getValue(values, 'spreadsheet-id', process.env.GWS_SPREADSHEET_ID ?? '');
  const projectKey = getValue(values, 'project-key', process.env.JIRA_PROJECT_KEY ?? SyncDefaults.projectKey);
  const jiraBaseUrl = getValue(values, 'jira-base-url', process.env.JIRA_BASE_URL ?? '');
  const jiraEmail = getValue(values, 'jira-email', process.env.JIRA_EMAIL ?? '');
  const jiraApiToken = getValue(values, 'jira-api-token', process.env.JIRA_API_TOKEN ?? '');
  const helperSheetName = getValue(values, 'helper-sheet', process.env.GWS_HELPER_SHEET_NAME ?? SyncDefaults.helperSheetName);
  const visibleSheetName = getValue(values, 'visible-sheet', process.env.GWS_VISIBLE_SHEET_NAME ?? SyncDefaults.visibleSheetName);
  const visibleRowLimit = parseIntValue(
    getValue(values, 'visible-limit', process.env.GWS_VISIBLE_LIMIT ?? String(SyncDefaults.visibleRowLimit)),
    SyncDefaults.visibleRowLimit,
  );

  if (!spreadsheetId) {
    throw new Error('Missing spreadsheet id. Set GWS_SPREADSHEET_ID or pass --spreadsheet-id.');
  }
  if (!projectKey) {
    throw new Error('Missing Jira project key. Set JIRA_PROJECT_KEY or pass --project-key.');
  }
  if (!jiraBaseUrl) {
    throw new Error('Missing Jira base URL. Set JIRA_BASE_URL or pass --jira-base-url.');
  }
  if (!jiraEmail) {
    throw new Error('Missing Jira email. Set JIRA_EMAIL or pass --jira-email.');
  }
  if (!jiraApiToken) {
    throw new Error('Missing Jira API token. Set JIRA_API_TOKEN or pass --jira-api-token.');
  }

  const credentialsPath = getValue(values, 'credentials-path', process.env.GWS_CREDENTIALS_PATH ?? '');

  return {
    spreadsheetId,
    projectKey,
    jiraBaseUrl,
    jiraEmail,
    jiraApiToken,
    helperSheetName,
    visibleSheetName,
    visibleRowLimit,
    credentialsPath,
  };
}

function writeHelp(): void {
  console.log('Jira -> Google Sheets sync');
  console.log();
  console.log('Usage:');
  console.log('  npx tsx tools/jira-sheet-sync/src/index.ts [options]');
  console.log();
  console.log('Options:');
  console.log('  --spreadsheet-id <id>   Google Sheet id');
  console.log('  --project-key <key>     Jira project key (default PCR)');
  console.log('  --jira-base-url <url>   Jira base URL');
  console.log('  --jira-email <email>    Jira account email');
  console.log('  --jira-api-token <tok>  Jira API token');
  console.log('  --helper-sheet <name>   Helper sheet name (default Jira Sync)');
  console.log('  --visible-sheet <name>  Visible sheet name (default Timeline)');
  console.log('  --visible-limit <n>     Visible row limit (default 150)');
  console.log('  --credentials-path <p>   Path to credentials.json (default: repo root)');
}

export async function main(args: string[]): Promise<number> {
  try {
    if (args.includes('--help') || args.includes('-h')) {
      writeHelp();
      return 0;
    }

    const options = parseOptions(args);
    const jiraClient = new JiraClient(
      options.jiraBaseUrl,
      options.jiraEmail,
      options.jiraApiToken,
    );

    // Google Sheets auth via credentials.json
    if (options.credentialsPath) {
      setCredentialsPath(options.credentialsPath);
    }
    const accessToken = await getAccessToken();
    const sheetsSync = new GoogleSheetsSync(accessToken);

    const issues = await jiraClient.getIssuesAsync(options.projectKey);
    const plan = buildPlan(issues, options.visibleRowLimit);

    await sheetsSync.syncAsync(
      options.spreadsheetId,
      plan,
      options.helperSheetName,
      options.visibleSheetName,
    );

    console.log(`Synced ${plan.helperRows.length} Jira issues into '${options.spreadsheetId}'.`);
    console.log(`Visible sheet shows ${Math.min(plan.visibleRows.length, options.visibleRowLimit)} rows.`);
    return 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    return 1;
  }
}

// When run directly
const isDirectRun = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isDirectRun) {
  main(process.argv.slice(2)).then((exitCode) => process.exit(exitCode));
}
