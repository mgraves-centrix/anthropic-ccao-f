# PLAN.md — Anthropic Certification Study Portal

**Status:** Planning artifact. No implementation in this session.
**Author:** Solutions architecture pass over the existing CCAO-F prototype.
**Definition of done for this doc:** a competent developer can execute Phases 1–3
from this, plus author the three remaining exam banks, without further design work.

---

## 0. Decisions captured this session (in addition to the locked spec)

| # | Question | Decision |
|---|----------|----------|
| A | Offline / double-click build once scoring is server-side | **Drop offline entirely.** All access is the authenticated portal. Today's self-contained `index.html` becomes a *content source* for seeding, then is retired. |
| B | Mock per-item feedback | **Hide until submit.** Mock reveals correctness/rationale/reference only after submit or timer expiry. Practice keeps instant per-item feedback. This also hardens protection (incremental saves never return correctness). |
| C | Team size | **Small (<25).** SWA built-in invitations + a GitHub allowlist are sufficient. |
| D | First exam to author after the platform ships | **CCAR-F first** — de-risk the scenario data model/UX early, since it is the only non-standard format. |
| E | Identity: credential-less external users | **Entra External ID + email one-time-passcode (OTP).** You have an Entra tenant; external users with no Microsoft account authenticate via an emailed code (or B2B guest invite). GitHub remains a second method. See §4. |
| F | Security posture | **Hardened / "assume-hostile."** This is a security team's tool. Adopt defense-in-depth (§15): tenant-locked SSO + MFA/Conditional Access, managed identity (no connection strings), Key Vault, strict CSP/headers, rate limiting, audit logging. This **justifies SWA Standard tier** (custom Entra auth + managed identity require it) — the one deliberate departure from "Free where feasible." |
| G | Scoring | **Reuse the CCAO-F formula** exactly: `scaled = round(100 + accuracy × 900)`, clamped 100–1000 (720 cut ≈ 68.9% correct). §5. |
| H | CCAR-F item volume | **60 items authored per scenario → 360-item bank** (6 scenarios); the 60-item mock draws 4 scenarios × 15 items. §8. |
| I | Results UX | **Green/red pass-fail highlight + "barely passing" study recommendations** driven by per-domain %. §10. |

Everything in the "DECISIONS ALREADY MADE (LOCKED)" block of the brief is treated as
fixed and designed to, not re-litigated. **One update:** the "stay on Free tier"
preference yields to the security requirement — see decision F and §15 for the
Standard-tier controls and their cost.

---

## 1. Target architecture (Azure Static Web Apps: app + api)

### Recommended: single SWA with managed Functions (HTTP-only), Table Storage behind the API

```
                          ┌───────────────────────────────────────────────┐
   Browser (SPA)          │            Azure Static Web Apps (Free)        │
   ┌───────────────┐      │                                               │
   │ index.html    │      │  ┌──────────────┐   EasyAuth (built-in)       │
   │ vanilla JS    │◄────────┤ Static assets│   /.auth/login/github       │
   │ CSS tokens    │ HTTPS │  │ (app/)       │   /.auth/login/aad (email)  │
   │ SVG charts    │      │  └──────────────┘   /.auth/me  → principal     │
   └──────┬────────┘      │         │                                     │
          │ fetch /api/*  │         │ x-ms-client-principal (injected)    │
          ▼               │         ▼                                     │
   ┌───────────────┐      │  ┌──────────────────────────┐                 │
   │ /api/catalog  │◄────────┤ Managed Functions (Node) │                 │
   │ /api/attempts │      │  │  - authz on every route  │                 │
   │ /api/.../submit│     │  │  - server-side scoring   │                 │
   │ /api/me/history│     │  │  - lazy expiry/cleanup   │                 │
   └───────────────┘      │  └───────────┬──────────────┘                 │
                          └──────────────┼────────────────────────────────┘
                                         │ Azure SDK (conn string in app settings)
                                         ▼
                          ┌───────────────────────────────────┐
                          │        Azure Table Storage        │
                          │  Exams · Questions · Scenarios ·  │
                          │  StudyGuide · Attempts            │
                          │  (answer keys live ONLY here)     │
                          └───────────────────────────────────┘
```

- **Frontend (`app/`)** — the existing no-build SPA, evolved: fetches data instead of
  inlining it, gains auth gating, dark mode, per-exam theming, and an exam switcher.
- **API (`api/`)** — SWA **managed** Functions (Node). Every route validates the
  SWA-injected `x-ms-client-principal`, derives `userId` server-side, checks role, and
  is the *only* tier that can read answer keys.
- **Store** — Azure Table Storage (5 tables). Connection string is an SWA application
  setting (never in the client, never in the repo).

**Why this shape:** it satisfies every locked decision (SWA, built-in auth, built-in
Functions, Table Storage) on the Free tier, with no extra moving parts and a
phone-friendly Git-push deploy.

### Alternative 1 — SWA + *bring-your-own* Functions app (linked)
A separate Azure Functions app linked to the SWA. **Pro:** unlocks **timer triggers**
(clean global 3-day cleanup / mock auto-submit sweeps) and longer runtimes. **Con:**
another resource to manage; managed-identity/CORS wiring; drifts from "built-in
Functions." **Verdict:** not needed for v1 — we implement cleanup *lazily* on
HTTP requests (§9). Keep BYO Functions as the escape hatch if a scheduled sweep or a
>maximum-runtime job becomes necessary. Flag: Consumption plan has a free grant, so it
can stay ~free, but it leaves the "one resource" simplicity.

### Alternative 2 — SWA + Cosmos DB (serverless) instead of Table Storage
Richer queries (secondary indexes, per-date filters) and change feed for cleanup.
**Con:** overrides the locked Table Storage decision and can exceed Free-tier intent.
**Verdict:** rejected — Table Storage is locked and is *sufficient* at this scale (§3).

### Recommendation (revised for the security requirement)

Because this is a security team's tool (decision F), the recommended build is the
primary architecture **on SWA Standard tier**, using **BYO (linked) Azure Functions
with a managed identity** to reach Table Storage instead of a connection string:

- **Standard tier is required anyway** for custom Entra ID auth (tenant-locking the
  app, enforcing MFA/Conditional Access — §4) — so we spend it once and also gain
  managed identity, private-endpoint options, and BYO-Functions timer triggers.
- **Managed identity → no storage secret exists** to leak; the Function authenticates
  to Storage via Entra RBAC (`Storage Table Data Contributor`), scoped least-privilege.
- **Timer triggers** make the 3-day cleanup and mock auto-submit a clean scheduled
  sweep *in addition to* the lazy on-read enforcement (§9) — defense in depth.

If cost must be minimized and the security bar relaxed, the **Free-tier fallback** is
managed Functions + a Key Vault-referenced connection string + GitHub/pre-configured
Entra auth (no tenant lock, no managed identity, lazy-cleanup only). This is explicitly
**lower assurance** and not recommended for this audience. Cost note: SWA Standard is
~$9/app/month; Functions Consumption + Table Storage remain within/near free grants at
this volume; Key Vault is a few cents/month. See §15 for the full control set.

