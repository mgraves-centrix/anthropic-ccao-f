# IMPLEMENTATION_SPEC.md
## Anthropic Certification Study Portal — full build spec **and** autonomous multi-agent build prompt

This single document is both (a) the authoritative implementation specification and
(b) a **multi-loop, multi-subagent orchestration prompt** meant to be executed to
completion **without stopping for confirmation**. Companion: `PLAN.md` (rationale and
tradeoffs). Where the two differ, **this document wins** for implementation details.

> Read Part I (how to run) → Part II (locked decisions) → Part III (the spec) →
> Part IV (phased build with subagent fan-out + verification gates) → Appendix
> (cloud/Entra runbook). Build phases run in order; within a phase, fan out subagents,
> then **loop build→verify→repair until the gate is green**, then advance automatically.

---

# PART I — ORCHESTRATION PROTOCOL (how the agent swarm runs)

## I.1 Mission & autonomy contract
- **Goal:** ship the portal per Part III, phase by phase, until the global Definition of
  Done (§DoD) passes.
- **Do not stop to ask permission between steps or phases.** Only surface to the human for
  the explicitly **[HUMAN]**-tagged out-of-band actions (Azure subscription, Entra tenant
  config, secrets) — and even then, **keep building against local emulators** and leave a
  clearly labelled `RUNBOOK` item rather than blocking.
- **Never invent secrets or commit them.** Use placeholders + local emulator values.
- **Every phase ends green or not at all:** a phase is "done" only when its verification
  gate (automated tests + checks) passes. If red, diagnose and repair in a loop.
- **Small, frequent commits** on the working branch; push after each gate passes.
- Work only within the repo; do not touch unrelated repos.

## I.2 The loop model (executed per phase)
```
for phase in [0,1,2,3,4...]:
    plan       = decompose(phase) into parallelizable subagent tasks
    results    = fan_out(subagents, plan)          # parallel where independent
    integrate(results)                             # reconcile, resolve conflicts
    loop:                                          # build→verify→repair
        gate = run_verification(phase)             # lint, typecheck, unit, integ, e2e, sec
        if gate.green: break
        repair(gate.failures)                      # spawn fixer subagents; re-run
    commit(); push()
    # advance automatically — no human confirmation
```
- **Repair loop has no fixed iteration cap** other than "gate is green." If genuinely
  blocked by a **[HUMAN]** dependency, record it in `RUNBOOK.md`, stub/emulate, and
  continue with everything not blocked.
- Isolation: file-mutating subagents that run in parallel use **worktrees** to avoid
  clobbering; read/analysis subagents do not.

## I.3 Subagent roster (spawn as needed; names are roles, not limits)
| Role | Responsibility |
|------|----------------|
| **Scaffolder** | repo tree, tooling, CI, SWA config, emulator wiring |
| **API-Engineer** | Azure Functions endpoints, scoring engine, Table repo layer |
| **Auth-Engineer** | Entra custom OIDC + GitHub, `GetRoles`, `staticwebapp.config.json`, headers |
| **Frontend-Engineer** | SPA router, tabs, exam switcher, theming, components |
| **Charts-Engineer** | hand-rolled SVG score-history + domain bars + results verdict |
| **Data-Engineer** | source schemas, validator, seeder, CCAO-F migration |
| **Content-Author** | per-exam question/study-guide authoring (Part IV Phase 4) |
| **Security-Reviewer** | threat checks, header/CSP audit, key-leak scans, rate-limit tests |
| **Test-Engineer** | unit/integration/e2e/security test suites + gate runner |
| **Integrator** | merges subagent output, resolves conflicts, runs the gate |

## I.4 Global conventions
- **Branch:** `claude/deployment-capability-rfm02p` (existing working branch). Do **not**
  push to `main`. Open/refresh a PR only when asked.
- **Commit trailer:** end messages with the repo's standard co-author trailer.
- **Language/runtime:** Frontend = vanilla JS (no framework, no bundler required — may use
  small ES modules). API = **Node 20 + TypeScript** on Azure Functions v4 (programming
  model v4). Tests = Vitest (unit/integration) + Playwright (e2e, Chromium at
  `/opt/pw-browsers/chromium`).
- **Local-first:** everything must run via **SWA CLI + Azurite** with zero cloud
  dependency (§III.12). Cloud is for deploy only.
- **Definition of Done** is in §DoD.

## I.5 [HUMAN] out-of-band actions (never block on these — see Appendix runbook)
Azure subscription; create SWA (**Standard** tier); create Storage account; **Entra app
registration** + external-collaboration/guest config; set SWA app settings & Key Vault;
add GitHub Actions secrets. Agents produce the exact runbook + IaC and proceed against
emulators.

## I.6 Parallelization & file-ownership (parallel dev, zero collisions)
Parallelize aggressively **but never let two agents edit the same file at once.** Enforce:
- **Interface-first, then fan out.** Before parallel work in a phase, ONE agent authors and
  **freezes the shared contracts** — `api/src/shared/types.ts` (DTOs), the Table schema, API
  request/response shapes, and `app/assets/css/tokens.css` (theme tokens). Everyone else
  imports these read-only. Contract changes after freeze go **only through the Integrator**.
