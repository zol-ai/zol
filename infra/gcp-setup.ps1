<#
.SYNOPSIS
  One-time GCP provisioning for the Zol Support service. Safe to re-run.

.DESCRIPTION
  - Enables the APIs Cloud Run needs.
  - Creates the runtime service account with Cloud SQL + Secret Manager access.
  - Creates the zol_support database and user on the existing zol-pg instance.
  - Stores every runtime secret in Secret Manager, read from web/.env.local.

  Run from a laptop after `gcloud auth login`:
    powershell -ExecutionPolicy Bypass -File infra/gcp-setup.ps1
  Then deploy with infra/deploy.ps1.
#>
param(
  [string]$ProjectId    = 'zol-ai',
  [string]$Region       = 'us-west1',
  [string]$InstanceName = 'zol-pg',
  [string]$DatabaseName = 'zol_support',
  [string]$DatabaseUser = 'zol_support',
  [string]$ServiceAccount = 'zol-support-runtime',
  [string]$EnvFile      = (Join-Path $PSScriptRoot '..\web\.env.local')
)

$ErrorActionPreference = 'Stop'
function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

if (-not (Test-Path $EnvFile)) { throw "Missing $EnvFile. Fill in web/.env.local first." }
$envMap = @{}
foreach ($line in Get-Content $EnvFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $k, $v = $line -split '=', 2
  $envMap[$k.Trim()] = $v.Trim()
}
foreach ($k in 'TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','OPENAI_API_KEY','DASHBOARD_PASSWORD') {
  if (-not $envMap[$k]) { throw "web/.env.local is missing $k" }
}

Step "APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com `
  sqladmin.googleapis.com secretmanager.googleapis.com --project=$ProjectId | Out-Null

Step "Service account $ServiceAccount"
$saEmail = "$ServiceAccount@$ProjectId.iam.gserviceaccount.com"
$exists = gcloud iam service-accounts list --project=$ProjectId --filter="email:$saEmail" --format='value(email)'
if (-not $exists) {
  gcloud iam service-accounts create $ServiceAccount --project=$ProjectId --display-name='Zol Support runtime' | Out-Null
}
foreach ($role in 'roles/cloudsql.client','roles/secretmanager.secretAccessor') {
  gcloud projects add-iam-policy-binding $ProjectId --member="serviceAccount:$saEmail" --role=$role --condition=None --quiet | Out-Null
  Write-Host "  $role"
}

Step "Database $DatabaseName on $InstanceName"
$db = gcloud sql databases list --instance=$InstanceName --project=$ProjectId --filter="name:$DatabaseName" --format='value(name)'
if (-not $db) { gcloud sql databases create $DatabaseName --instance=$InstanceName --project=$ProjectId | Out-Null }

Step "Database user $DatabaseUser (new password each run)"
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = ([Convert]::ToBase64String($bytes) -replace '[+/=]', 'x')
$users = gcloud sql users list --instance=$InstanceName --project=$ProjectId --format='value(name)'
if ($users -contains $DatabaseUser) {
  gcloud sql users set-password $DatabaseUser --instance=$InstanceName --project=$ProjectId --password=$password | Out-Null
} else {
  gcloud sql users create $DatabaseUser --instance=$InstanceName --project=$ProjectId --password=$password | Out-Null
}
$connectionName = "${ProjectId}:${Region}:${InstanceName}"
$databaseUrl = "postgres://${DatabaseUser}:${password}@/${DatabaseName}?host=/cloudsql/${connectionName}"

Step "Secrets"
function Set-Secret($name, $value) {
  $tmp = New-TemporaryFile
  try {
    [IO.File]::WriteAllText($tmp.FullName, $value)   # no trailing newline
    $has = gcloud secrets list --project=$ProjectId --filter="name:$name" --format='value(name)'
    if ($has) {
      gcloud secrets versions add $name --project=$ProjectId --data-file=$tmp.FullName | Out-Null
      Write-Host "  updated $name"
    } else {
      gcloud secrets create $name --project=$ProjectId --replication-policy=automatic --data-file=$tmp.FullName | Out-Null
      Write-Host "  created $name"
    }
  } finally { Remove-Item $tmp.FullName -Force }
}
Set-Secret 'zol-support-database-url'        $databaseUrl
Set-Secret 'zol-support-twilio-account-sid'  $envMap['TWILIO_ACCOUNT_SID']
Set-Secret 'zol-support-twilio-auth-token'   $envMap['TWILIO_AUTH_TOKEN']
Set-Secret 'zol-support-openai-api-key'      $envMap['OPENAI_API_KEY']
Set-Secret 'zol-support-dashboard-password'  $envMap['DASHBOARD_PASSWORD']

Write-Host "`nDone. Next: powershell -ExecutionPolicy Bypass -File infra/deploy.ps1" -ForegroundColor Green
