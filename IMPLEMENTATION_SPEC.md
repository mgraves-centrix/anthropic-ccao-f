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

---

# PART II — LOCKED DECISIONS (authoritative; do not re-ask)

| # | Decision |
|---|----------|
| Hosting | **Azure Static Web Apps, Standard tier** (`app/` + `api/`), GitHub Actions deploy. |
| Auth | **GitHub is a first-tier, invite-free provider** (primary) + optional **tenant-locked Entra OIDC** (MFA/Conditional Access) for anyone who needs it or for credential-less external users via B2B guest + email OTP (§III.6, Appendix). |
| Authorization | Custom **`authorized`** role via `/api/GetRoles`, resolved from **either** (a) **GitHub org/team membership** (invite-free — onboarding = add to the org; requires org-enforced 2FA) **or** (b) the **`AuthorizedUsers` allowlist**. Configurable per deployment; both are supported. Server re-checks on every route. |
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
| Content targets | 200+ unique grounded questions + full study guide per exam; authoring order **CCAR-F → CCDV-F → CCAR-P**. |
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
│       ├── views/{home,practice,mock,study,progress}.js
│       ├── components/{qcard,timer,switcher,verdict,studyRecs}.js
│       └── charts/{scoreHistory.js,domainBars.js,svgutil.js}
├── api/                              # SWA api_location — Functions v4 (TypeScript)
│   ├── src/functions/
│   │   ├── getRoles.ts               # POST /api/GetRoles  (rolesSource)
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
    optionOrder:Record<string,number[]>; scenarioPick?:string[]; practiceElapsedMs?:number;
  };
  rev: number; purgeAt: string;   // startedAt + 3d
}
```
**`AuthorizedUsers`** — PK=`"USER"`, RK=`` `${provider}|${providerUserId}` `` (or email):
`{ role:"authorized"|"reviewer", displayName, invitedBy, addedAt }`
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
- **`GET /api/catalog`** → `ExamMeta[]` (no questions/keys).
- **`POST /api/attempts`** — `{ examId, mode, filters?:{domains?:number[],count?:number} }`
  → `{ attemptId, mode, expiresAt?, serverNow, scenarios?:{id,title,frame}[],
       questions:{qid,stem,options,type,domain,scenarioId?,selectCount?}[] }`
  — server shuffles options (records order), sets timers, CCAR-F mock picks 4-of-6.
  **No key fields.**
- **`PATCH /api/attempts/{attemptId}`** — `{ rev, currentIndex, answers, flags, optionOrder, practiceElapsedMs? }`
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
  flags, optionOrder, scenarioPick; mock `remainingMs=expiresAt-serverNow`, or auto-submit
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
- **Providers:** **GitHub (primary, first-tier, invite-free)** + optional custom Entra OIDC
  (authority `https://login.microsoftonline.com/{tenantId}/v2.0`, **single-tenant**). Config
  in `staticwebapp.config.json` `auth.identityProviders` with client-id/secret via **app
  settings/Key Vault** (never in repo). A deployment may enable GitHub only, Entra only, or both.
- **Authorization is invite-free by default via GitHub org/team membership.** `GetRoles`
  supports two modes, selected by app settings:
  - **`AUTHZ_MODE=github-org`** — grant `authorized` iff the caller (when
    `identityProvider==="github"`) is a member of `GITHUB_ORG` (optionally `GITHUB_TEAM`).
    Membership is checked via the GitHub API using a **read-only `read:org` token / GitHub App**
    stored in Key Vault; results cached briefly. **Onboarding = add to the org; offboarding =
    remove.** No emails, no allowlist edits. **Requires org setting "Require two-factor
    authentication for everyone"** so this front door is MFA-backed (security-team baseline).
  - **`AUTHZ_MODE=allowlist`** — grant from the **`AuthorizedUsers`** table (works for GitHub
    usernames and Entra identities alike; still invite-free — you just add a row).
  - Both may be combined (org membership **or** allowlist row → authorized), e.g. org for the
    core team + allowlist for external guests.