---

## 2. Phased roadmap (strict priority order)

Each phase is independently shippable and independently verifiable. Phases 1→3 are the
core; content authoring (§8) is a parallel workstream that starts once the platform
(Phase 3) can host a second exam.

### Phase 1 — Team access (auth first)
**Scope:** Lock the whole app behind auth on **SWA Standard**. Offer **tenant-locked
Entra SSO** (with MFA/Conditional Access), **credential-less external users via Entra
email OTP / B2B guest**, and **GitHub** as a secondary method. Only users in the
`AuthorizedUsers` allowlist (custom `authorized` role via `/api/GetRoles`) can load the
SPA or hit any `/api/*` route. (§4, §15.)
**Change vs. today:** provision Standard tier + custom Entra app registration; add
`staticwebapp.config.json` with `rolesSource` + role-gated routes + security headers;
add the `AuthorizedUsers` table + `GetRoles` function; minimal anonymous login landing;
wire `/.auth/me` into app bootstrap; unauthorized users get a "request access" page.
**How you verify:**
- Incognito → hitting `/` redirects to login; no app HTML/data served.
- An authenticated but non-allowlisted account (GitHub *or* Entra) is denied (`authorized`
  absent); adding a row admits them, deleting it revokes on next request.
- A credential-less external tester receives an email OTP, signs in, and (once
  allowlisted) loads the app.
- MFA/Conditional Access challenge fires per tenant policy.
- `curl` of any `/api/*` without a valid principal → 401; with a valid but unauthorized
  principal → 403.

### Phase 2 — Question protection (server-side scoring)
**Scope:** Move the question bank and answer keys into Table Storage. The browser
receives **stems + options + type + domain + scenarioId only**. Scoring happens in the
API; correctness/rationale/reference return only on a legitimate submit (mock) or
per-item answer (practice). CCAO-F content is migrated from the inlined blob into the
store as the first seeded exam.
**Change vs. today:** delete `window.__CCAOF__` inlining; introduce `/api/catalog`,
`/api/attempts`, `/api/attempts/{id}/answer` (practice), `/api/attempts/{id}/submit`;
client renders from API responses.
**How you verify:**
- View-source and the Network tab show **no** `correct`/`rationale`/`reference` field
  on content or incremental-save responses (grep the payloads).
- Submitting a mock returns the scored review; a practice `answer` call returns single-
  item feedback; neither content nor `PATCH` save ever returns a key.
- Attempting to fetch answers directly (e.g., `/api/attempts/{id}` mid-mock) yields no
  key material.

### Phase 3 — Multi-exam portal
**Scope:** Landing screen lists the 4 exams (each with its accent identity); selecting
one opens that exam's workspace with **all four tabs — Practice / Mock / Study /
Progress**. Global exam switcher preserves place. Router gains an exam dimension
(`#/exam/CCDV-F/practice`). Charts, cut line, and domain set are driven by the selected
exam's metadata. **CCAR-F scenario support** lands here: the data model, Mock (pick 4 of
6 scenarios, questions grouped), Practice, and Study all understand scenarios.
Dark mode + per-exam theming (§14) ship in this phase because they touch every surface.
**Change vs. today:** catalog-driven UI; exam-scoped state; scenario-aware rendering;
theme tokens + toggle; the four-tab shell generalized beyond CCAO-F.
**How you verify:**
- Landing lists 4 exams with distinct colors; each opens a full 4-tab workspace.
- Switcher moves CCAO-F ↔ CCDV-F without losing an in-progress position.
- A CCAR-F mock shows 4 scenarios, each framing its grouped questions; re-starting draws
  a (possibly) different 4-of-6.
- Progress charts recolor and re-domain per selected exam; all-exams overview aggregates
  across exams.
- Toggle dark/light — every surface (cards, charts, pills, question states, calibration
  bar, focus rings) is themed with AA contrast; preference persists and defaults to OS.

---

## 3. Data model — Azure Table Storage

Five tables. Table Storage stores flat properties, so nested arrays/objects are stored
as JSON strings (`...Json`) and parsed in the API. Data volumes are tiny (5 exams ×
~250 questions ≈ 1,250 rows; attempts are per-user and small), so this is comfortably
Free tier and fast.

### 3.1 `Exams` — catalog + per-exam meta
| Field | Example | Notes |
|-------|---------|-------|
| PartitionKey | `"EXAM"` | single partition; catalog is tiny |
| RowKey | `"CCAR-F"` | exam id/code |
| name | `"Claude Certified Architect – Foundations"` | |
| itemCount | `60` | mock length |
| timeLimitMin | `120` | |
| cutScore | `720` | on 100–1000 |
| scaleMin / scaleMax | `100` / `1000` | |
| format | `"standard"` \| `"scenario"` | drives scenario logic |
| price | `125` | display only |
| status | `"live"` \| `"authoring"` | gates visibility |
| domainsJson | `[{"id":1,"name":"...","weight":27}, ...]` | source of truth for weights + chart domains |
| scenariosJson | `[{"id":"S1","title":"Customer Support Resolution Agent"}, ...]` | CCAR-F only (or use `Scenarios` table, below) |
| theme_* | see §14 | `accent`, `accentInk`, `accentTint`, `accentDark`, `accentInkDark`, `accentTintDark`, `onAccent` |

### 3.2 `Questions` — stems + **answer keys** (server-only)
| Field | Example | Notes |
|-------|---------|-------|
| PartitionKey | `"CCAR-F"` | exam id — every query is exam-scoped |
| RowKey | `"D1-014"` | stable question id |
| domain | `1` | |
| type | `"single"` \| `"multiple"` | multiple states "select N" in stem |
| stem | `"..."` | shipped to client |
| optionsJson | `["A text","B text",...]` | shipped to client (order shuffled server-side per attempt) |
| scenarioId | `"S3"` | CCAR-F only; null otherwise |
| **correctJson** | `[2]` / `[0,3]` | **answer key — never projected to client** |
| **rationale** | `"..."` | **only returned post-submit/per-answer** |
| **referenceText** | `"Claude Docs — Tool use"` | **server-only until scored** |
| **referenceUrl** | `"https://docs.claude.com/..."` | machine-checkable citation |
| status | `"published"` \| `"draft"` | drafts visible only to a future `reviewer` role |

**How the key stays server-only:** a single hard rule in the API — the content
projection function returns `{qid, stem, options, type, domain, scenarioId}` and nothing
else. `correctJson`/`rationale`/`reference*` are read only inside `submit` and
`answer` (practice) handlers. *Defense-in-depth alternative:* split into `Questions`
(stems) and `AnswerKeys` (keys) tables so a projection bug cannot leak a key that was
never loaded. **Recommendation:** single table + strict projection for v1 (simpler,
one write path); adopt the split if a review ever finds key data crossing the boundary.

