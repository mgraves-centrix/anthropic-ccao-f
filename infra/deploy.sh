#!/usr/bin/env bash
# ============================================================================
# deploy.sh — one-time Azure provisioning for the Cert Portal (see SETUP.md).
#
# Run from the repo root on a machine where you are logged in with `az login`.
# It performs the CLI-automatable steps (§1–§3, §6, §7). Two portal-only steps
# (§4 email-OTP guests, §5 GitHub OAuth) are printed at the end — they can't be
# scripted reliably and take a few clicks each.
#
#   chmod +x infra/deploy.sh
#   ./infra/deploy.sh
#
# Safe to re-run: az resource creates are idempotent; the Entra app is reused
# if it already exists.
# ============================================================================
set -euo pipefail

# ---- Configuration (edit if you want different names/region) ---------------
SUBSCRIPTION="c1122f34-b902-4637-8174-eab4662bf753"
RG="rg-certportal"
LOCATION="eastus"          # storage/KV region
SWA_LOCATION="eastus2"     # SWA supported region
BASENAME="certportal"      # must match infra/main.bicep `baseName`
APP_DISPLAY_NAME="Cert Portal"
AUTO_APPROVE_DOMAINS="majorkeytech.com,centrixlabs.com,identityfabric.ai"
AUTHZ_MODE="allowlist"

echo "==> Using subscription $SUBSCRIPTION"
az account set --subscription "$SUBSCRIPTION"
TENANT_ID="$(az account show --query tenantId -o tsv)"
ME_OID="$(az ad signed-in-user show --query id -o tsv)"
echo "    tenant=$TENANT_ID  signed-in-user=$ME_OID"

# ---- §1–§2  Resources (storage + Key Vault + Standard SWA + MI + table role)
echo "==> [1/6] Creating resource group + resources via Bicep…"
az group create -n "$RG" -l "$LOCATION" -o none
az deployment group create -g "$RG" -f infra/main.bicep \
  -p baseName="$BASENAME" location="$LOCATION" staticWebAppLocation="$SWA_LOCATION" -o none

TABLES_ACCOUNT_URL="$(az deployment group show -g "$RG" -n main --query properties.outputs.storageTableEndpoint.value -o tsv)"
STORAGE_ID="$(az storage account show -n "${BASENAME}store" -g "$RG" --query id -o tsv)"
KV_NAME="$(az deployment group show -g "$RG" -n main --query properties.outputs.keyVaultName.value -o tsv)"
KV_ID="$(az keyvault show -n "$KV_NAME" -g "$RG" --query id -o tsv)"
SWA_MI_OID="$(az staticwebapp show -n "$BASENAME" -g "$RG" --query identity.principalId -o tsv)"
SWA_HOST="$(az staticwebapp show -n "$BASENAME" -g "$RG" --query defaultHostname -o tsv)"
echo "    table endpoint = $TABLES_ACCOUNT_URL"
echo "    SWA host       = $SWA_HOST"

# ---- RBAC needed beyond the Bicep grant ------------------------------------
# The SWA managed identity needs to READ the Entra client secret from KV;
# YOU (the seeder) need table + KV-secret write access to seed + store secrets.
echo "==> Assigning RBAC (KV Secrets User/Officer, Storage Table Data Contributor)…"
az role assignment create --assignee-object-id "$SWA_MI_OID" --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope "$KV_ID" -o none
az role assignment create --assignee-object-id "$ME_OID" --assignee-principal-type User \
  --role "Key Vault Secrets Officer" --scope "$KV_ID" -o none
az role assignment create --assignee-object-id "$ME_OID" --assignee-principal-type User \
  --role "Storage Table Data Contributor" --scope "$STORAGE_ID" -o none
echo "    (role propagation can take ~1–2 min; the seed step below retries)"

# ---- §3  Entra app registration (primary sign-in) --------------------------
echo "==> [2/6] Entra app registration…"
REDIRECT_AAD="https://${SWA_HOST}/.auth/login/aad/callback"
APP_ID="$(az ad app list --display-name "$APP_DISPLAY_NAME" --query "[0].appId" -o tsv)"
if [ -z "$APP_ID" ] || [ "$APP_ID" = "null" ]; then
  APP_ID="$(az ad app create --display-name "$APP_DISPLAY_NAME" \
    --sign-in-audience AzureADMyOrg \
    --web-redirect-uris "$REDIRECT_AAD" --query appId -o tsv)"
  echo "    created app $APP_ID"
