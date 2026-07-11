import { test, expect, type Page } from "@playwright/test";

// Drive the REAL frontend (router, views, runner, charts, theme) with the API
// and auth mocked at the network layer — no backend/SWA runtime needed.

const theme = {
  accent: "#3b44d9", accentInk: "#2a31a8", accentTint: "#ececfb",
  accentDark: "#8b93ff", accentInkDark: "#b6bbff", accentTintDark: "#23253a", onAccent: "#fff",
};
const exam = (examId: string, name: string) => ({
  examId, name, itemCount: 60, timeLimitMin: 120, cutScore: 720, scaleMin: 100, scaleMax: 1000,
  format: "standard", price: 99, status: "live",
  domains: [{ id: 1, name: "Alpha", weight: 50 }, { id: 2, name: "Beta", weight: 50 }], theme,
});
const questions = (n: number) => Array.from({ length: n }, (_, i) => ({
  qid: `Q${i}`, stem: `Question ${i + 1}: which option is best?`, options: ["Option A", "Option B", "Option C", "Option D"], type: "single", domain: 1,
}));

async function mockApi(page: Page) {
  await page.route("**/.auth/me", (r) => r.fulfill({ json: { clientPrincipal: { userId: "u", userDetails: "sam@centrixlabs.com", identityProvider: "aad", userRoles: ["authenticated", "authorized", "admin"] } } }));
  await page.route("**/api/catalog", (r) => r.fulfill({ json: [exam("CCAO-F", "Claude Certified Associate – Foundations"), exam("CCDV-F", "Claude Certified Developer – Foundations")] }));
  await page.route("**/api/study/**", (r) => r.fulfill({ json: { title: "Study Guide", sections: [{ id: "s", label: "Overview", kind: "prose", body: ["Study this."] }] } }));
  await page.route("**/api/me/history**", (r) => r.fulfill({ json: { scope: "exam", examId: "CCAO-F", window: 7, cutScore: 720, points: [{ date: "2026-07-08", scaled: 690, pass: false, examId: "CCAO-F" }, { date: "2026-07-09", scaled: 780, pass: true, examId: "CCAO-F" }], byDomain: [{ id: 1, name: "Alpha", avgPct: 82 }, { id: 2, name: "Beta", avgPct: 44 }] } }));
  await page.route("**/api/access-requests**", (r) => r.fulfill({ json: [{ provider: "aad", providerUserId: "x", displayName: "Pat", email: "pat@contoso.com", justification: "need access" }] }));
  await page.route("**/api/bookmarks**", (r) => r.fulfill({ json: r.request().method() === "GET" ? [] : { ok: true } }));
  await page.route("**/api/attempts/*/answer", (r) => r.fulfill({ json: { correct: true, correctKeys: [0], rationale: "Because Option A is correct.", reference: { text: "Docs", url: "https://docs.claude.com/x" } } }));
  await page.route("**/api/attempts/*/review", (r) => r.fulfill({ json: { scaled: 780, pass: true, verdict: "green", correct: 0, total: 1, byDomain: { "1": { c: 0, t: 1, pct: 0 } }, weakDomains: [], review: [{ qid: "Q0", yourAnswer: [1], correct: false, correctKeys: [0], rationale: "The correct choice is A.", reference: { text: "Docs", url: "https://docs.claude.com/x" } }] } }));
  await page.route("**/api/attempts/*/submit", (r) => r.fulfill({ json: { scaled: 780, pass: true, verdict: "green", correct: 1, total: 1, byDomain: { "1": { c: 1, t: 1, pct: 100 } }, weakDomains: [], review: [{ qid: "Q0", yourAnswer: [0], correct: true, correctKeys: [0], rationale: "A is right.", reference: { text: "Docs", url: "https://docs.claude.com/x" } }] } }));
  await page.route("**/api/attempts", (r) => {
    if (r.request().method() === "POST") {
      const body = JSON.parse(r.request().postData() || "{}");
      const isMock = body.mode === "mock";
      return r.fulfill({ json: { attemptId: "a1", mode: body.mode, serverNow: "2026-07-10T12:00:00Z", ...(isMock ? { expiresAt: "2099-01-01T00:00:00Z" } : {}), questions: questions(isMock ? 1 : 2) } });
    }
    return r.fulfill({ json: [] }); // GET resume
  });
}