### 3.3 `Scenarios` — CCAR-F (recommended over inlining in `Exams`)
PartitionKey=`"CCAR-F"`, RowKey=`"S1".."S6"`; fields: `title`, `frame` (the scenario
narrative shown above its questions), `domainHint`. Questions link via `scenarioId`.
Keeping scenarios as rows keeps the frame text out of the `Exams` catalog blob and lets
Practice/Study render a scenario without loading a mock.

### 3.4 `StudyGuide` — per-exam, per-domain notes
PartitionKey=`examId`, RowKey=`domainId` (plus reserved keys `"feature-ref"` and
`"courses"`). Fields: `title`, `bodyJson` (structured notes), `linksJson` (doc URLs),
`coursesJson` (Anthropic Academy / Skilljar). No answer material here, so it is safe to
cache client-side.

### 3.5 `Attempts` — the load-bearing table (powers resume, scoring, charts, cleanup)
**PartitionKey = `userId`** (the SWA principal's stable `userId`). This is the privacy
guarantee *by construction*: the API only ever queries within the authenticated user's
partition, so one user's code path cannot read another's data.

**RowKey = `` `${examId}|${invTicks}|${attemptId}` ``** where
`invTicks = (MAX_TICKS - startedAtTicks)` zero-padded. Effects:
- Per-exam, newest-first range scan: `PartitionKey eq userId and RowKey ge 'CCDV-F|'
  and RowKey lt 'CCDV-F|~'`.
- All-exams overview: scan the whole (small) user partition.
- "Most recent" sorts first without a sort step.

| Field | Notes |
|-------|-------|
| examId, attemptId | denormalized for convenience |
| mode | `"practice"` \| `"mock"` |
| status | `"in-progress"` \| `"submitted"` \| `"expired"` |
| startedAt / expiresAt | ISO-8601 UTC; `expiresAt` set only for mock (`startedAt+120m`) |
| submittedAt | set on finalize |
| scaled | 100–1000 (finalized) |
| correctCount / totalCount | finalized |
| byDomainJson | `{"1":{"c":8,"t":10}, ...}` — powers the domain bar chart |
| progressJson | in-progress only: `{currentIndex, answers:{qid:[...]}, flags:[qid], optionOrder:{qid:[...]}, scenarioPick:["S3","S1","S5","S2"], practiceElapsedMs}` |
| rev / ETag | optimistic concurrency for two-tab/two-device (§9) |
| purgeAt | `startedAt+3d`; used by lazy cleanup (§9) |

**Powering the charts (§10):** `byDomainJson` + `scaled` + `submittedAt` are exactly
what the two charts need; the history endpoint returns these aggregates only — **never**
questions or keys — so analytics can safely remain client-rendered.

**3-day auto-clear:** Table Storage has no native TTL. Enforced *lazily* — see §9.

### Table Storage modeling tradeoffs (your input welcome — open item)
- **Date-window queries.** Table Storage cannot range-query on an arbitrary `submittedAt`
  property efficiently. Because attempts-per-user is small, the API fetches the user's
  rows (optionally exam-prefixed via RowKey) and filters to the 7/30-day window in code.
  This is simple and fast at <25 users. If a user ever accrues thousands of attempts,
  switch RowKey to embed a date bucket. **I recommend the fetch-and-filter approach.**
- **All-exams overview** is a single partition scan (all of a user's rows). Cheap.
- **Optimistic concurrency** uses the native ETag; no extra design needed.

---

## 4. Auth design — tenant-locked Entra (incl. credential-less users) + GitHub

Both sign-in methods resolve to the same gate: a custom **`authorized`** role granted
per user. Authentication ≠ authorization — an identity can *authenticate* but sees the
app only if it holds `authorized`.

### Identity providers
- **Entra ID (custom app registration) — primary.** Configure custom Entra auth so the
  app is **locked to your tenant** and subject to your **Conditional Access + MFA**
  policies (custom auth requires SWA **Standard** — decision F). This is the strong,
  auditable path for internal team members.
- **Credential-less external users (decision E).** Two supported patterns, both via your
  existing tenant:
  1. **Entra External ID / B2B guest invitations** — invite an external email; the guest
     signs in with whatever they have.
  2. **Email one-time passcode (OTP)** — for guests with **no Microsoft account at all**,
     Entra emails a short-lived code they enter to authenticate. This is the
     "no credentials" path. (Enable *Email one-time passcode for guests* in the tenant's
     External Identities settings.)
  Either way the guest still needs the `authorized` role to pass the gate — invitation
  to the tenant ≠ access to the portal.
- **GitHub — secondary.** `/.auth/login/github`, for team members who prefer it. Also
  role-gated.

### Role assignment
- **Source of truth: an `AuthorizedUsers` Table** (recommended for a security team over
  ad-hoc SWA invitations) — a small allowlist keyed by the provider identity, with
  `role` (`authorized` / future `reviewer`) and audit fields (`invitedBy`, `addedAt`).
  A tiny `GetRoles` function reads it and returns the caller's custom roles to SWA
  (`rolesSource`), so **de-provisioning is one row delete** and every grant is logged.
- Manual SWA portal invitations remain a fallback at <25 users.

### `staticwebapp.config.json` (conceptual)
```jsonc
{
  "routes": [
    { "route": "/login", "allowedRoles": ["anonymous", "authenticated"] },
    { "route": "/.auth/*", "allowedRoles": ["anonymous", "authenticated"] },
    { "route": "/api/*", "allowedRoles": ["authorized"] },
    { "route": "/*", "allowedRoles": ["authorized"] }
  ],
  "responseOverrides": {
    "401": { "redirect": "/login", "statusCode": 302 },
    "403": { "rewrite": "/request-access.html" }
  },
  "auth": {
    "rolesSource": "/api/GetRoles",
    "identityProviders": {
      "github": {},
      "customOpenIdConnectProviders": { "entra": { /* tenant-locked app reg */ } }
    }
  }
}
```

- Everything except login/callback requires `authorized`.
- The API **additionally** re-checks the role server-side from `x-ms-client-principal`
  (never trust routing alone) and derives `userId` from the principal (never from the
  request body).
- **Future `reviewer` role** slots in here to preview `draft` questions.

**Resolved:** you have an Entra tenant; credential-less access = Entra **email OTP** /
B2B guest (decision E). **Remaining nuance to confirm:** whether external graders should
get full `authorized` access or a narrower future role.

---

## 5. API surface

All routes require the `authorized` role; all derive `userId` server-side. Shapes below
are the contract; note what each response **omits**.

### `GET /api/catalog`
→ `[{ examId, name, itemCount, timeLimitMin, cutScore, scaleMin, scaleMax, format,
      domains:[{id,name,weight}], scenarios?:[{id,title}], theme:{...}, status }]`
No questions, no keys.

### `POST /api/attempts` — start Practice or Mock
Req: `{ examId, mode, filters?:{ domains?:[int], count?:int } }`
Server: creates an `in-progress` attempt, draws a fresh blueprint-weighted random sample
from the 300+ bank, **shuffles question order and options** per attempt (records
`questionOrder` + `optionOrder` for stable resume), sets `startedAt`/`expiresAt` (mock), and
for CCAR-F **mock** selects 4 of 6 scenarios (shuffles scenario order + within-scenario order,
grouping preserved).
Resp:
```json
{
  "attemptId": "a_01H...",
  "mode": "mock",
  "expiresAt": "2026-07-10T14:00:00Z",
  "serverNow": "2026-07-10T12:00:00Z",
  "scenarios": [ { "id":"S3","title":"...","frame":"..." } ],   // CCAR-F only
  "questions": [
    { "qid":"D2-07","stem":"...","options":["...","..."],
      "type":"single","domain":2,"scenarioId":"S3" }
  ]
}
```
**No `correct`, no `rationale`, no `reference`.**

### `PATCH /api/attempts/{attemptId}` — incremental save / resume anchor
Req: `{ rev, currentIndex, answers, flags, optionOrder, practiceElapsedMs? }`
Resp: `{ ok:true, rev:12, savedAt:"...", serverNow:"...", expiresAt?:"..." }`
**Returns no correctness** — saving ≠ scoring. `409` on stale `rev` (§9) returns the
authoritative server state (still no keys).

### `POST /api/attempts/{attemptId}/answer` — **Practice only** instant feedback
Req: `{ qid, answer:[...] }`
Resp: `{ correct:true, correctKeys:[2], rationale:"...", reference:{text,url} }`
Mock → `403` (feedback is withheld until submit, per decision B).

### `POST /api/attempts/{attemptId}/submit` — finalize + score (server-side)
Server scores all answers against `correctJson`, computes `scaled` (§ scoring note),
`byDomain`, marks `submitted`. **Idempotent** (second submit returns the finalized
result). Resp:
```json
{
  "scaled": 780, "pass": true, "correct": 47, "total": 60,
  "byDomain": { "1": {"c":8,"t":10}, "2": {"c":9,"t":12} },
  "review": [
    { "qid":"D2-07","yourAnswer":[1],"correct":false,
      "correctKeys":[2],"rationale":"...","reference":{ "text":"...","url":"..." } }
  ]
}
```
This is the **only** endpoint that returns full key material, and only for a completed
attempt the user owns.

### `GET /api/attempts?examId=&status=in-progress` — resume
Returns the user's in-progress attempt(s) with restore state (position, answers, flags,
`optionOrder`, scenario pick) and, for mock, `remainingMs = expiresAt − serverNow`. If
`now > expiresAt`, the server **auto-submits** first, then returns the finalized result
(§9). No keys for still-in-progress attempts.

### `GET /api/me/history?scope=exam|all&examId=&window=7|30` — charts
Resp (aggregates only):
```json
{
  "scope":"exam","examId":"CCDV-F","window":7,"cutScore":720,
  "points":[ { "date":"2026-07-08","scaled":690,"pass":false },
             { "date":"2026-07-09","scaled":760,"pass":true } ],
  "byDomain":[ { "id":1,"name":"Agents & Workflows","avgPct":72 } ]
}
```
`scope=all` aggregates the user's attempts across exams (per-exam-colored points; an
"average score by exam" bar set replaces domain bars, since domains differ per exam).
**No questions, no keys** — safe to render client-side.