- **Cross-domain teammates / credential-less users (standing question):** if you use Entra,
  admit them as **B2B guests** in the **existing tenant** (single-tenant app reg still admits
  guests) with **email OTP** enabled — Appendix runbook. If you stay GitHub-only, external
  collaborators simply need a GitHub account in your org/team (or an allowlist row). Do **not**
  switch the Entra app reg to multi-tenant/personal accounts (wider attack surface).
- **`rolesSource: "/api/GetRoles"`** — resolves `authorized`/`reviewer` per the mode above.
- **`staticwebapp.config.json`** ships: role-gated routes (`/api/*` and `/*` → `authorized`;
  `/login`,`/.auth/*` → anonymous), `responseOverrides` (401→/login, 403→/request-access.html),
  and **global security headers** (§III.7).
- Server `auth.ts`: parse `x-ms-client-principal` (base64 JSON), require `authorized`, derive
  stable `userId`, expose helper `requireUser(req): {userId, roles}` used by every function.

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
Build: `GetRoles` with **both `AUTHZ_MODE=github-org` and `allowlist`** (+ `AuthorizedUsers`);
GitHub (primary) + optional Entra providers in config; server `auth.ts` (principal parse,
role/`userId`); `/request-access.html`; all security headers + CSP (no inline JS); rate-limit
middleware; audit logging; bicep for SWA Standard + Storage + Key Vault + MI role assignment;
RUNBOOK for **GitHub org + enforced 2FA**, and (optional) Entra app reg + **B2B guest/email-OTP**
+ secrets.
**Gate (local via SWA CLI mock auth):** anonymous→login redirect, no app/data served;
authenticated non-member/non-allowlisted→403; **org-member (github-org mode) → authorized**;
allowlist row grants/revokes; `/api/*` without principal→401; header test asserts CSP/HSTS/etc.;
rate-limit test returns 429.

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
sample re-verified); ≥200 unique items; study guide renders with working links; e2e mock runs.

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
3. **GitHub provider (primary, invite-free path):** register a GitHub OAuth app (or GitHub
   App); redirect URI = SWA `/.auth/login/github/callback`; add client id/secret to SWA
   settings. For **org-membership authorization** set `AUTHZ_MODE=github-org`, `GITHUB_ORG`
   (+ optional `GITHUB_TEAM`), and a **read-only `read:org`** token / GitHub App creds in
   **Key Vault**. In the GitHub org, enable **"Require two-factor authentication for everyone."**
   Onboarding = add the person to the org/team; offboarding = remove them. No emails, no allowlist.
4. **(Optional) Entra app registration** — only if you also want Entra SSO / credential-less
   external users: single-tenant; redirect URI = SWA `/.auth/login/<provider>/callback`; client
   secret → **Key Vault**; app settings (`AAD_CLIENT_ID`, `AAD_CLIENT_SECRET` ref, `TENANT_ID`).
5. **(Optional) Cross-domain / credential-less via Entra:** External Identities → External
   collaboration settings: allow guest invites; confirm **Email one-time passcode for guests =
   enabled**; invite teammates as **guests** (single-tenant auth then admits them). Apply
   **Conditional Access / MFA** to **All users + all guest/external users**.
6. **Authorization:** `github-org` mode needs no per-user step. For `allowlist` mode (external
   guests, or GitHub usernames), add each person to `AuthorizedUsers` (seed script/portal) —
   not authorized until listed. Modes can be combined.
7. **Secrets/CI:** SWA deploy token as GitHub Actions secret; separate scoped identity for
   `seed.yml`; enable Dependabot/CodeQL/secret scanning; protect `main`.
8. **Deploy:** push to branch → Actions builds/deploys; run `seed.yml` (workflow_dispatch) to
   populate tables; merge to `main` for production (human-gated).
```
