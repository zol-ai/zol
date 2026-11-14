<#
.SYNOPSIS
  Build and deploy the Zol Support service to Cloud Run, run migrations, and
  pin PUBLIC_BASE_URL to the service URL. Safe to re-run; that is how you ship.

.DESCRIPTION
  Requires infra/gcp-setup.ps1 to have run once (secrets, service account, DB).

    powershell -ExecutionPolicy Bypass -File infra/deploy.ps1
#>
param(
  [string]$ProjectId    = 'zol-ai',
  [string]$Region       = 'us-west1',
  [string]$Service      = 'zol-support',
  [string]$InstanceName = 'zol-pg',
  [string]$ServiceAccount = 'zol-support-runtime',
  [string]$HandoffNumber = '+15305916090',
  [string]$TwilioNumber = ''
)

$ErrorActionPreference = 'Stop'
function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$web  = Join-Path $root 'web'
$saEmail = "$ServiceAccount@$ProjectId.iam.gserviceaccount.com"
$connectionName = "${ProjectId}:${Region}:${InstanceName}"

if (-not $TwilioNumber) {
  $envFile = Join-Path $web '.env.local'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^TWILIO_PHONE_NUMBER=' } | Select-Object -First 1
    if ($line) { $TwilioNumber = ($line -split '=', 2)[1].Trim() }
  }
}
if (-not $TwilioNumber) { throw 'Pass -TwilioNumber or set TWILIO_PHONE_NUMBER in web/.env.local' }

$secrets = @(
  'DATABASE_URL=zol-support-database-url:latest',
  'TWILIO_ACCOUNT_SID=zol-support-twilio-account-sid:latest',
  'TWILIO_AUTH_TOKEN=zol-support-twilio-auth-token:latest',
  'OPENAI_API_KEY=zol-support-openai-api-key:latest',
  'DASHBOARD_PASSWORD=zol-support-dashboard-password:latest'
) -join ','

Step "Deploy $Service from source (Cloud Build)"
gcloud run deploy $Service --source $web --project=$ProjectId --region=$Region `
  --service-account=$saEmail `
  --add-cloudsql-instances=$connectionName `
  --set-secrets=$secrets `
  --set-env-vars="TWILIO_PHONE_NUMBER=$TwilioNumber,HANDOFF_PHONE_NUMBER=$HandoffNumber,RECORD_CALLS=true" `
  --allow-unauthenticated --timeout=3600 --session-affinity `
  --min-instances=1 --max-instances=3 --cpu=1 --memory=512Mi --quiet

$url = gcloud run services describe $Service --project=$ProjectId --region=$Region --format='value(status.url)'
if (-not $url) { throw 'Service URL came back empty.' }
Write-Host "  URL: $url"

Step "Pin PUBLIC_BASE_URL=$url"
gcloud run services update $Service --project=$ProjectId --region=$Region `
  --update-env-vars="PUBLIC_BASE_URL=$url" --quiet | Out-Null

Step "Migrations (Cloud Run job on the same image)"
$image = gcloud run services describe $Service --project=$ProjectId --region=$Region `
  --format='value(spec.template.spec.containers[0].image)'
$jobName = "$Service-migrate"
$jobExists = gcloud run jobs list --project=$ProjectId --region=$Region --filter="metadata.name:$jobName" --format='value(metadata.name)'
$jobArgs = @(
  "--image=$image", "--project=$ProjectId", "--region=$Region",
  "--service-account=$saEmail", "--set-cloudsql-instances=$connectionName",
  "--set-secrets=DATABASE_URL=zol-support-database-url:latest",
  "--command=node", "--args=scripts/migrate.mjs", "--max-retries=0", "--quiet"
)
if ($jobExists) { gcloud run jobs update $jobName @jobArgs | Out-Null } else { gcloud run jobs create $jobName @jobArgs | Out-Null }
gcloud run jobs execute $jobName --project=$ProjectId --region=$Region --wait

Write-Host "`nDeployed: $url" -ForegroundColor Green
Write-Host "Twilio voice webhook : $url/api/twilio/voice"
Write-Host "Twilio status webhook: $url/api/twilio/status"
