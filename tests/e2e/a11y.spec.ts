import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Automated accessibility audit (WCAG 2.1 A/AA) with axe-core on the key screens.
// Fails on any serious/critical violation.

const theme = { accent: "#3b44d9", accentInk: "#2a31a8", accentTint: "#ececfb", accentDark: "#8b93ff", accentInkDark: "#b6bbff", accentTintDark: "#23253a", onAccent: "#fff" };
const exam = { examId: "CCAO-F", name: "Claude Certified Associate – Foundations", itemCount: 60, timeLimitMin: 120, cutScore: 720, scaleMin: 100, scaleMax: 1000, format: "standard", price: 99, status: "live", version: 1, updatedAt: "2026-07-11", changelog: [{ version: 1, date: "2026-07-11", note: "Initial." }], domains: [{ id: 1, name: "Alpha", weight: 50 }, { id: 2, name: "Beta", weight: 50 }], theme };
const qs = (n: number) => Array.from({ length: n }, (_, i) => ({ qid: `Q${i}`, stem: `Question ${i + 1}: which is best?`, options: ["A", "B", "C", "D"], type: "single", domain: 1 }));

async function mock(page: Page) {
  await page.route("**/.auth/me", (r) => r.fulfill({ json: { clientPrincipal: { userId: "u", userDetails: "sam@centrixlabs.com", identityProvider: "aad", userRoles: ["authenticated", "authorized"] } } }));
  await page.route("**/api/catalog", (r) => r.fulfill({ json: [exam] }));
  await page.route("**/api/bookmarks**", (r) => r.fulfill({ json: r.request().method() === "GET" ? [] : { ok: true } }));
  await page.route("**/api/me/history**", (r) => r.fulfill({ json: { scope: "exam", examId: "CCAO-F", window: 7, cutScore: 720, points: [{ date: "2026-07-09", scaled: 760, pass: true, examId: "CCAO-F" }], byDomain: [{ id: 1, name: "Alpha", avgPct: 80 }, { id: 2, name: "Beta", avgPct: 55 }] } }));
  await page.route(/\/api\/attempts(\?|$)/, (r) => r.request().method() === "GET" ? r.fulfill({ json: [] }) : r.fulfill({ json: { attemptId: "a1", mode: "practice", questions: qs(2) } }));
}

const scan = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");

test.beforeEach(async ({ page }) => { await mock(page); });

test("a11y: catalog has no serious/critical violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".examcard")).toHaveCount(1);
  expect(await scan(page)).toEqual([]);
});

test("a11y: exam home has no serious/critical violations", async ({ page }) => {
  await page.goto("/#/exam/CCAO-F/home");
  await expect(page.getByRole("heading", { name: /Readiness/ })).toBeVisible();
  expect(await scan(page)).toEqual([]);
});

test("a11y: a live question has no serious/critical violations", async ({ page }) => {
  await page.goto("/#/exam/CCAO-F/practice");
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.locator(".qstem")).toBeVisible();
  expect(await scan(page)).toEqual([]);
});
