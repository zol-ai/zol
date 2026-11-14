<#
.SYNOPSIS
  Push one value from web/.env.local to its Secret Manager secret and roll
  Cloud Run so the new version is picked up.

    powershell -ExecutionPolicy Bypass -File infra/rotate-secret.ps1 -Var OPENAI_API_KEY
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('OPENAI_API_KEY','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','DASHBOARD_PASSWORD')]
  [string]$Var,
  [string]$ProjectId = 'zol-ai',
  [string]$Region    = 'us-west1',
  [string]$Service   = 'zol-support',
  [string]$EnvFile   = (Join-Path $PSScriptRoot '..\web\.env.local')
)
$ErrorActionPreference = 'Stop'

$secretName = @{
  OPENAI_API_KEY     = 'zol-support-openai-api-key'
  TWILIO_ACCOUNT_SID = 'zol-support-twilio-account-sid'
  TWILIO_AUTH_TOKEN  = 'zol-support-twilio-auth-token'
  DASHBOARD_PASSWORD = 'zol-support-dashboard-password'
}[$Var]

$line = Get-Content $EnvFile | Where-Object { $_ -match "^$Var=" } | Select-Object -Last 1
if (-not $line) { throw "$Var not found in $EnvFile" }
$value = ($line -split '=', 2)[1].Trim()

$path = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($path, $value)
  gcloud secrets versions add $secretName --project=$ProjectId --data-file="$path"
  if ($LASTEXITCODE -ne 0) { throw "Failed to add a version to $secretName" }
} finally { Remove-Item $path -Force -ErrorAction SilentlyContinue }

Write-Host "Rolling $Service so it reads the new version..."
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
gcloud run services update $Service --project=$ProjectId --region=$Region --update-env-vars="SECRETS_ROTATED_AT=$stamp" --quiet
Write-Host "Done." -ForegroundColor Green
