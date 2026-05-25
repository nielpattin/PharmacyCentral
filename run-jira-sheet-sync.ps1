param(
    [string]$EnvFile = ".env"
)

$envPath = Join-Path $PSScriptRoot $EnvFile

if (-not (Test-Path $envPath)) {
    throw "Missing .env file at $envPath. Copy .env.example to .env and fill values."
}

Get-Content $envPath | ForEach-Object {
    $line = $_.Trim()
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
        return
    }

    $separatorIndex = $line.IndexOf("=")
    if ($separatorIndex -lt 1) {
        return
    }

    $key = $line.Substring(0, $separatorIndex).Trim()
    $value = $line.Substring($separatorIndex + 1).Trim()

    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($key, $value, "Process")
}

$requiredVariables = @(
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
    "GWS_SPREADSHEET_ID",
    "JIRA_PROJECT_KEY",
    "JIRA_BASE_URL"
)

foreach ($name in $requiredVariables) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Missing or empty required .env value: $name"
    }
}

$arguments = @(
    '--spreadsheet-id'
    $env:GWS_SPREADSHEET_ID
    '--project-key'
    $env:JIRA_PROJECT_KEY
    '--jira-base-url'
    $env:JIRA_BASE_URL
)

# Optional sheet names
$helperSheet = [Environment]::GetEnvironmentVariable("GWS_HELPER_SHEET_NAME", "Process")
if (-not [string]::IsNullOrWhiteSpace($helperSheet)) {
    $arguments += @('--helper-sheet', $helperSheet)
}

$visibleSheet = [Environment]::GetEnvironmentVariable("GWS_VISIBLE_SHEET_NAME", "Process")
if (-not [string]::IsNullOrWhiteSpace($visibleSheet)) {
    $arguments += @('--visible-sheet', $visibleSheet)
}

$visibleLimit = [Environment]::GetEnvironmentVariable("GWS_VISIBLE_LIMIT", "Process")
if (-not [string]::IsNullOrWhiteSpace($visibleLimit)) {
    $arguments += @('--visible-limit', $visibleLimit)
}

# Credentials path (optional, defaults to credentials.json in repo root)
$credsPath = [Environment]::GetEnvironmentVariable("GWS_CREDENTIALS_PATH", "Process")
if (-not [string]::IsNullOrWhiteSpace($credsPath)) {
    $arguments += @('--credentials-path', $credsPath)
}

npx tsx tools/jira-sheet-sync/src/index.ts @arguments
