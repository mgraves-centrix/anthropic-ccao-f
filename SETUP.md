# SETUP.md — Manual setup steps (the human runbook)

The build swarm implements and verifies the whole app against **local emulators**. The steps
below are the **out-of-band actions only a human with your Azure/Entra/GitHub access can do** —
provisioning cloud resources, identity, and secrets — to take the verified app live. Do them
once; they're phone-friendly where possible. Nothing here is required to *develop/test* the app.

> Legend: 🖱️Portal (click-through in Azure/Entra) · 💻CLI · 🔐secret (never commit).

---

## 0. Prerequisites
- An **Azure subscription** with rights to create resources.
- Your **Microsoft Entra tenant** (you confirmed you have one) with admin rights.
- A **GitHub org** (for the secondary GitHub sign-in / repo).
- Optional local tools: `npm i -g azure-functions-core-tools@4 @azure/static-web-apps-cli`
  and `azurite` (only if you want to run the app locally exactly as in cloud).

---

> **Fast path:** a script runs the CLI-automatable steps below (§1–§3, §6, §7)
> end-to-end for subscription `c1122f34-…`. Run it from the repo root after
> `az login`; it prompts only for the admin object-ID/email and prints the two
> portal-only steps (§4, §5) at the end.
> - **Windows / PowerShell:** `pwsh -File infra/deploy.ps1` (or `.\infra\deploy.ps1`)
> - **macOS / Linux / bash:** `./infra/deploy.sh`
>
> The step-by-step below is the manual equivalent / reference.

## 1. Create Azure resources (Standard tier)
💻 With Azure CLI (or use the portal equivalents):
```bash
az group create -n rg-certportal -l eastus
# Storage (Table) — disable public/anon, TLS1.2+
az storage account create -n certportalstore -g rg-certportal -l eastus \
  --sku Standard_LRS --min-tls-version TLS1_2 --allow-blob-public-access false
# Key Vault (for the Entra client secret) — its name must be globally unique.
# Pick a stable suffix and use the resulting name in the later commands.
az keyvault create -n certportal-kv-<unique-suffix> -g rg-certportal -l eastus --enable-purge-protection true
# Static Web App — STANDARD tier (required for custom auth + managed identity)
az staticwebapp create -n certportal -g rg-certportal -l eastus2 --sku Standard
```
Or run the provided IaC: `az deployment group create -g rg-certportal -f infra/main.bicep`.

---

## 2. Managed identity → Table Storage (no connection string in cloud)
🖱️Portal / 💻
1. Enable a **system-assigned managed identity** on the Static Web App (Portal → your SWA →
   Settings → Identity → System assigned → On), or via CLI.
2. Grant it **Storage Table Data Contributor** scoped to the storage account:
```bash
SWA_MI=$(az staticwebapp show -n certportal -g rg-certportal --query identity.principalId -o tsv)
STG_ID=$(az storage account show -n certportalstore -g rg-certportal --query id -o tsv)
az role assignment create --assignee $SWA_MI \
  --role "Storage Table Data Contributor" --scope $STG_ID
```
3. Set app setting `TABLES_ACCOUNT_URL=https://certportalstore.table.core.windows.net` (the
   API uses managed identity when this is present; falls back to `TABLES_CONNECTION_STRING`
   locally with Azurite).

---

## 3. Entra app registration (primary sign-in)
🖱️Portal (Entra ID → App registrations → New registration):
1. **Name:** Cert Portal. **Supported account types:** *Single tenant*
   (guests are admitted; do **not** pick multi-tenant/personal).
2. **Redirect URI (Web):** `https://<your-swa-host>/.auth/login/aad/callback`.
3. **Certificates & secrets →** create a **client secret** 🔐 → copy the value.
4. Store it in Key Vault (substitute your globally unique vault name):
   ```bash
   az keyvault secret set --vault-name certportal-kv-<unique-suffix> --name aad-client-secret --value "<SECRET>"
   ```
5. Note the **Application (client) ID** and **Directory (tenant) ID**.

---

## 4. Enable credential-less / cross-domain sign-in (self-service registration)
🖱️Portal (Entra ID → External Identities):
1. **External collaboration settings:** allow guest self-service; confirm
   **"Email one-time passcode for guests" = Enabled** (lets teammates on any domain sign in
   with an emailed code — no Microsoft account required).