**No aggregate/all-users endpoint exists.** (Explicitly out of scope until requested.)

**Proof the key never leaves the server:** the only responses carrying `correct*` are
`answer` (practice, per legitimately-answered item) and `submit` (post-finalize).
`catalog`, `POST /attempts` (content), `PATCH` (save), and `GET /attempts` (resume) are
all key-free by contract.

**Scoring formula (resolved — reuse CCAO-F, decision G).** The current app computes:

```js
scaledFromAccuracy(acc /* 0..1 */) = clamp(round(100 + acc * 900), 100, 1000)
pass = scaled >= 720            // 720 ⇔ acc ≈ 0.689 (68.9% correct)
```

- `acc` = correct items / total items in the scored set (multiple-response items are
  all-or-nothing: fully correct or not, matching today's behavior — confirm this is the
  intended rule for multi-select).
- The **mock's** blueprint-weighted item selection reuses today's **largest-remainder
  apportionment** across domain weights (floor each domain's share, then distribute the
  remaining slots by largest fractional remainder), clamped to available items/domain.
- Applies identically to all four exams (all share the 100–1000 scale + 720 cut);
  per-domain `%` comes straight from `byDomainJson`.
- The CCAR-F score report also shows **percent-correct by domain** (per its exam guide),
  which the same `byDomain` aggregates already provide.

---

## 6. Repo structure + phone-friendly deploy

```
/
├── app/                         # SWA app_location — no-build SPA
│   ├── index.html
│   └── assets/{css,js}/         # tokens.css, theme.js, router.js, charts.js, ...
├── api/                         # SWA api_location — managed Functions (Node)
│   ├── catalog/                 # one folder per HTTP function
│   ├── attempts/                # POST/PATCH/GET
│   ├── answer/  submit/  history/
│   ├── shared/                  # tableClient.js, auth.js, scoring.js, project.js
│   ├── host.json  package.json
├── data/                        # authoring SOURCE (NOT deployed)
│   ├── ccao-f/{questions.source.json, studyguide.source.json}
│   ├── ccdv-f/  ccar-f/  ccar-p/
│   └── tools/{validate.mjs, seed-tables.mjs}
├── staticwebapp.config.json     # routes/roles/auth
├── .github/workflows/azure-static-web-apps-*.yml
└── PLAN.md
```

Update the existing workflow: `app_location: "app"`, `api_location: "api"`,
`output_location: ""`.

**Phone-friendly flow:**
- No bundler/build step → editing a file in the GitHub mobile app and committing triggers
  Actions → SWA deploy. Small, self-contained commits.
- **PR preview environments** (free on SWA) give a throwaway URL per PR to test from the
  phone before merging to `main`.
- **Seeding data** to Table Storage is a `workflow_dispatch` GitHub Action (a button in
  the Actions tab, tappable from mobile) running `data/tools/seed-tables.mjs`. The
  storage connection string is a GitHub Actions secret / SWA app setting — never in the
  repo.
- Merges to `main` deploy production; that is the one step reserved for you.

---

## 7. Migration from today's static app

**Reused as-is / lightly adapted:**
- The CSS design system and custom-property theming (extended with dark + per-exam
  tokens, §14).
- The hand-rolled SVG/CSS chart rendering approach.
- The hash router (gains an exam segment).
- Domain-weighting and blueprint-weighted mock selection logic (moves server-side).
- The question schema — it maps almost 1:1 (`question→stem`, `correct→correctJson`,
  `source/sourceUrl→reference*`).

