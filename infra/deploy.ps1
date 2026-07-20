<#
============================================================================
 deploy.ps1 — one-time Azure provisioning for the Cert Portal (see SETUP.md).
 PowerShell version of infra/deploy.sh for Windows.

 Run from the repo root in PowerShell, logged in with `az login`. Performs the
 CLI-automatable steps (§1–§3, §6, §7). Two portal-only steps (§4 email-OTP
 guests, §5 GitHub OAuth) are printed at the end.

   pwsh -File infra/deploy.ps1        # PowerShell 7+  (recommended)
   # or in Windows PowerShell 5.1:  .\infra\deploy.ps1

 Requires: Azure CLI, Node.js + npm, and (for the seed step) git-cloned repo.
 Safe to re-run: az creates are idempotent; the Entra app is reused if present.
============================================================================
#>
param(
  [string]$AdminOid = '',
  [string]$AdminEmail = ''
)

$ErrorActionPreference = 'Stop'
# Make native-command (az/node) failures throw on PowerShell 7.3+ (no-op on 5.1).
try { $PSNativeCommandUseErrorActionPreference = $true } catch {}
$AzCli = (Get-Command az -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source)

# ---- Configuration (edit if you want different names/region) ---------------
$Subscription        = 'c1122f34-b902-4637-8174-eab4662bf753'
$Rg                  = 'rg-certportal'
$Location            = 'eastus'        # storage/KV region
$SwaLocation         = 'eastus2'       # Static Web Apps supported region
$BaseName            = 'certportal'    # must match infra/main.bicep `baseName`
$AppDisplayName      = 'Cert Portal'
$AutoApproveDomains  = 'majorkeytech.com,centrixlabs.com,identityfabric.ai'
$AuthzMode           = 'allowlist'

# Helper: run az, capture trimmed stdout, throw on failure.
function Az { param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $out = & $AzCli @Args
  if ($LASTEXITCODE -ne 0) { throw "az $($Args -join ' ') failed (exit $LASTEXITCODE)" }
  return ($out | Out-String).Trim()
}

Write-Host "==> Using subscription $Subscription"
Az @('account', 'set', '--subscription', $Subscription) | Out-Null
$TenantId = Az @('account', 'show', '--query', 'tenantId', '-o', 'tsv')
$MeOid    = Az @('ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv')
Write-Host "    tenant=$TenantId  signed-in-user=$MeOid"

# ---- §1–§2  Resources (storage + Key Vault + Standard SWA + MI + table role)
Write-Host "==> [1/6] Creating resource group + resources via Bicep..."
Az @('group', 'create', '-n', $Rg, '-l', $Location, '-o', 'none') | Out-Null
Az @('deployment', 'group', 'create', '-g', $Rg, '-f', 'infra/main.bicep', '-p', "baseName=$BaseName", "location=$Location", "staticWebAppLocation=$SwaLocation", '-o', 'none') | Out-Null

$TablesAccountUrl = Az @('deployment', 'group', 'show', '-g', $Rg, '-n', 'main', '--query', 'properties.outputs.storageTableEndpoint.value', '-o', 'tsv')
$StorageId = Az @('storage', 'account', 'show', '-n', "${BaseName}store", '-g', $Rg, '--query', 'id', '-o', 'tsv')
$KvName    = Az @('deployment', 'group', 'show', '-g', $Rg, '-n', 'main', '--query', 'properties.outputs.keyVaultName.value', '-o', 'tsv')
$KvId      = Az @('keyvault', 'show', '-n', $KvName, '-g', $Rg, '--query', 'id', '-o', 'tsv')
$SwaMiOid  = Az @('staticwebapp', 'show', '-n', $BaseName, '-g', $Rg, '--query', 'identity.principalId', '-o', 'tsv')
$SwaHost   = Az @('staticwebapp', 'show', '-n', $BaseName, '-g', $Rg, '--query', 'defaultHostname', '-o', 'tsv')
Write-Host "    table endpoint = $TablesAccountUrl"
Write-Host "    SWA host       = $SwaHost"

# ---- RBAC needed beyond the Bicep grant ------------------------------------
# SWA identity must READ the Entra client secret from KV; YOU (the seeder) need
# table + KV-secret write access.
Write-Host "==> Assigning RBAC (KV Secrets User/Officer, Storage Table Data Contributor)..."
Az @('role', 'assignment', 'create', '--assignee-object-id', $SwaMiOid, '--assignee-principal-type', 'ServicePrincipal',
  '--role', 'Key Vault Secrets User', '--scope', $KvId, '-o', 'none') | Out-Null
Az @('role', 'assignment', 'create', '--assignee-object-id', $MeOid, '--assignee-principal-type', 'User',
  '--role', 'Key Vault Secrets Officer', '--scope', $KvId, '-o', 'none') | Out-Null
Az @('role', 'assignment', 'create', '--assignee-object-id', $MeOid, '--assignee-principal-type', 'User',
  '--role', 'Storage Table Data Contributor', '--scope', $StorageId, '-o', 'none') | Out-Null
Write-Host "    (role propagation can take ~1-2 min; the seed step below retries)"