test.beforeEach(async ({ page }) => { await mockApi(page); });

test("catalog lists exams and opens a 4-tab workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Certification exams" })).toBeVisible();
  await expect(page.locator(".examcard")).toHaveCount(2);
  await page.getByText("Claude Certified Associate – Foundations").click();
  await expect(page).toHaveURL(/#\/exam\/CCAO-F\/home/);
  for (const t of ["Home", "Practice", "Mock", "Study", "Progress"]) await expect(page.getByRole("link", { name: t, exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-exam", "CCAO-F");
});

test("practice: configure → run → instant feedback → bookmark", async ({ page }) => {
  await page.goto("/#/exam/CCAO-F/practice");
  await expect(page.getByRole("heading", { name: "Configure practice" })).toBeVisible();
  await expect(page.locator('input[name="pmode"]')).toHaveCount(4); // all/weak/incorrect/bookmarked
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.locator(".qstem")).toBeVisible();
  await page.locator("[data-bmk]").click(); // bookmark the question
  await expect(page.locator("[data-bmk]")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".opt").first().click();
  await expect(page.locator(".rationale")).toContainText("Option A is correct");
});

test("mock → review answers shows per-question rationale + filters", async ({ page }) => {
  await page.goto("/#/exam/CCAO-F/mock");
  await expect(page.locator(".qstem")).toBeVisible();
  await page.locator(".opt").first().click();
  await page.getByRole("button", { name: "Review & submit" }).click();
  await page.getByRole("button", { name: /^Submit mock/ }).click();
  await page.getByRole("button", { name: "Review answers" }).click();
  await expect(page.locator(".revq").first()).toBeVisible();
  await expect(page.getByText("The correct choice is A.")).toBeVisible();
  await page.getByRole("button", { name: "Incorrect", exact: true }).click(); // filter chip
  await expect(page.locator(".revq")).toHaveCount(1);
});

test("mock: navigator + review-before-submit, then verdict", async ({ page }) => {
  await page.goto("/#/exam/CCAO-F/mock");
  await expect(page.locator(".qstem")).toBeVisible();
  await expect(page.locator("#mockTimer")).toBeVisible();
  await expect(page.locator(".navmap .navdot")).toHaveCount(1); // navigator palette present
  await page.getByRole("button", { name: /Flag for review/ }).click(); // flag it
  await page.getByRole("button", { name: "Review & submit" }).click();
  await expect(page.getByText("Flagged for review:")).toBeVisible(); // pre-submit review lists it
  await page.getByRole("button", { name: /^Submit mock/ }).click();
  await expect(page.locator(".verdict--green")).toBeVisible();
  await expect(page.locator(".verdict__score")).toContainText("780");
});

test("progress renders hand-rolled SVG charts", async ({ page }) => {
  await page.goto("/#/exam/CCAO-F/progress");
  await expect(page.locator("svg[role=img]").first()).toBeVisible();
  await expect(page.locator("text=720 · pass")).toBeVisible();
});

test("theme toggle flips the theme; exam switcher navigates", async ({ page }) => {
  await page.goto("/#/exam/CCAO-F/home");
  await page.locator("#themeToggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
  await page.locator("#examSel").selectOption("CCDV-F");
  await expect(page).toHaveURL(/#\/exam\/CCDV-F\/home/);
});

test("admin sees pending requests", async ({ page }) => {
  await page.goto("/#/exam/CCAO-F/home");
  await page.locator(".adminlink").click();
  await expect(page.getByRole("heading", { name: "Access requests" })).toBeVisible();
  await expect(page.getByText("need access")).toBeVisible();
});