- **Disjoint ownership lanes.** Each subagent is assigned a **non-overlapping path set** and
  touches nothing outside it. The codebase is structured so most work is naturally one-file-
  per-unit:
  - API: **one file per function** (`api/src/functions/*.ts`) — parallelize by endpoint.
  - Frontend: **one file per view/component** (`app/assets/js/views/*.js`, `components/*.js`).
  - Charts: `app/assets/js/charts/*` (Charts-Engineer only).
  - Data/content: `data/tools/*` (Data-Engineer); `data/<exam>/*` (one Content-Author per exam;
    within an exam, one file per domain → authors don't collide even inside a bank).
- **Contention files have a single named owner** (edits serialized through that owner or the
  Integrator): `staticwebapp.config.json` (Auth-Engineer) · `app|api/package.json` + lockfiles
  (Scaffolder; batch dependency adds) · `tokens.css` (Frontend-Engineer) · CI workflows,
  `host.json`, `tsconfig.json` (Scaffolder) · test config (Test-Engineer) · `shared/types.ts`
  (frozen; Integrator-only after freeze).
- **Worktree isolation.** Every file-mutating subagent runs in its **own git worktree**; it
  declares its file set up front. The **Integrator** merges worktrees, resolves any shared-file
  conflicts, and only then runs the phase gate. No direct concurrent writes to the main tree.
- **Rule of thumb:** if two tasks would touch the same file, either split the file first
  (extract a module) or sequence them under one owner — do **not** run them in parallel.

## I.7 Coexistence & cutover (protect the live page)
- **All build work stays on `claude/deployment-capability-rfm02p`; never push to `main`.**
  Production keeps serving today's `index.html` untouched.
- **Validate on the SWA PR preview environment** (separate URL, access-gated) — not production.
- The branch restructures into `app/`+`api/` and points the SWA workflow at them; because this
  only lands on the branch, production is unaffected until you choose to merge.
- **Cutover = merge to `main` (human-gated)** once gates are green and cloud/Entra are provisioned;
  at cutover, **retire the legacy `index.html`** (it exposes the answer key — the very thing the
  portal fixes). Keep it only as a content *source* under `data/ccao-f/`.

---

# PART II — LOCKED DECISIONS (authoritative; do not re-ask)

| # | Decision |
|---|----------|
| Hosting | **Azure Static Web Apps, Standard tier** (`app/` + `api/`), GitHub Actions deploy. |
| Auth | **Entra B2B is primary** (tenant-locked OIDC, MFA/Conditional Access, credential-less via **email OTP / self-service sign-up**); **GitHub org membership is a secondary** provider. Both supported per deployment. (§III.6, Appendix.) |
| Onboarding | **Self-service registration + approval** — new users sign in via B2B email OTP (no pre-sent invite), land on a **Request access** page, submit; an **admin approves with one tap** (or **auto-approve by email domain**). No hand-composed invites. (§III.6a.) |
| Authorization | Custom **`authorized`** role via `/api/GetRoles`, from `AuthorizedUsers` where `status="active"`; **`admin`** role manages requests; **GitHub org/team membership** may also grant `authorized`. Server re-checks every route. |
| Store | **Azure Table Storage** (Azurite locally); access via **managed identity** in cloud (no connection string). |
| Question protection | Client receives **stems+options+type+domain+scenarioId only**; keys/rationale/reference server-side; returned only on Practice `answer` or Mock `submit`. |
| Scoring | `scaled = clamp(round(100 + accuracy*900), 100, 1000)`; **cut 720**. Mock item pick = **largest-remainder apportionment** across domain weights. |
| **Multi-response scoring** | **All-or-nothing** (exam guide documents no partial credit). An item is correct iff the selected set equals the key set exactly. |
| Mock feedback | **Hidden until submit**; Practice = instant per-item. |
| Timers | Mock server-anchored `expiresAt`, keeps running when tab closed, **auto-submit on expiry**; Practice/Study pause/resume freely. |
| Resume | **Server-authoritative** in-progress state; local storage = cache. Two-tab/device conflict via ETag/`rev`. |
| Cleanup | Incomplete attempts **auto-clear after 3 days** — lazy on-read **and** a scheduled timer sweep (BYO Functions). |
| Exams | 4: **CCAO-F** (built, migrate), **CCDV-F**, **CCAR-F** (scenario), **CCAR-P**. All 120 min / 720 cut / 100–1000 / 12-mo validity. |
| CCAR-F | **60 items authored per scenario → 360 bank**; mock draws **4 of 6 scenarios × 15 items**; questions grouped under scenario frames. |
| Content targets | **300+ unique grounded questions** + full study guide **per exam** (CCAR-F: 60/scenario = 360); authoring order **CCAR-F → CCDV-F → CCAR-P**. Large pool ≫ per-exam item count → low attempt-to-attempt overlap. |
| Randomization | **Per attempt, server-side, recorded for resume:** shuffle **question order AND option order** every attempt so position is never memorable; blueprint-weighted **fresh random sample** from the 300+ bank each mock. CCAR-F: shuffle **scenario order + question order within each scenario**, never scatter a scenario's questions. Shuffling never affects scoring (all-or-nothing set compare). |
| Charts | Hand-rolled SVG; per-exam accent; 7/30-day window; per-exam & all-exams scope; dark-mode + reduced-motion + a11y + responsive ≥360px. |
| Results UX | **Green/amber/red** verdict (pass≥760 green, 720–759 amber, <720 red) + weakest-domain **study recommendations** (weak×weight ranked, deep-linked). |
| Dark mode | First-class; CSS tokens; per-user persisted; defaults to `prefers-color-scheme`. |
| Per-exam color | Accent token per exam (Indigo/Cyan/Violet/Fuchsia), AA in both themes, not colliding with semantic green/amber/red. |
| Offline build | **Dropped.** Today's `index.html` is a content *source* only, then retired. |
| Privacy | Per-user data only; no all-users/aggregate endpoint. |
| Security | Hardened baseline (§III.7): managed identity, Key Vault, CSP/headers, rate limits, audit + alerting, supply-chain scanning. |

---

# PART III — THE SPECIFICATION

## III.1 Architecture (final)
SWA **Standard** serving `app/` (static SPA) + `api/` linked **Azure Functions** (Node/TS,
HTTP endpoints + one timer). Functions reach **Table Storage** via **managed identity**
(cloud) / Azurite connection string (local). EasyAuth provides identity; `GetRoles`
resolves custom roles from `AuthorizedUsers`. Answer keys never traverse to the client.

```
Browser SPA ──HTTPS──► SWA(Standard) ──► Functions(TS) ──(Managed Identity)──► Table Storage
   │  fetch /api/*         │  EasyAuth (Entra OIDC + GitHub)     │  timer: 3-day sweep
   │                       └─ /api/GetRoles ◄─ AuthorizedUsers   └─ Key Vault (Entra secret)
   └─ localStorage = cache only (server is source of truth)
```

## III.2 Repository layout (build to this exactly)
```
/
├── app/                              # SWA app_location
│   ├── index.html                    # shell: header, exam switcher, tab nav, theme toggle
│   ├── assets/css/tokens.css         # semantic + per-exam accent tokens (light/dark)
│   ├── assets/css/app.css            # component styles (migrated from current app)
│   └── assets/js/
│       ├── main.js                   # bootstrap, /.auth/me, router mount
│       ├── router.js                 # hash router: #/ , #/exam/<id>/<tab>
│       ├── api.js                    # typed fetch wrappers for /api/*
│       ├── state.js                  # attempt/session state + localStorage cache
│       ├── theme.js                  # theme toggle + per-exam accent application
│       ├── views/{home,practice,mock,study,progress,admin}.js   # admin = requests approval (admin-gated)
│       ├── components/{qcard,timer,switcher,verdict,studyRecs}.js
│       └── charts/{scoreHistory.js,domainBars.js,svgutil.js}
├── api/                              # SWA api_location — Functions v4 (TypeScript)
│   ├── src/functions/
│   │   ├── getRoles.ts               # POST /api/GetRoles  (rolesSource)
│   │   ├── accessRequests.ts         # POST /api/access-requests + admin list/decision
│   │   ├── catalog.ts                # GET  /api/catalog
│   │   ├── attemptsCreate.ts         # POST /api/attempts
│   │   ├── attemptsSave.ts           # PATCH /api/attempts/{id}
│   │   ├── attemptsResume.ts         # GET  /api/attempts
│   │   ├── practiceAnswer.ts         # POST /api/attempts/{id}/answer
│   │   ├── attemptsSubmit.ts         # POST /api/attempts/{id}/submit
│   │   ├── history.ts                # GET  /api/me/history
│   │   └── cleanupTimer.ts           # timer: purge >3d incompletes, finalize expired mocks
│   ├── src/shared/
│   │   ├── tables.ts                 # TableClient factory (MI in cloud / conn-str local)
│   │   ├── auth.ts                   # principal parse, role check, userId derivation
│   │   ├── scoring.ts                # scaled score, multi-select equality, apportionment
│   │   ├── project.ts                # STRICT stem-only projection (no key fields)
│   │   ├── ratelimit.ts              # per-user/route sliding window
│   │   ├── audit.ts                  # security event log
│   │   └── types.ts                  # shared DTOs
│   ├── host.json  local.settings.json(.example)  package.json  tsconfig.json
├── data/                             # authoring SOURCE (not deployed)
│   ├── schema/{questions.schema.json,studyguide.schema.json,exam.schema.json}
│   ├── ccao-f/{exam.json,questions.source.json,studyguide.source.json}
│   ├── ccdv-f/ ccar-f/ ccar-p/       # authored in Phase 4
│   └── tools/{validate.mjs,seed-tables.mjs,extract-ccaof.mjs}
├── tests/{unit,integration,e2e,security}/
├── infra/                            # IaC + runbook
│   ├── main.bicep                    # SWA(Standard), Storage, Key Vault, role assignment
│   └── RUNBOOK.md                    # [HUMAN] cloud/Entra steps (phone-friendly)
├── staticwebapp.config.json
├── .github/workflows/azure-static-web-apps-*.yml   # existing; update app/api/output
├── .github/workflows/seed.yml        # workflow_dispatch data seeding (phone-tappable)
├── PLAN.md  IMPLEMENTATION_SPEC.md
```

## III.3 Data model — Table Storage (exact)
All complex fields are JSON strings (`...Json`). Types below are the parsed shapes.

**`Exams`** — PK=`"EXAM"`, RK=`examId`
```ts
interface ExamMeta {
  examId: string; name: string; itemCount: number; timeLimitMin: 120;
  cutScore: 720; scaleMin: 100; scaleMax: 1000;
  format: "standard" | "scenario"; price: number; status: "live" | "authoring";
  domains: { id: number; name: string; weight: number }[];   // domainsJson
  scenarios?: { id: string; title: string }[];                // scenariosJson (CCAR-F)
  theme: {                                                     // theme_* columns
    accent: string; accentInk: string; accentTint: string;
    accentDark: string; accentInkDark: string; accentTintDark: string; onAccent: string;
  };
}
```
**`Questions`** — PK=`examId`, RK=`questionId` — **holds the answer key (server-only)**
```ts
interface QuestionRow {
  examId: string; questionId: string; domain: number;
  type: "single" | "multiple"; stem: string; options: string[];  // optionsJson
  scenarioId?: string; selectCount?: number;   // "select N" for multiple
  correct: number[];        // correctJson — KEY, never projected
  rationale: string;        // server-only until scored
  referenceText: string; referenceUrl?: string;  // server-only until scored
  status: "published" | "draft";
}
```
**`Scenarios`** — PK=`examId`, RK=`scenarioId`: `{ title, frame, primaryDomains:number[] }`
**`StudyGuide`** — PK=`examId`, RK=`domainId | "feature-ref" | "courses"`:
`{ title, bodyJson, linksJson, coursesJson }`
**`Attempts`** — PK=`userId`, RK=`` `${examId}|${invTicks}|${attemptId}` ``
```ts
interface AttemptRow {
  userId: string; examId: string; attemptId: string;
  mode: "practice" | "mock"; status: "in-progress" | "submitted" | "expired";
  startedAt: string; expiresAt?: string; submittedAt?: string;   // ISO UTC
  scaled?: number; correctCount?: number; totalCount?: number;
  byDomain?: Record<string, {c:number; t:number}>;               // byDomainJson
  progress?: {                                                    // progressJson (in-progress)
    currentIndex:number; answers:Record<string,number[]>; flags:string[];
    questionOrder:string[];                     // shuffled qid sequence (per-attempt)
    optionOrder:Record<string,number[]>;        // shuffled option indices per qid
    scenarioPick?:string[];                     // CCAR-F: shuffled scenario order
    practiceElapsedMs?:number;
  };
  rev: number; purgeAt: string;   // startedAt + 3d
}
```
**`AuthorizedUsers`** — PK=`"USER"`, RK=`` `${provider}|${providerUserId}` `` (or email):
`{ role:"authorized"|"reviewer"|"admin", status:"pending"|"active"|"denied", email,
   displayName, justification?, requestedAt, decidedBy?, decidedAt? }`
- `GetRoles` grants a role only when `status==="active"`. `pending`/`denied` → no access.
- First admin is seeded out-of-band (Appendix); admins approve subsequent requests.
**`Audit`** — PK=`yyyy-mm-dd`, RK=`` `${ticks}|${rand}` ``: `{ userId, event, route, meta }`
**`RateLimit`** — PK=`userId`, RK=`` `${route}|${windowStart}` ``: `{ count }` (or in-memory).

*Invariant:* `invTicks = (MAX_TICKS - Date.parse(startedAt)*10000)` zero-padded 19 —
newest sorts first; per-exam prefix range scans work; per-user PK is the privacy boundary.

## III.4 API contracts (exact)
Common: all routes (except `/login`, `/.auth/*`) require role `authorized`; server derives
`userId` from `x-ms-client-principal`; reject client-supplied identity; JSON only.

- **`POST /api/GetRoles`** (SWA rolesSource) — body `{ identityProvider, userId, userDetails, claims }`
  → `{ roles: string[] }`. Per `AUTHZ_MODE`: `github-org` → `["authorized"]` if the GitHub
  caller is in `GITHUB_ORG`(/`GITHUB_TEAM`) via GitHub API (Key Vault token, cached), else `[]`;
  `allowlist` → from `AuthorizedUsers`; combined → union. Never trusts client-supplied roles.
- **Access requests (self-service registration):**
  - **`POST /api/access-requests`** — any *authenticated* user (no `authorized` needed) →
    creates/updates their own `AuthorizedUsers` row `status="pending"` from the principal
    (`email`,`displayName` server-derived) + `{ justification? }`. **Domain auto-approve:** if
    the **verified** principal email's domain (lowercased, after the final `@`) exact-matches
    `AUTO_APPROVE_DOMAINS` (**`majorkeytech.com`, `centrixlabs.com`, `identityfabric.ai`**), set
    `status="active", role="authorized"` immediately; else `pending`. Idempotent; audited;
    rate-limited. Returns `{ status }`.
  - **`GET /api/access-requests?status=pending`** — **`admin` only** → list requests.
  - **`POST /api/access-requests/{id}/decision`** — **`admin` only** — `{ decision:"approve"|"deny",
    role?:"authorized"|"reviewer" }` → sets `status` + `decidedBy/At`; audited. Optional
    notification to the requester. (One-tap approve link may target this route.)
- **`GET /api/catalog`** → `ExamMeta[]` (no questions/keys).
- **`POST /api/attempts`** — `{ examId, mode, filters?:{domains?:number[],count?:number} }`
  → `{ attemptId, mode, expiresAt?, serverNow, scenarios?:{id,title,frame}[],
       questions:{qid,stem,options,type,domain,scenarioId?,selectCount?}[] }`
  — server draws a fresh blueprint-weighted random sample from the 300+ bank, **shuffles
  question order and each item's options** (records both orders for stable resume), sets timers;
  CCAR-F mock picks 4-of-6 scenarios, shuffles scenario order + question order within each
  (grouping preserved).
  **No key fields.**
- **`PATCH /api/attempts/{attemptId}`** — `{ rev, currentIndex, answers, flags, questionOrder, optionOrder, practiceElapsedMs? }`
  → `{ ok, rev, savedAt, serverNow, expiresAt? }` (409 on stale rev → returns authoritative
  state, still keyless). **No correctness.**
- **`POST /api/attempts/{attemptId}/answer`** — **Practice only** — `{ qid, answer:number[] }`
  → `{ correct:boolean, correctKeys:number[], rationale, reference:{text,url?} }`. Mock→403.
- **`POST /api/attempts/{attemptId}/submit`** — scores server-side; idempotent →
  `{ scaled, pass, correct, total, verdict:"green"|"amber"|"red",
     byDomain:{[id]:{c,t,pct}}, weakDomains:{id,name,pct,weight}[],
     review:{qid,yourAnswer,correct,correctKeys,rationale,reference}[] }`. **Only key-bearing
  endpoint besides practice `answer`.**
- **`GET /api/attempts?examId=&status=in-progress`** → resume payload (position, answers,
  flags, questionOrder, optionOrder, scenarioPick; mock `remainingMs=expiresAt-serverNow`, or auto-submit
  if expired). No keys for in-progress.
- **`GET /api/me/history?scope=exam|all&examId=&window=7|30`** →
  `{ scope, examId?, window, cutScore, points:{date,scaled,pass,examId}[],
     byDomain:{id,name,avgPct}[] | byExam:{examId,avgScaled}[] }`. Aggregates only.

## III.5 Scoring engine (`api/src/shared/scoring.ts`)
```ts
const isItemCorrect = (key:number[], ans:number[]) =>            // ALL-OR-NOTHING
  key.length===ans.length && [...key].sort().join()===[...ans].sort().join();
const scaledFromAccuracy = (acc:number) =>
  Math.min(1000, Math.max(100, Math.round(100 + Math.min(1,Math.max(0,acc))*900)));
const PASS=720, GREEN=760;
const verdict = (s:number)=> s>=GREEN?"green": s>=PASS?"amber":"red";
// blueprint apportionment: floor each domain share, distribute remainder by largest
// fractional part, clamp to available items/domain (port from current app lines 897–904).
// weakDomains: byDomain where pct<70, sorted by (0.7-pct)*weight desc, joined to names.
```

## III.6 Auth & identity (Auth-Engineer)
- **Providers:** **Entra B2B (primary)** — custom OIDC, authority
  `https://login.microsoftonline.com/{tenantId}/v2.0`, **single-tenant** (guests included) —
  **plus GitHub (secondary)**. Config in `staticwebapp.config.json` `auth.identityProviders`
  with client-id/secret via **app settings/Key Vault** (never in repo). A deployment may enable
  Entra only, GitHub only, or both.
- **Authorization (`GetRoles`), by app setting:**
  - **`AUTHZ_MODE=allowlist`** (default with B2B) — grant from **`AuthorizedUsers`** where
    `status="active"`; the row is created by the **self-service registration flow** (§III.6a),
    not hand-composed invites. `admin` rows manage requests.
  - **`AUTHZ_MODE=github-org`** (secondary) — grant `authorized` iff a GitHub caller is a member
    of `GITHUB_ORG`(/`GITHUB_TEAM`), checked via a read-only `read:org` token/GitHub App in Key
    Vault (cached). Requires org "**Require 2FA for everyone**." Onboarding = add to the org.
  - Combinable (allowlist **or** org membership → authorized).
- **Cross-domain / credential-less users:** admit them as **B2B guests** in the **existing
  tenant** (single-tenant app reg still admits guests) with **email OTP / self-service sign-up**
  enabled — they then self-register via §III.6a. Do **not** switch the app reg to
  multi-tenant/personal accounts (wider attack surface).
- **`rolesSource: "/api/GetRoles"`** — resolves `authorized`/`reviewer`/`admin` per the above.
- **`staticwebapp.config.json`** ships: role-gated routes (`/api/*` and `/*` → `authorized`;
  `/login`,`/.auth/*` → anonymous), `responseOverrides` (401→/login, 403→/request-access.html),
  and **global security headers** (§III.7).
- Server `auth.ts`: parse `x-ms-client-principal` (base64 JSON), require `authorized`, derive
  stable `userId`, expose helper `requireUser(req): {userId, roles}` used by every function.

## III.6a Self-service registration & approval (Auth-Engineer, Frontend-Engineer)
Goal: users onboard themselves; admins approve — **no hand-composed invites**.
1. **Sign in without a pre-sent invite** — enable Entra **B2B self-service sign-up / email
   OTP** (Appendix) so a first-time user authenticates via an emailed code; the guest object
   is created on redemption. (GitHub org path needs no request flow — membership = access.)
2. **Gate → Request access** — an authenticated user with no active role gets `403` →
   `/request-access.html`. The page is prefilled from `/.auth/me` (name/email) and posts
   `POST /api/access-requests` with an optional justification.
3. **Decision** — if the email domain ∈ `AUTO_APPROVE_DOMAINS` → auto-approved instantly.
   Otherwise an **`admin`** sees it in a minimal **Admin → Requests** view (or via a one-tap
   approve link in a notification) and calls `POST /api/access-requests/{id}/decision`.
4. **Result** — approved users re-enter authorized; deny/offboard = set `denied` / delete row.
   Every transition is written to `Audit`.
- **Admin view** is a small SPA panel gated by the `admin` role (lists pending, Approve/Deny).
- **Config:** `AUTO_APPROVE_DOMAINS=majorkeytech.com,centrixlabs.com,identityfabric.ai` (case-insensitive match
  on the email's domain), optional notification target (email/webhook).
- **Auto-approve safety (security-team rule):** only auto-approve when the email is a
  **verified claim from the Entra B2B principal** (`x-ms-client-principal`), never a
  user-supplied field and never an *unverified* GitHub email. Normalize to lowercase, take the
  substring after the final `@`, and exact-match against the list (no suffix/`endsWith` matching,
  so `evil-majorkeytech.com` cannot slip through). Non-matching domains fall through to admin
  approval. All auto-approvals are audited.
- **Native alternatives (documented, not default):** Entra **self-service sign-up user flows**
  (optionally domain-restricted + API-connector approval); Entra **Entitlement Management
  access packages** via the My Access portal (self-service request/approve — **requires Entra
  ID Governance P2 licensing**, cost flag). Choose these only if you prefer a fully
  Microsoft-native flow over the in-app one.

## III.7 Security controls (Security-Reviewer enforces in gates)
- **Managed identity → Storage** in cloud (RBAC `Storage Table Data Contributor`, single
  account); Azurite conn-string only local. **No storage secret in cloud.**
- **Key Vault** for the Entra client secret; referenced by SWA app setting.
- **Headers** (`globalHeaders` + verified by test): `Content-Security-Policy` (`default-src
  'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self';
  frame-ancestors 'none'; base-uri 'none'`), `Strict-Transport-Security` (2y; preload),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `Permissions-Policy` (camera/mic/geo off). No inline JS (external modules only) so CSP has
  no `unsafe-inline`.
- **Rate limits** (per-user, sliding window, 429+`Retry-After`, logged): `submit` 10/h,
  `answer` 120/h, `POST /attempts` 30/h, `PATCH` 600/h, `history`/`catalog` 300/h.
- **Input validation:** allowlist fields, bound sizes, validate `examId/qid/answer`, reject
  unknown fields; parameterized Table ops (no key injection); JSON-only output.
- **Audit** security events (grant/revoke, sign-in, submit, 401/403/429) to `Audit` +
  App Insights; **alert** on per-user `submit`/`answer` spikes (harvest signal).
- **Supply chain:** minimal deps; enable Dependabot + CodeQL + secret scanning; lockfiles;
  protect `main` with required checks.
- **Key-leak gate:** an automated test greps every non-`submit`/`answer` response body for
  `correct|rationale|referenceUrl` and **fails the build** if found.

## III.8 Frontend (Frontend/Charts-Engineer)
- **Router:** `#/` (exam picker) · `#/exam/<id>/home|practice|mock|study|progress`. Exam
  switcher preserves current tab + in-progress attempt. Every exam shows **all four tabs**.
- **Theming (`tokens.css` + `theme.js`):** semantic tokens on `:root` (light) with
  `@media (prefers-color-scheme: dark)` and `:root[data-theme=...]` overrides that win over
  the media query. Per-exam accent applied by `body[data-exam]` from `ExamMeta.theme`. Toggle
  persists per user (localStorage + optional user-pref row); defaults to OS.
- **Per-exam palette:** CCAO-F Indigo `#3b44d9`/dark `#8b93ff`; CCDV-F Cyan `#0e7490`/`#38bdf8`;
  CCAR-F Violet `#6d28d9`/`#a78bfa`; CCAR-P Fuchsia `#a21caf`/`#e879f9`; `onAccent=#fff`.
  Verdict colors stay semantic (`--correct/--amber/--wrong`), never an exam accent.
- **Scenario rendering (CCAR-F):** Mock groups questions under scenario `frame` headers;
  Practice can filter by scenario; Study shows scenario context.
- **Charts (hand-rolled SVG, no lib):** score-history line (dated X, 100–1000 Y, cut line at
  720, points pass/fail-colored, exam-accent line; animate cut-in → line-draw → staggered
  points); domain bars (per exam domains, grow-from-0 staggered, green≥70/amber≥50/red<50).
  Window toggle 7/30; scope exam/all (all-exams → per-exam-colored points + "avg by exam"
  bars). `role="img"`+aria-label; **reduced-motion → final state**; responsive ≥360px no
  overflow; empty-state prompt.
- **Results verdict + study recs:** banner green/amber/red by scaled; for amber/red render
  weakest domains (`pct<masteryPct=70`) ranked by `(0.7-pct)*weight`, each with **"Study this
  →"** deep link to `#/exam/<id>/study#domain-<n>`; fail adds "retry incorrect". Color never
  sole signal (icon+text). Thresholds `passBuffer=40`, `masteryPct=70` in app config.

## III.9 Session/attempt lifecycle (API-Engineer)
State: `in-progress →(submit)→ submitted` / `→(now>expiresAt, mock)→ expired(auto-scored)`;
`in-progress purgeAt<now → deleted`. Mock time server-anchored; closing tab does not pause;
on resume compute `remainingMs`, auto-submit if elapsed. Practice/Study use `practiceElapsedMs`
stopwatch (no penalty). Two-tab/device: ETag+`rev`; stale PATCH→409 with authoritative state
+ "continued elsewhere: load latest / overwrite"; submit idempotent. Cleanup **both** lazy
(on list/create, purge caller's expired incompletes; finalize expired mocks) **and** the
`cleanupTimer` sweep. PATCH never returns correctness (saving ≠ scoring).

## III.10 Content pipeline (Data/Content-Engineer)
- **Source schemas** (`data/schema/*.json`, JSON-Schema): validate exam/questions/studyguide.
- **`validate.mjs` gate:** schema valid · every item has reference (URL or objective) · no
  duplicate/near-duplicate stems (normalized similarity) · domain weights within tolerance ·
  ≥ target multiple-response present · CCAR-F items carry valid `scenarioId` · re-verified
  answer sample. Exit non-zero on any failure (CI-wired).
- **`extract-ccaof.mjs`:** pull `window.__CCAOF__` from the current `index.html` into
  `data/ccao-f/*.source.json`; map `question→stem, correct→correct, source/sourceUrl→reference`.
- **`seed-tables.mjs`:** upsert exams/questions/scenarios/studyguide into Table Storage
  (Azurite locally; MI in cloud via `seed.yml` workflow_dispatch).

## III.11 CCAR-F scenarios (Content-Author, Phase 4) — verbatim frames to seed
6 scenarios; author **60 items each (360 bank)**; mock draws **4×15=60**. Frames (store
unabridged in `Scenarios.frame`; primary domains drive per-scenario skew):
1. **S1 Customer Support Resolution Agent** — Agent SDK support agent; high-ambiguity
   returns/billing/account via custom MCP tools (`get_customer,lookup_order,process_refund,
   escalate_to_human`); 80%+ first-contact resolution + correct escalation. *[D1,D2,D5]*
2. **S2 Code Generation with Claude Code** — generation/refactor/debug/docs; custom slash
   commands, CLAUDE.md, plan-mode vs direct execution. *[D3,D5]*
3. **S3 Multi-Agent Research System** — Agent SDK coordinator delegating to search/analyze/
   synthesize/report subagents producing cited reports. *[D1,D2,D5]*
4. **S4 Developer Productivity with Claude** — explore legacy code, boilerplate, automation;
   built-in tools (Read/Write/Bash/Grep/Glob) + MCP. *[D2,D3,D1]*
5. **S5 Claude Code for Continuous Integration** — CI/CD automated review, test gen, PR
   feedback; actionable prompts, minimize false positives. *[D3,D4]*
6. **S6 Structured Data Extraction** — extract from unstructured docs, validate vs JSON
   schema, high accuracy, graceful edge cases, downstream integration. *[D4,D5]*

## III.12 Local dev & emulation (so the swarm never blocks on cloud)
- **Azurite** for Table Storage; seed via `seed-tables.mjs` against it.
- **SWA CLI** `swa start app --api-location api` — emulates routing, headers, and **auth**
  (the CLI's `/.auth/login/<provider>` lets you inject `userId`+roles, incl. `authorized`),
  so auth-gated flows are fully testable locally without Entra.
- `local.settings.json.example` documents required settings; real values are [HUMAN]/Key Vault.

---

# PART IV — PHASED BUILD (subagent fan-out + verification gates)

> Advance automatically when a gate is green. Loop build→verify→repair on red.

## Phase 0 — Scaffold & tooling  *(Scaffolder, Test-Engineer)*
Build: repo tree (§III.2); `api` TS+Functions v4 project; frontend shell + empty views;
`staticwebapp.config.json` (routes/headers/rolesSource); update SWA workflow (app=`app`,
api=`api`, output=`""`); `seed.yml`; Azurite+SWA-CLI scripts; Vitest+Playwright; CI that runs
lint+typecheck+tests; `infra/main.bicep` + `infra/RUNBOOK.md` stubs.
**Gate:** `swa start` serves the shell; `npm run build`/typecheck/lint pass; CI green;
Azurite reachable; Playwright can load `/`.

## Phase 1 — Auth + security baseline  *(Auth-Engineer, Security-Reviewer, Test-Engineer)*
Build: `GetRoles` (`allowlist` default + `github-org`); `AuthorizedUsers`; **self-service
registration** — `/request-access.html`, `POST /api/access-requests` (+ domain auto-approve),
admin list + `/decision` endpoints, minimal **Admin→Requests** view (`admin`-gated); Entra B2B
(primary) + GitHub (secondary) providers in config; server `auth.ts` (principal parse,
role/`userId`, `status==="active"` check); all security headers + CSP (no inline JS); rate-limit
middleware; audit logging; bicep for SWA Standard + Storage + Key Vault + MI role assignment;
RUNBOOK for **Entra app reg + B2B self-service sign-up/email-OTP + first admin seed**, and
(secondary) GitHub org + enforced 2FA + secrets.
**Gate (local via SWA CLI mock auth):** anonymous→login redirect, no app/data served;
authenticated-with-no-role→403→request-access; submitting a request writes `pending`; an
`admin` approving flips to `active`→authorized; **domain auto-approve** admits a matching email
instantly; `pending`/`denied`→403; GitHub org-member (github-org mode)→authorized; `/api/*`
without principal→401; access-request routes reject non-admin for list/decision; header test
asserts CSP/HSTS/etc.; rate-limit test returns 429.

## Phase 2 — Server-side scoring + protection + CCAO-F migration  *(API-, Data-, Security-, Test-Engineer)*
Build: `catalog`, `attempts*`, `answer`, `submit`, `history`, `cleanupTimer`; `scoring.ts`
(incl. **multi-select all-or-nothing**, apportionment); `project.ts` strict projection;
`tables.ts` repo; `extract-ccaof.mjs` + seed CCAO-F; wire Practice instant feedback + Mock
hide-until-submit; lifecycle + resume + 3-day cleanup.
**Gate:** **key-leak test** finds no `correct/rationale/referenceUrl` in catalog/content/PATCH/
resume payloads; submit scores correctly (unit vectors incl. multi-select equality + 720
boundary); practice `answer` returns feedback, mock `answer`→403; resume restores state; mock
expiry auto-submits; incompletes purge after simulated 3d; e2e: full CCAO-F practice + mock.

## Phase 3 — Multi-exam portal + scenarios + theming + progress/results  *(Frontend-, Charts-, API-, Test-Engineer)*
Build: exam picker + switcher + 4-tab workspace per exam; router exam dimension; `tokens.css`
light/dark + per-exam accents + theme toggle; CCAR-F scenario data model end-to-end (grouped
mock 4-of-6, scenario-aware Practice/Study); both charts + window/scope toggles; **results
verdict + study recs**; seed CCDV-F/CCAR-F/CCAR-P **exam+scenario metadata** (content later).
**Gate:** 4 exams listed w/ distinct AA-verified accents; each opens all 4 tabs; switcher
preserves place + in-progress; CCAR-F mock shows 4 grouped scenarios (re-draw varies); charts
recolor/re-domain per exam + all-exams overview; dark/light covers every surface (contrast
test) + persists + OS default; reduced-motion renders final state; no overflow at 360px;
verdict green/amber/red + weakest-domain deep links work; a11y (axe) passes.

## Phase 4 — Content authoring  *(Content-Author ×N, Data-Engineer, Security-Reviewer)*
Order **CCAR-F → CCDV-F → CCAR-P**. Per exam, per domain: fetch+read grounding docs → author
to blueprint weights (single+multiple) → verification pass re-checking a sample vs cited pages
→ uniqueness/distribution check → `validate.mjs` gate → seed. CCAR-F: 60/scenario (360), mock
4×15. Study guides: per-domain grounded notes + feature-ref + Skilljar course links
(catalog `anthropic.skilljar.com`; capture per-course URLs from a logged-in session).
**Gate per exam bank:** validator green (schema/refs/dupes/weights/multi-response/scenario/
sample re-verified); **≥300 unique items**; two consecutive attempts show different question
order + option order (randomization test); study guide renders with working links; e2e mock runs.

---

# DoD — Global Definition of Done
1. Phases 0–3 gates green; ≥1 content bank (CCAR-F) green in Phase 4, others queued.
2. No answer key/rationale/reference in any non-`submit`/`answer` payload (automated proof).
3. Auth: only `authorized` allowlisted users (Entra incl. **guest/email-OTP**, or GitHub) get
   in; MFA/Conditional Access documented + enforced; server re-checks every route.
4. All 4 exams present with 4 tabs; CCAR-F scenarios grouped; per-exam accents AA in both themes.
5. Charts + results verdict + study recs work per spec (dark/reduced-motion/a11y/responsive).
6. Lifecycle correct (server-anchored mock, auto-submit, resume, 3-day cleanup, conflict policy).
7. Security gates pass (headers/CSP, rate limits, audit, managed identity in IaC, supply-chain).
8. `infra/RUNBOOK.md` complete + phone-friendly; deploy flow works via GitHub Actions.
9. All tests (unit/integration/e2e/security) green in CI; committed + pushed to the branch.

---

# APPENDIX — [HUMAN] Azure/Entra provisioning runbook (phone-friendly)
1. **Azure:** create resource group; **SWA (Standard)**; Storage account (disable public/anon,
   TLS1.2+); Key Vault. (Or `az deployment group create -f infra/main.bicep`.)
2. **Managed identity:** enable on the Functions/SWA; assign **Storage Table Data Contributor**
   scoped to the Storage account.
3. **Entra app registration (primary):** single-tenant; redirect URI = SWA
   `/.auth/login/<provider>/callback`; client secret → **Key Vault**; app settings
   (`AAD_CLIENT_ID`, `AAD_CLIENT_SECRET` ref, `TENANT_ID`, `AUTHZ_MODE=allowlist`,
   `AUTO_APPROVE_DOMAINS=majorkeytech.com,centrixlabs.com,identityfabric.ai`).
4. **Self-service registration (the "easy" onboarding):** Entra → External Identities → enable
   **self-service sign-up** and confirm **Email one-time passcode for guests = enabled** so new
   users authenticate via an emailed code with **no pre-sent invite**; the guest object is
   created on first sign-in. Apply **Conditional Access / MFA** to **All users + all
   guest/external users**. Users then self-register in-app (§III.6a); admins approve, or set
   `AUTO_APPROVE_DOMAINS` for hands-off onboarding of your own domain.
5. **Seed the first admin:** add one `AuthorizedUsers` row `{ role:"admin", status:"active" }`
   (seed script) so there is someone to approve the first requests. (Native alternative if you
   have Entra ID Governance P2: publish an **Entitlement Management access package** for
   My-Access-portal self-service instead of the in-app flow.)
6. **(Secondary) GitHub provider:** register a GitHub OAuth/App; redirect URI
   `/.auth/login/github/callback`; add id/secret to settings. For org-membership authz set
   `AUTHZ_MODE=github-org`+`GITHUB_ORG`(/`GITHUB_TEAM`) + a read-only `read:org` token in Key
   Vault; enable org **"Require 2FA for everyone."** Onboarding = add to the org.
7. **Secrets/CI:** SWA deploy token as GitHub Actions secret; separate scoped identity for
   `seed.yml`; enable Dependabot/CodeQL/secret scanning; protect `main`.
8. **Deploy:** push to branch → Actions builds/deploys; run `seed.yml` (workflow_dispatch) to
   populate tables; merge to `main` for production (human-gated).
```