else
  az ad app update --id "$APP_ID" --web-redirect-uris "$REDIRECT_AAD" -o none
  echo "    reusing app $APP_ID"
fi
echo "==> Creating client secret and storing it in Key Vault…"
CLIENT_SECRET="$(az ad app credential reset --id "$APP_ID" --append --display-name swa --query password -o tsv)"
az keyvault secret set --vault-name "$KV_NAME" --name aad-client-secret --value "$CLIENT_SECRET" -o none
KV_SECRET_URI="https://${KV_NAME}.vault.azure.net/secrets/aad-client-secret"

# ---- §6  Static Web App application settings -------------------------------
echo "==> [3/6] Setting Static Web App application settings…"
az staticwebapp appsettings set -n "$BASENAME" -g "$RG" --setting-names \
  "TABLES_ACCOUNT_URL=${TABLES_ACCOUNT_URL}" \
  "AAD_CLIENT_ID=${APP_ID}" \
  "AAD_TENANT_ID=${TENANT_ID}" \
  "AAD_CLIENT_SECRET=@Microsoft.KeyVault(SecretUri=${KV_SECRET_URI})" \
  "AUTHZ_MODE=${AUTHZ_MODE}" \
  "AUTO_APPROVE_DOMAINS=${AUTO_APPROVE_DOMAINS}" -o none
echo "    (set NOTIFY_WEBHOOK later if you want Slack/Teams alerts on access requests)"

# ---- §7  Build API + seed first admin and content --------------------------
echo "==> [4/6] Building API (needed by the seeder)…"
npm ci --silent && npm run build:api --silent

echo "==> [5/6] Seeding first admin + exam content…"
read -r -p "    Your Entra object (user) ID for the first admin [$ME_OID]: " ADMIN_OID
ADMIN_OID="${ADMIN_OID:-$ME_OID}"
read -r -p "    Admin email: " ADMIN_EMAIL
export TABLES_ACCOUNT_URL
# retry a few times while the Storage RBAC grant propagates
for attempt in 1 2 3 4 5; do
  if node data/tools/seed-tables.mjs \
      --admin "aad|${ADMIN_OID}" --email "$ADMIN_EMAIL" \
      --exam data/ccao-f --exam data/ccdv-f --exam data/ccar-f --exam data/ccar-p; then
    break
  fi
  echo "    seed attempt $attempt failed (likely RBAC propagation) — retrying in 30s…"
  sleep 30
done

# ---- §8 note: point the deploy workflow at this SWA ------------------------
echo "==> [6/6] Deployment token"
DEPLOY_TOKEN="$(az staticwebapp secrets list -n "$BASENAME" -g "$RG" --query properties.apiKey -o tsv)"
echo ""
echo "============================================================================"
echo "CLI steps done. Remaining MANUAL steps:"
echo ""
echo "A) Set the GitHub Actions deploy token so pushes to main deploy to THIS SWA:"
echo "   Repo → Settings → Secrets and variables → Actions →"
echo "   update AZURE_STATIC_WEB_APPS_API_TOKEN_PURPLE_MUSHROOM_09775C510 to:"
echo "     $DEPLOY_TOKEN"
echo "   (or rename both the secret and the reference in the deploy workflow)."
echo ""
echo "B) §4 Entra → External Identities (portal, ~5 clicks):"
echo "   - Email one-time passcode for guests = Enabled"
echo "   - (optional) self-service sign-up user flow"
echo "   - Conditional Access: require MFA for all users + guests"
echo ""
echo "C) §5 (optional) GitHub OAuth app for secondary sign-in:"
echo "   callback https://${SWA_HOST}/.auth/login/github/callback"
echo ""
echo "Then validate on the preview URL and merge the PR to main to go live."
echo "App URL: https://${SWA_HOST}"
echo "============================================================================"