**Changes:**
- `window.__CCAOF__` inlining is **removed**; the SPA fetches from `/api/*`.
- Scoring moves server-side; the client no longer holds keys.
- Auth gating, dark mode, per-exam theming, exam catalog + switcher, scenario rendering.

**CCAO-F content migration:** extract the current `window.__CCAOF__` blob into
`data/ccao-f/questions.source.json` (+ study guide), validate, and seed into
`Questions`/`Exams`/`StudyGuide`. The self-contained `index.html` then becomes a
*source artifact only* and is removed from the deployed app.

**Offline incompatibility (resolved):** server-side scoring is fundamentally
incompatible with a double-click, no-server file — the file would have to contain the
keys. Per **decision A, the offline build is dropped entirely.** No DEMO sample build is
kept. (If you ever want a public teaser later, the safe form is a handful of throwaway
sample questions whose keys are deliberately non-secret — but that is not in scope now.)

---

## 8. Content-authoring workflow (CCDV-F, CCAR-F, CCAR-P → 300+ each + study guides)

Authoring is **data-only** — it never touches app code. Each exam is a self-contained
workstream producing `data/<exam>/questions.source.json` + `studyguide.source.json`,
passing the validation gate, then seeded.

**Per-domain authoring loop (mirrors the CCAO-F method):**
1. **Fetch & read** the relevant doc pages for the domain (see per-exam grounding
   below) and the exam-guide objectives; extract verifiable facts with their URLs.
2. **Author** items against those facts to the domain's blueprint weight, mixing
   single + multiple-response; distractors in the guides' style (plausible-but-wrong,
   "always/never" absolutes, over-engineered options). Randomize correct position.
3. **Verify pass:** re-check a sample of answers against the cited pages; fix errors;
   ensure every item carries a real doc URL (majority) or the exam-guide objective.
4. **Uniqueness + distribution** check across the growing bank.

**Grounding sources per exam (technical exams use developer/platform docs, NOT the
consumer Help Center):**
- **CCDV-F** — Messages API, tool use, streaming, batch, prompt caching, extended
  thinking; Agent SDK; Claude Code (CLAUDE.md, rules, hooks); MCP. Academy: developer /
  API / MCP / Claude Code courses.
- **CCAR-F** — same platform/Claude Code/MCP/Agent SDK docs, framed by the **6 scenarios
  from the exam guide** (reproduced below). Author questions **under** a `scenarioId`,
  each scenario weighted toward its guide-stated *primary domains* while collectively
  covering D1–D5.
- **CCAR-P** — platform/API docs plus RAG, evaluation, observability, and
  governance/compliance (GDPR/HIPAA/FedRAMP), stakeholder-comms objectives from the
  guide.

**Scenario authoring (CCAR-F) — decision H: 60 items per scenario → 360-item bank.**
Write the 6 scenario frames into the `Scenarios` table (verbatim from the guide), then
author **60 questions per scenario** (mix of single + multiple-response), skewed to that
scenario's primary domains. The **mock** draws **4 of 6 scenarios and samples 15 items
each = 60**, grouped and presented under their frames. Practice can filter by scenario
and/or domain. This 360-item bank comfortably exceeds the 300+ target and gives strong
per-scenario variety across mock attempts.

The 6 scenario frames (from the CCAR-F exam guide — reproduce these as the `frame` text):

| ID | Title | Frame (summary) | Primary domains |
|----|-------|-----------------|-----------------|
| S1 | Customer Support Resolution Agent | Support agent on the Agent SDK handling high-ambiguity returns/billing/account issues via custom MCP tools (`get_customer`, `lookup_order`, `process_refund`, `escalate_to_human`); target 80%+ first-contact resolution with correct escalation. | D1 Agentic Arch · D2 Tool/MCP · D5 Context/Reliability |
| S2 | Code Generation with Claude Code | Claude Code for generation/refactor/debug/docs; custom slash commands, CLAUDE.md configs, plan-mode vs direct execution. | D3 Claude Code · D5 Context/Reliability |
| S3 | Multi-Agent Research System | Agent SDK coordinator delegating to specialized subagents (web search, doc analysis, synthesis, report gen) producing cited reports. | D1 Agentic Arch · D2 Tool/MCP · D5 Context/Reliability |
| S4 | Developer Productivity with Claude | Agent SDK tools to explore unfamiliar/legacy code, generate boilerplate, automate tasks; built-in tools (Read/Write/Bash/Grep/Glob) + MCP servers. | D2 Tool/MCP · D3 Claude Code · D1 Agentic Arch |
| S5 | Claude Code for Continuous Integration | Claude Code in CI/CD: automated code review, test generation, PR feedback; prompts that give actionable feedback and minimize false positives. | D3 Claude Code · D4 Prompt/Structured Output |
| S6 | Structured Data Extraction | Extract from unstructured docs, validate against JSON schemas, high accuracy, graceful edge cases, downstream integration. | D4 Prompt/Structured Output · D5 Context/Reliability |

(Full verbatim frames are captured in the guide extract; store them unabridged in
`Scenarios.frame`.) Guide-confirmed structure: 60 items, 4-of-6 scenarios, 120 min, 720
cut, and a score report showing **pass/fail + scaled score + percent-correct by domain**.

**Study-guide course links — Anthropic Academy (Skilljar).** Catalog root:
`https://anthropic.skilljar.com/` (Academy relaunched Mar 2026; ~17 free courses across
AI Fluency, Product/Claude 101, Developer deep-dives — API/MCP/Claude Code — Cloud &
Enterprise). Map courses to each exam's audience in the study guide:

| Exam | Cite these Academy tracks/courses |
|------|-----------------------------------|
| CCAO-F (built) | Claude 101, AI Fluency (already linked in the current guide) |
| CCDV-F | Building with the Claude API · MCP (build servers/clients) · Claude Code / Agent Skills |
| CCAR-F | Claude Code (config, slash commands, CLAUDE.md) · MCP · Agent SDK / multi-agent |
| CCAR-P | Claude API · MCP · plus RAG / eval / governance references from platform docs |

Confirmed direct URL: *Building with the Claude API* →
`https://anthropic-partners.skilljar.com/claude-with-the-anthropic-api`. **Capture the
exact per-course URLs from the logged-in catalog during authoring** — the public
`all-courses` page blocks automated fetch (403), so the remaining course deep-links must
be copied from a browser session (small manual step, not a blocker).

**Validation gate (every bank must pass before seeding):**
`schema valid · every item has a reference · no duplicate/near-duplicate stems ·
domain weights within tolerance · multiple-response present · a re-verified answer
sample matches its cited sources.` Implemented as `data/tools/validate.mjs` (CI check).

**Recommended order & rough effort** (S/M/L per *domain-cluster of work*; a full
300+ bank + guide is a larger multi-session effort per exam):
1. **CCAR-F first** (your call) — **L.** Establishes the scenario pipeline end-to-end;
   6 scenario frames + grouped items across 5 domains. Highest structural novelty.
