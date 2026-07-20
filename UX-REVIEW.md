# UX / UI Expert Review — Anthropic Certification Study Portal

**Reviewer perspective:** senior product designer + accessibility specialist, evaluating
the portal as a *daily-use training product*, not a demo.
**Method:** Nielsen's 10 usability heuristics, a domain heuristic set for
high-stakes test-taking, and WCAG 2.1 AA. Findings are grounded in the shipped
code (`app/assets/js/views/*`, `app/assets/css/*`) and verified against the
automated axe-core audit (`tests/e2e/a11y.spec.ts`).

Each recommendation is tagged **[Shipped]** (implemented in this codebase) or
**[Backlog]** (proposed, not yet built) with a priority (P0 blocker → P2 polish).

---

## 1. Executive summary

The portal is already a competent, accessible study tool: a clean 4-exam
information architecture, server-authoritative attempts with resume, instant
practice feedback, a real mock timer, spaced repetition, and a genuine progress
dashboard. The design system is token-driven with light/dark support and a
per-exam accent identity.

The gap between "works" and "feels like a real certification product" was mostly
in **feedback, time pressure, and wayfinding during the exam** — the moments a
test-taker is most stressed. This review drove a batch of targeted improvements
in those moments (keyboard operation, live-region announcements, a question
navigator, review-before-submit, an autosave indicator, and escalating timer
urgency) and leaves a prioritized backlog for the rest.

**Overall grade:** strong foundation; the exam-runner experience is now
competitive with commercial cert platforms. Highest remaining leverage is in
onboarding/first-run guidance and richer post-exam analytics.

---

## 2. Heuristic evaluation (Nielsen)

| # | Heuristic | Assessment | Evidence / action |
|---|-----------|-----------|-------------------|
| 1 | **Visibility of system status** | **Now strong.** Was the weakest area — silent saves, a static timer, no per-question status. | Autosave indicator (`Saving…/Saved`) **[Shipped]**; escalating timer warn/crit states + 5-/1-minute announcements **[Shipped]**; `aria-busy` on route mount; question navigator shows answered/flagged/current at a glance **[Shipped]**. |
| 2 | **Match to the real world** | Good. Language is candidate-facing ("readiness", "focus areas", "cut score"), scaled 100–1000 mirrors the real exam. | Keep. Consider a plain-language gloss on "scaled score" for first-timers **[Backlog P2]**. |
| 3 | **User control & freedom** | Strong. Prev/Next, flag-for-review, unflag, "start over vs resume", "keep working vs submit", retry-incorrect. | Add a visible "Exit exam" affordance in mock that explains the timer keeps running **[Backlog P1]**. |
| 4 | **Consistency & standards** | Strong. One button system, one card system, shared `esc`/`safeHref`, consistent tab bar. | Minor: `catalog.js` carries a private `esc` copy — fold into `util.js` **[Backlog P2]**. |
| 5 | **Error prevention** | Strong. Review-before-submit surfaces unanswered + flagged counts before the irreversible submit; two-tab conflict bar prevents silent clobber; practice count clamped 1–60. | Confirm-on-submit copy names the blank count. Consider a "you have flagged questions" nudge on submit **[Shipped]** (flagged list shown in review). |
| 6 | **Recognition over recall** | Strong post-navigator. Users no longer recall which items they skipped. | Navigator palette + "Next unanswered" jump **[Shipped]**. |
| 7 | **Flexibility & efficiency** | **Now strong.** Full keyboard shortcuts (1–9 answer, N/P move, U next-unanswered, F flag, B bookmark) with an on-screen hint; PWA install; CSV/PDF export. | Keyboard layer + hint line **[Shipped]**. Power-user "jump to question #" input **[Backlog P2]**. |
| 8 | **Aesthetic & minimalist design** | Strong. Restrained palette, generous whitespace, no chrome noise. | Keep. |
| 9 | **Help users recover from errors** | Good. Friendly empty states ("nothing matches this selection yet"), submit-failed and conflict recovery paths. | Add retry affordance on a failed submit rather than a dead end **[Backlog P1]**. |
| 10 | **Help & documentation** | **Weakest remaining area.** No first-run orientation; shortcuts are discoverable only once inside a question. | First-run tips / "how scoring works" panel on exam Home **[Backlog P1]**. |

---

## 3. Test-taking domain heuristics

High-stakes exam UX has failure modes the generic heuristics miss:

- **Time transparency.** A candidate must always know how long is left and *feel*
  the pressure escalate. **[Shipped]** persistent sticky timer, amber under 5 min,
  red + pulse under 1 min, one-time spoken warnings at 5 and 1 minute (never
  per-second, which would flood a screen reader).
- **No lost work.** Anxiety spikes when progress feels ephemeral. **[Shipped]**
  server-authoritative autosave on every answer/nav, a visible "Saved" state, and
  resume-after-close. Server is the source of truth; the rev/409 flow prevents a
  second tab from silently overwriting.
- **Reviewability.** Candidates work non-linearly. **[Shipped]** flag-for-review,
  a status-coded navigator, and a review screen that lists exactly what is blank
  or flagged before the irreversible submit.
