<#
=============================================================================
 ZOL — provision Cloud SQL for PostgreSQL on GCP.

 Idempotent: every step checks for the resource before creating it, so this is
 safe to re-run after a failure partway through.

 Prerequisites (both are browser flows — run them yourself first):
   gcloud auth login
   gcloud auth application-default login

 Usage:
   ./infra/gcp-setup.ps1

 The generated database password is written to Secret Manager and printed
 once. It is never written to a file in this repo.
=============================================================================
#>

[CmdletBinding()]
param(
  # zol-ai already exists (project number 146626211362).
  [string]$ProjectId = 'zol-ai',

  # From `gcloud billing accounts list`. Only needed if the project has no
  # billing account linked yet — Cloud SQL will not create without one.
  [string]$BillingAccount,

  [string]$Region       = 'us-west1',
  [string]$InstanceName = 'zol-pg',
  [string]$DatabaseName = 'zol',
  [string]$DatabaseUser = 'zol',

  # db-f1-micro is the cheapest tier that runs Postgres 16 and is fine until
  # there is real call volume. Moving up a tier later is an in-place restart,
  # not a migration, so start small.
  [string]$Tier         = 'db-f1-micro',

  # Shared-core tiers like db-f1-micro exist only on the ENTERPRISE edition.
  # gcloud now defaults new instances to ENTERPRISE_PLUS, which rejects them
  # with "Invalid Tier ... for (ENTERPRISE_PLUS) Edition". Pin it explicitly.
  [ValidateSet('ENTERPRISE', 'ENTERPRISE_PLUS')][string]$Edition = 'ENTERPRISE',

  # ZONAL is roughly half the price of REGIONAL. Switch to REGIONAL before the
  # first shop's phone number points at this.
  [ValidateSet('ZONAL', 'REGIONAL')][string]$Availability = 'ZONAL'
)

$ErrorActionPreference = 'Stop'

function Step($message) { Write-Host "`n=== $message" -ForegroundColor Cyan }
function Ok($message)   { Write-Host "    $message"    -ForegroundColor DarkGray }

# gcloud is a native executable: a non-zero exit does NOT raise, and
# $ErrorActionPreference has no effect on it. Without an explicit check the
# script runs straight past a failed create and still reports success.
function Assert($what) {
  if ($LASTEXITCODE -ne 0) { throw "$what failed (gcloud exited $LASTEXITCODE)" }
}

# --- 0. Confirm we are authenticated -----------------------------------------
Step 'Checking gcloud credentials'
$account = (gcloud auth list --filter=status:ACTIVE --format='value(account)')
if (-not $account) {
  throw 'No active gcloud account. Run: gcloud auth login'
}
Ok "authenticated as $account"

# --- 1. Project ---------------------------------------------------------------
Step "Project $ProjectId"
$exists = $null
try { $exists = gcloud projects describe $ProjectId --format='value(projectId)' 2>$null } catch {}

if (-not $exists) {
  if (-not $BillingAccount) {
    throw "Project $ProjectId does not exist. Re-run with -BillingAccount to create it."
  }
  gcloud projects create $ProjectId --name='ZOL'
  Ok 'created'
} else {
  Ok 'already exists'
}

if ($BillingAccount) {
  gcloud billing projects link $ProjectId --billing-account=$BillingAccount
  Ok "billing linked to $BillingAccount"
}

gcloud config set project $ProjectId | Out-Null

# --- 2. APIs ------------------------------------------------------------------
# sqladmin is what the Cloud SQL Node connector calls at runtime to mint client
# certificates; without it the app fails to connect even though the instance is
# healthy.
Step 'Enabling APIs'
gcloud services enable `
  sqladmin.googleapis.com `
  secretmanager.googleapis.com `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  iam.googleapis.com `
  --project=$ProjectId
Assert 'Enabling APIs'
Ok 'sqladmin, secretmanager, run, cloudbuild, artifactregistry, iam'

# --- 3. Cloud SQL instance ----------------------------------------------------
Step "Cloud SQL instance $InstanceName ($Tier, $Availability, $Region)"
$instance = $null
try { $instance = gcloud sql instances describe $InstanceName --project=$ProjectId --format='value(name)' 2>$null } catch {}