2. **CCDV-F** — **M–L.** Largest reusable doc-reading investment (platform/API/MCP/Claude
   Code) that also feeds CCAR-P; standard format, so it's mostly volume once CCAR-F has
   proven the pipeline.
3. **CCAR-P** — **L.** Broadest/deepest (RAG, governance, compliance, stakeholder); reuses
   much of CCDV-F's platform grounding but adds heavy governance sourcing.

(If de-risking scenarios were *not* the priority, CCDV-F-first would minimize total
doc-reading. You chose CCAR-F-first — noted and planned above.)

**Open item:** confirm the CCAR-F scenario→question counts (how many items per scenario,
summing to 60 for the mock and 200+ for the bank) and the Skilljar course URLs to cite
for the technical audiences.

---

## 9. Session / attempt lifecycle

**State machine:**
```
(none) --POST /attempts--> in-progress --PATCH*--> in-progress
                                   │                    │
                     POST /submit  │                    │ now > expiresAt (mock)
                                   ▼                    ▼
                               submitted           expired (auto-submitted, still scored)
   in-progress older than 3 days  ─────lazily purged────►  (deleted)
```

- **Create:** `POST /attempts` writes an `in-progress` row with server `startedAt`
  (+`expiresAt` for mock), `optionOrder`, and (CCAR-F mock) the 4-scenario pick.
- **Persist:** `PATCH` writes incremental state; server-authoritative, so resume works
  cross-device. Local storage is a **fast cache only**, reconciled against the server on
  load (server wins).
- **Resume:** `GET /attempts?status=in-progress` restores everything. Mock `remainingMs`
  is computed from the server clock, so closing the tab does **not** pause it.
- **Finalize:** `POST /submit` scores and locks the attempt (idempotent).

**Mock keeps running + auto-submit on expiry:** time is anchored to server
`expiresAt`. If the timer elapses while away, the next request touching that attempt
(resume, submit, or history) **auto-finalizes** it from the last saved answers with
`status="expired"` (still scored). No timer trigger needed — expiry is evaluated on read.

**Practice/Study are not penalized:** no `expiresAt`; a `practiceElapsedMs` stopwatch is
persisted and simply resumes. Pausing (closing the tab) costs nothing.

**3-day auto-clear (lazy, Free-tier-safe):** managed Functions are HTTP-only (no timer),
so cleanup is *opportunistic*: whenever a user lists/creates attempts, the handler first
deletes that user's `in-progress` rows with `purgeAt < now`. This bounds stale state
without a scheduler. (If a guaranteed global sweep is ever required, add a BYO Functions
timer — Alternative 1 — but it is not needed for correctness.)

**Two-tab / two-device conflict policy:** each attempt row carries a `rev` + native
ETag. `PATCH` sends the last known `rev`; if another tab advanced it, the server returns
`409` with the authoritative state, and the client prompts **"This attempt continued
elsewhere — load latest / overwrite."** For **mock**, because state is server-anchored
and `submit` is idempotent, two tabs converge safely (first submit wins; the second
receives the finalized result). Last-write-wins is the fallback for practice.

**Incremental saves never reveal correctness:** `PATCH` returns only `{ok, rev, savedAt,
serverNow, expiresAt}`. Correctness is exposed solely by `answer` (practice) and
`submit` — so mid-mock saving cannot be used to probe the key.

---

## 10. Progress-analytics plan

Both charts are fed **only** by `GET /api/me/history` (aggregates: dated `scaled`
scores, pass/fail, per-domain %). No questions or keys, so analytics stay client-rendered
without weakening protection.

- **Score history (line):** X = dated attempts within the window; Y = 100–1000. A
  horizontal **cut line** at the selected exam's `cutScore`. Points colored pass/fail.
  Animations: cut line eases into position → score line draws left-to-right → points
  stagger in. Line uses the **selected exam's accent** token.
- **Average % correct by domain (bars):** one bar per domain from the **exam's
  metadata** (not hardcoded), averaged over the window. Bars grow from 0 (staggered);
  colored by strength (green ≥70 / amber ≥50 / red <50); value fades in.
- **Window toggle** 7 / 30 days, **by date** (server filters `submittedAt ≥ now−N`).
- **Scope toggle** per-exam vs all-exams. All-exams uses each exam's accent for its
  points and swaps domain bars for "avg score by exam" (domains aren't comparable across
  exams).
- **Constraints (all required):** hand-rolled SVG/CSS (no library); works in light +
  dark; **reduced-motion → render final state**, never blank; responsive with no
  horizontal overflow at 360–390px (viewBox scaling); accessible (`role="img"` +
  descriptive `aria-label` summarizing the trend); **empty-state prompt** when the
  window has no attempts.

### Result verdict + "barely passing" study recommendations (decision I)
Every finalized attempt renders a **verdict banner** and a per-domain readout that drive
the user to what to study next:

- **Verdict highlight by outcome:**
  - **Pass, comfortable** (`scaled ≥ 720 + buffer`, default buffer 40 → **≥ 760**): **green**
    banner, "You're exam-ready" (still lists any weak domains as optional review).
  - **Pass, marginal** (`720 ≤ scaled < 760`): **amber** banner — "Passing, but thin."
    Surfaces the study recommendation block (below). Amber is distinct from the green/red
    pass/fail so a squeaker doesn't read as a solid pass.
  - **Fail** (`scaled < 720`): **red** banner — "Below the 720 cut." Study block shown.
- **Study recommendation block** (shown for marginal-pass and fail): from the attempt's
  `byDomain`, list every domain **below a mastery threshold (default 70%)**, ranked
  weakest-first, each with:
  - the domain name + its % correct and the exam's blueprint weight (so high-weight weak
    domains sort up — weak × heavy = biggest score lever),
  - a **"Study this →" deep link** to that domain's section in the exam's Study guide
    (the weakest-domain-callout nice-to-have, promoted into core because you asked for it),
  - for a **fail**, also a "Retry incorrect / practice this domain" action.
- **Semantics stay separate:** the verdict green/amber/red are the *semantic* tokens
  (`--correct/--amber/--wrong`), never an exam accent — consistent with §14 so a pass on
  the fuchsia exam is still green, not fuchsia.
- **Thresholds are config**, not magic numbers: `passBuffer` (40) and `masteryPct` (70)
  live in app config so you can tune "barely passing" without code changes. Same logic
  feeds the Home readiness estimate and the domain bar colors (green ≥70 / amber ≥50 /
  red <50), keeping one coherent color story.
- **Accessibility:** verdict is conveyed by text + icon, not color alone (color-blind
  safe); the study block is a real list with links, keyboard-navigable.

---

## 11. Threat model + security-boundary statement

**Assets:** the answer key (correct options + rationale + reference), the question stems,
and each user's private results.