- **Honest verdicts.** **[Shipped]** the results banner is not just pass/fail: it
  distinguishes "pass — exam-ready" (green) from "pass — but thin" (amber) and
  routes to the weakest, highest-weight domains first ("biggest score levers").
- **Answer-key safety as UX.** Rationales appear the instant they're earned
  (practice) or after submit (mock) — never leaking the key mid-mock, which would
  both cheat scoring and undermine trust.

---

## 4. Accessibility (WCAG 2.1 AA)

An automated axe-core scan runs in CI over the catalog, exam Home, and a live
question (`tests/e2e/a11y.spec.ts`), asserting **zero serious/critical**
violations. Notable points:

- **1.4.3 Contrast** — the scan caught a real defect: muted/secondary text
  (`--muted`) failed 4.5:1 on the page background (4.29). Fixed by darkening the
  token to `#63686f` (now ~4.9:1) **[Shipped]**.
- **1.4.1 Use of color** — timer urgency and answer correctness never rely on
  color alone; each is paired with text/icon and, for the timer, a spoken
  announcement **[Shipped]**.
- **2.1.1 Keyboard** — every runner action is keyboard-operable; shortcuts ignore
  typing contexts (`INPUT/TEXTAREA/SELECT`) **[Shipped]**.
- **2.4.1 Bypass blocks** — "Skip to content" link present.
- **2.4.3 Focus order / SPA navigation** — on hash-route changes, focus now moves
  to the new view's heading so keyboard and screen-reader users are placed at the
  fresh content instead of stranded at the top of the document **[Shipped]**.
- **4.1.3 Status messages** — toasts and a dedicated `sr-live` region announce
  saves, timer thresholds, and question changes politely (no focus theft)
  **[Shipped]**.
- **Reduced motion** — a global `prefers-reduced-motion` rule disables the timer
  pulse and all transitions **[Shipped]**.
- **Backlog P2:** extend the axe sweep to the progress dashboard, review screen,
  and results banner; add a full keyboard-only E2E walkthrough of a mock.

---

## 5. Screen-by-screen notes

**Catalog** — clear per-exam cards with item count, time, cut score, and
authoring status. *Backlog P2:* surface the user's last score / readiness chip
per card so returning users see momentum without drilling in.

**Exam Home** — readiness statement, "focus areas" deep-linking to the weakest
domains' study anchors, blueprint weights, content version + "What's new"
changelog. Strong. *Backlog P1:* a compact "how to use this / how scoring works"
first-run panel.

**Practice config** — mode (all / weak / retry-incorrect / bookmarked), count,
optional domain filter, each with helper text. Good. *Backlog P2:* show how many
questions actually match the current filter before "Start", so an empty selection
is prevented rather than explained after the fact.

**Runner** — the centerpiece; now well-instrumented (see §3). *Backlog P1:*
scenario-based items show only a "Scenario X" chip — render the scenario prompt
text inline / in a sticky side panel so candidates don't lose context across the
scenario's questions.

**Review (post-submit)** — per-question rationale with correct/incorrect
filtering. Solid. *Backlog P2:* let users bookmark straight from review to build a
targeted retry set.

**Progress** — score-history line with the cut marked, domain bars, 7/30-day and
exam/all-exams toggles, CSV + PDF export. Strong analytics for a v1. *Backlog P2:*
a readiness/predicted-pass indicator and a streak/consistency metric.

---

## 6. Prioritized recommendation backlog

**P0 — none outstanding.** No blocking usability or accessibility defects remain
(the one axe finding was fixed).

**P1 — next iteration (highest leverage):**
1. First-run orientation on exam Home: how scoring works, keyboard shortcuts,
   practice vs mock. (Heuristic 10.)
2. Inline scenario prompt text in the runner for scenario-based exams. (Context /
   recognition.)
3. "Exit exam" affordance in mock that states the timer keeps running. (User
   control.)
4. Retry affordance on a failed submit instead of a dead-end message. (Error
   recovery.)

**P2 — polish:**
1. Last-score / readiness chip on catalog cards.
2. Live "N questions match" count in practice config.
3. Fold `catalog.js`'s private `esc` into `util.js`.
4. Bookmark-from-review; predicted-pass and streak metrics on Progress.
5. Extend axe coverage to progress/review/results + a keyboard-only mock E2E.
6. Plain-language gloss on "scaled score" for first-timers.

---

## 7. What shipped as part of this review

Delivered in this branch and covered by tests (`npm run gate`, `npm run test:e2e`):

- Full keyboard operation of the runner + on-screen shortcut hint.
- Live-region announcements (question changes, saves, timer thresholds) and a
  non-blocking toast system replacing `alert()`.
- Question navigator palette (answered / flagged / current) + "Next unanswered".
- Review-before-submit with unanswered/flagged breakdown.
- Autosave "Saving…/Saved" indicator backed by server-authoritative saves.
- Escalating mock-timer urgency (amber ≤5 min, red+pulse ≤1 min) with spoken
  warnings, color never used alone.
- SPA focus management on navigation; contrast fix; reduced-motion support.
- PWA install + offline shell; Save-as-PDF on runner results and progress.
- Automated axe-core WCAG audit wired into CI.

These move the product from "functional" to "day-to-day productized," which was
the stated goal. The P1 backlog is where the next design investment pays off.