2. (Optional) **Self-service sign-up user flow** if you want a native sign-up page.
3. **Conditional Access / MFA:** create/confirm a policy targeting **All users + all guest and
   external users** → require MFA (add device/location/risk as desired).

> After this, a new teammate signs in via email OTP, lands on the app's **Request access** page,
> and is **auto-approved if their email domain is majorkeytech.com, centrixlabs.com, or
> identityfabric.ai**; otherwise an admin approves them in-app.

---

## 5. (Secondary) GitHub sign-in
🔐 (GitHub → Settings → Developer settings → OAuth Apps → New):
1. **Authorization callback URL:** `https://<your-swa-host>/.auth/login/github/callback`.
2. Copy **Client ID** + **Client secret** 🔐.
3. (For org-membership authorization) create a **read-only `read:org`** token or GitHub App,
   store in Key Vault, and in the org enable **"Require two-factor authentication for everyone."**

---

## 6. Configure Static Web App application settings
🔐 (Portal → SWA → Settings → Configuration → Application settings), or `az staticwebapp appsettings set`:
```
TABLES_ACCOUNT_URL      = https://certportalstore.table.core.windows.net
AAD_CLIENT_ID           = <Application (client) ID>
AAD_CLIENT_SECRET       = @Microsoft.KeyVault(SecretUri=https://<your-vault>.vault.azure.net/secrets/aad-client-secret)
AAD_TENANT_ID           = <Directory (tenant) ID>
GITHUB_CLIENT_ID        = <optional>
GITHUB_CLIENT_SECRET    = <optional, Key Vault ref>
AUTHZ_MODE              = allowlist            # or github-org, or both
AUTO_APPROVE_DOMAINS    = majorkeytech.com,centrixlabs.com,identityfabric.ai
NOTIFY_WEBHOOK          = <optional; Slack/Teams incoming-webhook URL for new access requests>
```
The **RateLimit** table backs the durable, cross-instance rate limiter for the
security-sensitive endpoints (submit/answer/attempt-create); it is created by the
seed step below alongside the other tables and needs no extra configuration. Set
`NOTIFY_WEBHOOK` to have pending self-service access requests posted to a channel;
omit it to disable notifications (approvals still work via the Admin view).
(Grant the SWA managed identity **Key Vault Secrets User** on your Key Vault so the
`@Microsoft.KeyVault(...)` references resolve.)

---

## 7. Seed the first admin + exam/question data
💻 (from a machine with access; uses managed identity or a temporary connection string):
1. **First admin** (so someone can approve requests):
   `node data/tools/seed-tables.mjs --admin "aad|<your-object-id>" --email you@majorkeytech.com`
2. **Content:** run the seeder (or the GitHub **Actions → Seed data** workflow, tappable from
   mobile): `node data/tools/seed-tables.mjs --exam ccao-f --exam ccar-f ...`
   Seeding uses the same managed identity; answer keys are written **server-side only**.

---

## 8. GitHub Actions / deploy
🔐
1. The SWA deploy token is stored as the repo secret
   `AZURE_STATIC_WEB_APPS_API_TOKEN_...` (already present from the current app; re-copy from
   Portal → SWA → Manage deployment token if the app was recreated).
2. Add a **separate scoped identity** for the seed workflow (Storage-only).
3. Enable **Dependabot, CodeQL, and secret scanning** (Repo → Settings → Security).
4. **Protect `main`** (require PR + green checks).

---

## 9. Go live (cutover)
1. Push the branch → **Actions builds a preview** at a temporary URL → validate there.
2. When gates are green and steps 1–8 done, **merge the branch's PR to `main`** → production
   deploys.
3. **Retire the legacy `index.html`** (it exposes the answer key). It remains only as a content
   source under `data/ccao-f/`.

---

## Quick reference — what stays server-side / secret
- Answer keys, rationales, references → **Table Storage only**, returned solely on submit/answer.
- Entra & GitHub client secrets, storage access → **Key Vault + managed identity**, never in repo.
- `AUTO_APPROVE_DOMAINS` and `AUTHZ_MODE` → app settings (not secret, but environment-specific).