**What server-side scoring + auth DO prevent:**
- Casual key extraction via **View Source / Network tab** — the client never receives
  `correct/rationale/reference` for unsubmitted items.
- **Bulk scraping** of the key by unauthenticated parties — every route requires the
  `authorized` role; `userId` is server-derived; direct Function access is only via SWA
  (the principal header is injected, not client-settable).
- **Cross-user data access** — attempts are partitioned by `userId`; the API only queries
  the caller's partition.
- Mid-mock key probing — incremental saves return no correctness (§9).

**What it does NOT prevent (accepted residual risk):**
- An **authorized user can see stems + options** (they must, to take the exam) and can
  **screenshot / transcribe** them. Server-side scoring protects the *key*, not the
  *questions*, from a legitimate viewer.
- Over many attempts an authorized user could **harvest keys one submit at a time**.
  Mitigations: trust boundary is the invited team (<25); per-user attempt logging;
  rate-limit `submit`/`answer`; no endpoint returns the *whole* key set at once. A
  determined insider is out of scope — the control is *who gets invited*.
- Screenshots/telemetry are not DRM'd; no attempt is made to prevent a trusted user from
  copying what they can see.

**Safe to keep client-side:** the **progress charts** — they consume only the user's own
aggregates (dates, scaled scores, per-domain %), never questions or keys, so rendering
them in the browser does not enlarge the attack surface.

**Additional boundaries to implement:** validate `x-ms-client-principal` on every route;
never trust a client-supplied `userId`; input-validate all bodies; enforce optimistic
concurrency; strip key fields in a single projection function; keep error messages
key-free; store the storage connection string only in app settings/secrets.

---

## 12. Nice-to-haves backlog (sequenced after Phases 1–3)

Effort S/M/L · dependency · "free once auth/API/store exist?" · conflict check.

| Item | Effort | Depends on | Basically free? | Conflict? |
|------|--------|-----------|-----------------|-----------|
| Cross-device resume | S | server-authoritative attempts | **Yes** (falls out of §9) | none |
| Review mode (wrong/flagged/by-domain) | M | stored attempt review | Mostly | none (post-submit only) |
| Retry-incorrect / spaced repetition | M | attempt history + question tags | Partly | none (server serves stems) |
| Weakest-domain callouts → jump to study | S | `byDomain` aggregates | **Yes** | none |
| Export MY results (CSV / PDF) | S / M | history API | **Yes** (own data only) | none |
| Installable PWA + offline **shell** cache | M | service worker | Partly | **Must not cache questions/keys**; scored actions stay online |
| Offline / DEMO sample build | — | — | — | **Dropped** (decision A) |
| Bookmarks & personal notes | M | new per-user table | Mostly | none (per-user) |
| Full a11y pass beyond AA | M–L | — | n/a | none |
| Per-exam content versioning + changelog | M | version fields on exam/question | Partly | none |
| Author/reviewer bulk import + `reviewer` role | L | auth roles + validation gate | Partly | drafts' keys must stay server-side |
| Configurable practice (count/domains/seed) | S | attempt filters | **Yes** (mostly exists) | none |
| Timezone-correct timer/date display | S | store UTC, render local | **Yes** | none |

---

## 13. Remaining open decisions

**Resolved this round:** identity for credential-less users (Entra email OTP / B2B —
decision E, §4) · security posture + Standard tier (decision F, §15) · scoring formula
(decision G, §5) · CCAR-F sizing 60/scenario→360 bank, mock 4×15 (decision H, §8) ·
results verdict + study recommendations (decision I, §10) · rate-limit starting values
(§15) · allowlist table as role source of truth (§4) · Skilljar catalog root + the exam→
course mapping (§8).

**Still genuinely open (need your input or a small follow-up):**
1. **Per-course Skilljar deep-links** — the `all-courses` page blocks automated fetch
   (403); the exact URLs must be copied from a logged-in browser session during
   authoring. Confirm you want the full set captured then, or give me the links.
2. ~~Multi-response scoring rule~~ **RESOLVED** — the CCAR-F guide (§10) documents no
   partial credit, so multiple-response is **all-or-nothing** (selected set must equal the
   key set exactly). Locked in `IMPLEMENTATION_SPEC.md`.
3. **CCAR-F per-scenario domain mix** — each scenario skews to its guide-stated primary
   domains; confirm you're fine letting the 360-bank hit the D1–D5 weights *in aggregate*
   (mock sampling then approximates blueprint) rather than forcing every scenario to
   mirror the full blueprint.
4. **External graders' access level** — do invited external (email-OTP) users get full
   `authorized` access, or a narrower role?
5. **"Barely passing" thresholds** — I defaulted `passBuffer=40` (marginal = 720–759) and
   `masteryPct=70`. OK, or different bands?