if (-not $instance) {
  Ok 'creating — this takes 5-10 minutes'
  # No --authorized-networks on purpose. Nothing reaches this instance without
  # a certificate from the Cloud SQL Admin API, so there is no open IP to
  # scan. --require-ssl rejects any plaintext attempt outright.
  gcloud sql instances create $InstanceName `
    --project=$ProjectId `
    --database-version=POSTGRES_16 `
    --edition=$Edition `
    --tier=$Tier `
    --region=$Region `
    --availability-type=$Availability `
    --storage-size=10GB `
    --storage-type=SSD `
    --storage-auto-increase `
    --backup `
    --backup-start-time=09:00 `
    --retained-backups-count=7 `
    --enable-point-in-time-recovery `
    --database-flags=cloudsql.iam_authentication=on `
    --require-ssl
  Assert 'Cloud SQL instance create'
  Ok 'created'
} else {
  Ok 'already exists'
}

$connectionName = gcloud sql instances describe $InstanceName --project=$ProjectId --format='value(connectionName)'
Assert 'Cloud SQL instance describe'
if (-not $connectionName) { throw 'Instance describe returned an empty connection name.' }
Ok "connection name: $connectionName"

# --- 4. Database --------------------------------------------------------------
Step "Database $DatabaseName"
$db = $null
try { $db = gcloud sql databases describe $DatabaseName --instance=$InstanceName --project=$ProjectId --format='value(name)' 2>$null } catch {}
if (-not $db) {
  gcloud sql databases create $DatabaseName --instance=$InstanceName --project=$ProjectId
  Assert 'Database create'
  Ok 'created'
} else {
  Ok 'already exists'
}

# --- 5. Application user ------------------------------------------------------
Step "User $DatabaseUser"
$secretName = "zol-db-password"
$secretExists = $null
try { $secretExists = gcloud secrets describe $secretName --project=$ProjectId --format='value(name)' 2>$null } catch {}

if (-not $secretExists) {
  # 32 URL-safe bytes. Generated locally, stored in Secret Manager, never
  # written to disk in this repo.
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')

  gcloud secrets create $secretName --project=$ProjectId --replication-policy=automatic | Out-Null
  $password | gcloud secrets versions add $secretName --project=$ProjectId --data-file=-
  Ok "password generated and stored in Secret Manager as $secretName"
} else {
  $password = gcloud secrets versions access latest --secret=$secretName --project=$ProjectId
  Ok "reusing password from Secret Manager secret $secretName"
}

$userExists = (gcloud sql users list --instance=$InstanceName --project=$ProjectId --format='value(name)') -contains $DatabaseUser
Assert 'Database user list'
if (-not $userExists) {
  gcloud sql users create $DatabaseUser --instance=$InstanceName --project=$ProjectId --password=$password
  Assert 'Database user create'
  Ok 'created'
} else {
  gcloud sql users set-password $DatabaseUser --instance=$InstanceName --project=$ProjectId --password=$password
  Assert 'Database user set-password'
  Ok 'password reset to the Secret Manager value'
}

# --- 6. Service account for Vercel -------------------------------------------
# Vercel is outside GCP, so it authenticates with a service account key. The
# only role it gets is cloudsql.client — enough to open a connection, not
# enough to read backups, change the instance, or touch anything else.
Step 'Service account zol-vercel'
$sa = "zol-vercel@$ProjectId.iam.gserviceaccount.com"
$saExists = $null
try { $saExists = gcloud iam service-accounts describe $sa --project=$ProjectId --format='value(email)' 2>$null } catch {}
if (-not $saExists) {
  gcloud iam service-accounts create zol-vercel `
    --project=$ProjectId `
    --display-name='ZOL web on Vercel — Cloud SQL client'
  Ok 'created'
} else {
  Ok 'already exists'
}

gcloud projects add-iam-policy-binding $ProjectId `
  --member="serviceAccount:$sa" `
  --role='roles/cloudsql.client' `
  --condition=None | Out-Null
Ok 'granted roles/cloudsql.client'

# --- 7. Report ----------------------------------------------------------------
Write-Host "`n=============================================================" -ForegroundColor Green
Write-Host " Cloud SQL is up." -ForegroundColor Green
Write-Host "=============================================================`n" -ForegroundColor Green

Write-Host "Environment variables for Vercel and Cloud Run:`n"
Write-Host "  INSTANCE_CONNECTION_NAME=$connectionName"
Write-Host "  PGDATABASE=$DatabaseName"
Write-Host "  PGUSER=$DatabaseUser"
Write-Host "  PGPASSWORD=$password"
Write-Host ""
Write-Host "Next:" -ForegroundColor Yellow
Write-Host "  1. Load the schema:   ./infra/load-schema.ps1"
Write-Host "  2. Key for Vercel:    ./infra/vercel-env.ps1"
Write-Host ""
Write-Host "The password above is also in Secret Manager:" -ForegroundColor DarkGray
Write-Host "  gcloud secrets versions access latest --secret=$secretName --project=$ProjectId" -ForegroundColor DarkGray
