<#
=============================================================================
 Push the Cloud SQL connection details into a Vercel project.

   vercel login
   cd web; vercel link          # once, to bind this directory to a project
   ./infra/vercel-env.ps1

 Creates a service-account key for zol-vercel if one isn't cached locally, and
 writes five environment variables to the chosen Vercel environment.

 About the key: it is a long-lived credential, which is why the service
 account it belongs to holds exactly one role (roles/cloudsql.client). It
 opens database connections and can do nothing else in the project. It is
 written to infra/.keys/ — gitignored — so re-running this doesn't mint a new
 key every time. Rotate with -NewKey.
=============================================================================
#>

[CmdletBinding()]
param(
  [string]$ProjectId = 'zol-ai',
  [string]$InstanceName = 'zol-pg',
  [string]$DatabaseName = 'zol',
  [string]$DatabaseUser = 'zol',
  [string]$SecretName   = 'zol-db-password',

  [ValidateSet('production', 'preview', 'development')]
  [string[]]$Environments = @('production', 'preview'),

  # Mint a fresh key and disable the cached one.
  [switch]$NewKey
)

$ErrorActionPreference = 'Stop'
$repo   = Split-Path -Parent $PSScriptRoot
$keyDir = Join-Path $PSScriptRoot '.keys'
$keyPath = Join-Path $keyDir "$ProjectId-zol-vercel.json"
$sa = "zol-vercel@$ProjectId.iam.gserviceaccount.com"

function Step($m) { Write-Host "`n=== $m" -ForegroundColor Cyan }

# --- Gather ------------------------------------------------------------------
Step 'Reading instance and secret'
$connectionName = gcloud sql instances describe $InstanceName --project=$ProjectId --format='value(connectionName)'
if (-not $connectionName) { throw "Instance $InstanceName not found. Run gcp-setup.ps1 first." }
# Strip a BOM/newline that an older version of gcp-setup.ps1 baked into the
# stored value — invisible bytes that fail auth as if the password were wrong.
$password = (gcloud secrets versions access latest --secret=$SecretName --project=$ProjectId).TrimStart([char]0xFEFF).Trim()
Write-Host "    $connectionName"

Step 'Service-account key'
if ($NewKey -and (Test-Path $keyPath)) { Remove-Item $keyPath }
if (-not (Test-Path $keyPath)) {
  New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
  gcloud iam service-accounts keys create $keyPath --iam-account=$sa --project=$ProjectId
  Write-Host "    created $keyPath" -ForegroundColor DarkGray
} else {
  Write-Host "    reusing $keyPath (pass -NewKey to rotate)" -ForegroundColor DarkGray
}
# One line, because Vercel stores the value verbatim and a pasted newline in
# the private key breaks the JSON parse at runtime.
$keyJson = (Get-Content $keyPath -Raw | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 10)

# --- Push --------------------------------------------------------------------
$vars = [ordered]@{
  'INSTANCE_CONNECTION_NAME' = $connectionName
  'PGDATABASE'               = $DatabaseName
  'PGUSER'                   = $DatabaseUser
  'PGPASSWORD'               = $password
  'GCP_SERVICE_ACCOUNT_JSON' = $keyJson
}

Push-Location (Join-Path $repo 'web')
try {
  foreach ($envName in $Environments) {
    Step "Writing $($vars.Count) variables to Vercel [$envName]"
    foreach ($name in $vars.Keys) {
      # `vercel env add` fails if the name already exists in that environment,
      # so remove first. --yes suppresses the prompt when it isn't there.
      vercel env rm $name $envName --yes 2>$null | Out-Null
      $vars[$name] | vercel env add $name $envName | Out-Null
      Write-Host "    $name" -ForegroundColor DarkGray
    }
  }
} finally {
  Pop-Location
}

Write-Host "`nDone. Redeploy for these to take effect:" -ForegroundColor Green
Write-Host "  cd web; vercel --prod"
Write-Host "`nThen verify:" -ForegroundColor Green
Write-Host "  curl https://<your-deployment>/api/health/db"
