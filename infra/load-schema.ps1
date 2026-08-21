<#
=============================================================================
 Load db/schema.sql into the Cloud SQL instance created by gcp-setup.ps1.

 Pulls the password out of Secret Manager so it never has to be pasted, then
 hands off to web/scripts/load-schema.mjs (which has the pg + connector
 dependencies).

   ./infra/load-schema.ps1

 Needs application-default credentials for the connector:
   gcloud auth application-default login
=============================================================================
#>

[CmdletBinding()]
param(
  [string]$ProjectId = 'zol-ai',
  [string]$InstanceName = 'zol-pg',
  [string]$DatabaseName = 'zol',
  [string]$DatabaseUser = 'zol',
  [string]$SecretName   = 'zol-db-password'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

$connectionName = gcloud sql instances describe $InstanceName --project=$ProjectId --format='value(connectionName)'
if (-not $connectionName) { throw "Instance $InstanceName not found in $ProjectId. Run gcp-setup.ps1 first." }

$password = gcloud secrets versions access latest --secret=$SecretName --project=$ProjectId
if (-not $password) { throw "Secret $SecretName has no versions." }

$env:INSTANCE_CONNECTION_NAME = $connectionName
$env:PGUSER     = $DatabaseUser
$env:PGPASSWORD = $password
$env:PGDATABASE = $DatabaseName

try {
  Push-Location (Join-Path $repo 'web')
  node scripts/load-schema.mjs
  if ($LASTEXITCODE -ne 0) { throw "schema load failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
  # Don't leave the password sitting in this shell's environment.
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