6. **PR preview environments** — enable as the phone testing path? (Recommended: yes;
   note previews are also access-gated so they don't expose content.)
7. **Timezone for "by date" windows + 3-day expiry** — UTC internally, display local?
   (Recommended.)
8. **Exam lineup re-check before launch** — program is expanding through 2026; re-verify
   the four names/codes/blueprints against the live cert portal at launch.
9. **Audit-log retention period** — pick a retention window for the security `Audit`
   stream (§15).

---

## 14. Theming plan — light/dark + per-exam accent identity

### Token architecture
Two layers of CSS custom properties:

1. **Semantic base tokens** (theme-dependent, exam-independent):
   `--ink, --ink-2, --muted, --bg, --surface, --surface-2, --line, --line-strong,
   --correct/-tint, --amber/-tint, --wrong/-tint, --focus`.
   - `:root` defines **light** values.
   - `@media (prefers-color-scheme: dark) { :root { … } }` sets **dark** values (OS
     default).
   - `:root[data-theme="light"]` / `:root[data-theme="dark"]` **explicitly override** so
     a user toggle *wins over* the OS media query in both directions.

2. **Per-exam accent tokens** (theme-independent identity, applied by scope):
   The active exam sets `--accent, --accent-ink, --accent-tint` (and their dark variants)
   on a scoping element (`<body data-exam="CCDV-F">` or the workspace root) from the
   exam's `theme_*` metadata. Components reference `--accent*` only — never a hardcoded
   hue — so pills, the exam switcher highlight, the score-history line, and the cut line
   all recolor per exam automatically.

### Toggle + persistence
- Toggle writes `data-theme` on `:root` and persists **per user** (localStorage
  `theme`, optionally mirrored to a user-prefs row so it follows cross-device).
- **Default = OS** (`prefers-color-scheme`) until the user explicitly chooses.
- Semantic **green/amber/red stay put** across exams so answer/score states are never
  confused with an exam's identity color.

### Proposed per-exam accent palette
Hues spread far apart and clear of the semantic green (~140°) / amber (~40°) / red (~5°).
Each exam carries a light accent, a lighter dark-mode accent (for contrast on dark
surfaces), an `accentInk` (text/links on light), and an `onAccent` (text on the pill).

| Exam | Hue | `accent` (light) | `accentInk` | `accentDark` (dark-mode) | `onAccent` |
|------|-----|------------------|-------------|--------------------------|-----------|
| CCAO-F | Indigo ~235° | `#3b44d9` (keep) | `#2a31a8` | `#8b93ff` | `#ffffff` |
| CCDV-F | Cyan-blue ~195° | `#0e7490` | `#155e75` | `#38bdf8` | `#ffffff` |
| CCAR-F | Violet ~265° | `#6d28d9` | `#5b21b6` | `#a78bfa` | `#ffffff` |
| CCAR-P | Fuchsia ~328° | `#a21caf` | `#86198f` | `#e879f9` | `#ffffff` |

Fuchsia (328°) is deliberately far from red (5°) to avoid a "wrong answer" read.

### AA-contrast check matrix (validate during implementation)
Targets: **≥4.5:1** for normal text (accent-ink on surface; onAccent text on the pill
fill), **≥3:1** for large text / UI accents (the chart line, cut line, focus ring
against the plot background). Verify **each exam accent × {light, dark} × {on-surface,
on-pill}**, and confirm each accent is distinguishable from the semantic trio.

| Check (per exam) | Light | Dark |
|------------------|-------|------|
| `accentInk` text on `--surface` (≥4.5) | verify | use `accentDark` on dark surface (≥4.5) |
| `onAccent` (#fff) on `accent`/`accentDark` pill (≥4.5) | verify | verify |
| accent as chart line/cut vs plot bg (≥3) | verify | verify |
| accent ≠ green/amber/red (perceptual + CB-safe) | verify | verify |

The four light accents (#3b44d9, #0e7490, #6d28d9, #a21caf) all clear ~4.5:1 on white
with white text on the fill; dark-mode variants are lightened specifically to hold
≥4.5:1 on the dark surface. **Final values must be run through a contrast validator (and
a color-blindness check) during Phase 3**, adjusting lightness — not hue — if any cell
misses, so exam identities stay distinct.

---

## 15. Security hardening & posture (security-team baseline)

This tool is built and used by a security team; the bar is "assume hostile, prove it
safe." Defense-in-depth across identity, data, transport, app, and supply chain. Items
marked **[Std]** need SWA Standard tier (already chosen, decision F); the rest are free.

### Identity & access
- **[Std] Tenant-locked custom Entra SSO** with **MFA + Conditional Access** enforced by
  policy (device/location/risk). GitHub is secondary and also role-gated (§4).
- **Least-privilege roles** (`authorized`, future `reviewer`); **allowlist table** is the
  single source of truth so **de-provisioning is one delete**, and every grant is audited.
- Server-side role + `userId` derivation from `x-ms-client-principal` on **every** route;
  routing rules are a convenience, not the control. Reject any client-supplied identity.
- Short session lifetimes; sign-out clears SWA auth cookie.

### Data protection
- **[Std] Managed identity → Table Storage** (Entra RBAC `Storage Table Data
  Contributor`, scoped to the one account) — **no connection string exists to leak**.
- **Answer keys never leave the server** (§3.2/§5/§11); single strict projection function;
  optional split-table defense-in-depth.
- Storage: encryption at rest (default), **TLS 1.2+ only**, **disable public blob/anon
  access**, key rotation N/A under managed identity. **[Std] private endpoint / firewall**
  so Storage is reachable only from the Functions, not the public internet.
- Per-user partitioning is the tenancy boundary; no endpoint returns another user's data;
  **no all-users aggregate endpoint** exists.
- Secrets (if any remain, e.g., Entra client secret) live in **Key Vault** referenced by
  app settings — never in the repo, never in the client. Prefer certificate/managed
  identity over secrets where possible.

### Application / transport
- **Strict security headers** (set via `staticwebapp.config.json` `globalHeaders`):
  `Content-Security-Policy` (default-src 'self'; no inline where avoidable — the app is
  no-build so we can move to external JS + nonces), `Strict-Transport-Security`
  (HSTS, preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `Permissions-Policy` locking down
  camera/mic/geo.
- **Input validation** on every API body (allowlist fields, bound sizes, validate
  `examId`/`qid`/answer shapes); reject unknown fields. Output is JSON only; no HTML
  reflection. Parameterize all Table queries (no key injection via user input).
- **Rate limiting (best-practice starting values — decision "5"):** per-user, per-route,
  sliding window (enforced in the Function via a small `RateLimit` table or in-memory +
  429 with `Retry-After`):
  - `submit`: **10 / hour / user** (anti key-harvest — the sensitive one),
  - `answer` (practice): **120 / hour / user**,
  - `POST /attempts` (start): **30 / hour / user**,
  - `PATCH` (save): **600 / hour / user** (autosave-friendly),
  - `history` / `catalog`: **300 / hour / user**.
  Tune after observing real usage; log all 429s.
- **Idempotent, tamper-resistant scoring:** score only server-side against the stored
  key; submit is idempotent; mock time is server-anchored (client clock is never trusted).
- CSRF: SWA auth uses bearer principal header (not ambient cookies for the API), plus
  `SameSite` cookies; state-changing routes are POST/PATCH only.

### Observability & supply chain
- **Audit log** of security events (grants/revokes, sign-ins, submits, 401/403/429,
  admin actions) to **Application Insights** / a `Audit` table; retain per policy.
- **Alerting** on anomalies (spikes in `submit`/`answer` per user = harvesting; auth
  failures). Cost note: App Insights has a free data grant; keep sampling on.
- **Supply chain:** minimal/zero runtime dependencies (the app is vanilla; the API uses
  only the Azure SDK); enable **Dependabot** + **CodeQL** + **secret scanning** on the
  repo; pin/lock versions; review the SWA deploy token scope.
- **Least-privilege CI:** the GitHub Actions deploy uses the SWA deploy token as a repo
  secret; the seed workflow uses a **separate** identity scoped to Storage only; protect
  `main` with required checks + review.

### Residual risk (unchanged from §11)
Server-side scoring protects the *key*, not the *stems* — an authorized user can still
screenshot questions or harvest keys slowly via `submit` (now rate-limited + logged +
alerted). The control of last resort is **who is invited**. This is accepted and
documented, not solved by technology.

---

## Appendix — verification checklist per phase (quick reference)

- **Phase 1:** anonymous blocked at `/` and `/api/*`; non-invited authenticated user
  denied; GitHub-invited and email-invited users both admitted.
- **Phase 2:** no key fields in content/save payloads (Network tab + grep); submit/
  practice-answer are the only key-bearing responses; CCAO-F fully seeded from store.
- **Phase 3:** 4-exam landing with distinct colors; full 4-tab workspace per exam;
  switcher preserves place; CCAR-F mock shows 4-of-6 grouped scenarios; charts
  recolor/re-domain per exam; dark/light toggle covers every surface at AA and persists.
```