# ---- §3  Entra app registration (primary sign-in) --------------------------
Write-Host "==> [2/6] Entra app registration..."
$RedirectAad = "https://$SwaHost/.auth/login/aad/callback"
$AppId = Az @('ad', 'app', 'list', '--display-name', $AppDisplayName, '--query', '[0].appId', '-o', 'tsv')
if ([string]::IsNullOrWhiteSpace($AppId) -or $AppId -eq 'null') {
  $AppId = Az @('ad', 'app', 'create', '--display-name', $AppDisplayName, '--sign-in-audience', 'AzureADMyOrg',
    '--web-redirect-uris', $RedirectAad, '--query', 'appId', '-o', 'tsv')
  Write-Host "    created app $AppId"
} else {
  Az @('ad', 'app', 'update', '--id', $AppId, '--web-redirect-uris', $RedirectAad, '-o', 'none') | Out-Null
  Write-Host "    reusing app $AppId"
}
Write-Host "==> Creating client secret and storing it in Key Vault..."
$ClientSecret = Az @('ad', 'app', 'credential', 'reset', '--id', $AppId, '--append', '--display-name', 'swa', '--query', 'password', '-o', 'tsv')
Az @('keyvault', 'secret', 'set', '--vault-name', $KvName, '--name', 'aad-client-secret', '--value', $ClientSecret, '-o', 'none') | Out-Null
$KvSecretUri = "https://$KvName.vault.azure.net/secrets/aad-client-secret"

# ---- §6  Static Web App application settings -------------------------------
Write-Host "==> [3/6] Setting Static Web App application settings..."
Az @('staticwebapp', 'appsettings', 'set', '-n', $BaseName, '-g', $Rg, '--setting-names',
  "TABLES_ACCOUNT_URL=$TablesAccountUrl", "AAD_CLIENT_ID=$AppId", "AAD_TENANT_ID=$TenantId",
  "AAD_CLIENT_SECRET=@Microsoft.KeyVault(SecretUri=$KvSecretUri)", "AUTHZ_MODE=$AuthzMode",
  "AUTO_APPROVE_DOMAINS=$AutoApproveDomains", '-o', 'none') | Out-Null
Write-Host "    (set NOTIFY_WEBHOOK later if you want Slack/Teams alerts on access requests)"

# ---- §7  Build API + seed first admin and content --------------------------
Write-Host "==> [4/6] Building API (needed by the seeder)..."
& npm ci --silent;            if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
& npm run build:api --silent; if ($LASTEXITCODE -ne 0) { throw "npm run build:api failed" }

Write-Host "==> [5/6] Seeding first admin + exam content..."
if ([string]::IsNullOrWhiteSpace($AdminOid)) {
  $AdminOid = Read-Host "    Your Entra object (user) ID for the first admin [$MeOid]"
}
if ([string]::IsNullOrWhiteSpace($AdminOid)) { $AdminOid = $MeOid }
if ([string]::IsNullOrWhiteSpace($AdminEmail)) {
  $AdminEmail = Read-Host "    Admin email"
}
$env:TABLES_ACCOUNT_URL = $TablesAccountUrl
# retry while the Storage RBAC grant propagates
for ($attempt = 1; $attempt -le 5; $attempt++) {
  & node data/tools/seed-tables.mjs `
    --admin "aad|$AdminOid" --email $AdminEmail `
    --exam data/ccao-f --exam data/ccdv-f --exam data/ccar-f --exam data/ccar-p
  if ($LASTEXITCODE -eq 0) { break }
  Write-Host "    seed attempt $attempt failed (likely RBAC propagation) — retrying in 30s..."
  Start-Sleep -Seconds 30
}

# ---- §8 note: point the deploy workflow at this SWA ------------------------
Write-Host "==> [6/6] Deployment token"
$DeployToken = Az @('staticwebapp', 'secrets', 'list', '-n', $BaseName, '-g', $Rg, '--query', 'properties.apiKey', '-o', 'tsv')
Write-Host ""
Write-Host "============================================================================"
Write-Host "CLI steps done. Remaining MANUAL steps:"
Write-Host ""
Write-Host "A) Set the GitHub Actions deploy token so pushes to main deploy to THIS SWA:"
Write-Host "   Repo -> Settings -> Secrets and variables -> Actions ->"
Write-Host "   update AZURE_STATIC_WEB_APPS_API_TOKEN_PURPLE_MUSHROOM_09775C510 to:"
Write-Host "     $DeployToken"
Write-Host "   (or rename both the secret and the reference in the deploy workflow)."
Write-Host ""
Write-Host "B) Entra -> External Identities (portal, ~5 clicks):"
Write-Host "   - Email one-time passcode for guests = Enabled"
Write-Host "   - (optional) self-service sign-up user flow"
Write-Host "   - Conditional Access: require MFA for all users + guests"
Write-Host ""
Write-Host "C) (optional) GitHub OAuth app for secondary sign-in:"
Write-Host "   callback https://$SwaHost/.auth/login/github/callback"
Write-Host ""
Write-Host "Then validate on the preview URL and merge the PR to main to go live."
Write-Host "App URL: https://$SwaHost"
Write-Host "============================================================================"
