// ============================================================================
// Scoring engine (spec §III.5, decision G). Reuses the CCAO-F formula exactly.
// Multi-response is ALL-OR-NOTHING (decision, confirmed vs exam guide §10).
// ============================================================================
import type {
  QuestionRow,
  Domain,
  ByDomain,
  Verdict,
  WeakDomain,
  SubmitResult,
  ReviewItem,
} from "./types.js";

export const CUT = 720;
export const GREEN = 760; // pass buffer 40 → marginal band 720..759
export const MASTERY_PCT = 70;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** ALL-OR-NOTHING: selected set must equal the key set exactly (order-independent). */
export function isItemCorrect(key: number[], answer: number[]): boolean {
  if (key.length !== answer.length) return false;
  const a = [...key].sort((x, y) => x - y);
  const b = [...answer].sort((x, y) => x - y);
  return a.every((v, i) => v === b[i]);
}

/** scaled = clamp(round(100 + accuracy*900), 100, 1000). 720 ⇔ acc ≈ 0.689. */
export function scaledFromAccuracy(acc: number): number {
  return clamp(Math.round(100 + clamp(acc, 0, 1) * 900), 100, 1000);
}

export function verdictFor(scaled: number): Verdict {
  if (scaled >= GREEN) return "green";
  if (scaled >= CUT) return "amber";
  return "red";
}

/**
 * Blueprint-weighted item apportionment — largest-remainder method.
 * Floors each domain's share, then distributes the leftover slots by largest
 * fractional remainder, clamped to the items available per domain.
 */
export function apportion(
  total: number,
  domains: Domain[],
  availableByDomain: Record<number, number>,
): Record<number, number> {
  const sumW = domains.reduce((s, d) => s + d.weight, 0) || 1;
  const exact = domains.map((d) => ({ id: d.id, e: (total * d.weight) / sumW }));
  const out: Record<number, number> = {};
  let used = 0;
  const rema: { id: number; rem: number }[] = [];
  for (const { id, e } of exact) {
    const floor = Math.min(Math.floor(e), availableByDomain[id] ?? 0);
    out[id] = floor;
    used += floor;
    rema.push({ id, rem: e - Math.floor(e) });
  }
  rema.sort((a, b) => b.rem - a.rem);
  let leftover = total - used;
  for (const { id } of rema) {
    if (leftover <= 0) break;
    const avail = availableByDomain[id] ?? 0;
    if (out[id] < avail) {
      out[id] += 1;
      leftover -= 1;
    }
  }
  return out;
}

/** Weak domains (< mastery), ranked by (mastery-pct)*weight desc — biggest score levers first. */
export function weakDomains(
  byDomain: ByDomain,
  domains: Domain[],
): WeakDomain[] {
  const nameOf = (id: number) => domains.find((d) => d.id === id)?.name ?? `Domain ${id}`;
  const weightOf = (id: number) => domains.find((d) => d.id === id)?.weight ?? 0;
  const out: WeakDomain[] = [];
  for (const [idStr, v] of Object.entries(byDomain)) {
    const id = Number(idStr);
    const pct = v.t ? Math.round((v.c / v.t) * 100) : 0;
    if (pct < MASTERY_PCT) {
      out.push({ id, name: nameOf(id), pct, weight: weightOf(id) });
    }
  }
  const lever = (d: WeakDomain) => (MASTERY_PCT / 100 - d.pct / 100) * d.weight;
  out.sort((a, b) => lever(b) - lever(a));
  return out;
}

/** Score a set of answered questions against their keys. */
export function scoreAttempt(
  questions: QuestionRow[],
  answers: Record<string, number[]>,
  domains: Domain[],
): SubmitResult {
  const byDomain: ByDomain = {};
  const review: ReviewItem[] = [];
  let correctCount = 0;

  for (const q of questions) {
    const given = answers[q.questionId] ?? [];
    const ok = isItemCorrect(q.correct, given);
    if (ok) correctCount += 1;
    const d = String(q.domain);
    byDomain[d] = byDomain[d] ?? { c: 0, t: 0 };
    byDomain[d].t += 1;
    if (ok) byDomain[d].c += 1;
    review.push({
      qid: q.questionId,
      yourAnswer: given,
      correct: ok,
      correctKeys: q.correct,
      rationale: q.rationale,
      reference: { text: q.referenceText, url: q.referenceUrl },
    });
  }

  const total = questions.length;
  const acc = total ? correctCount / total : 0;
  const scaled = scaledFromAccuracy(acc);
  const byDomainPct: SubmitResult["byDomain"] = {};
  for (const [id, v] of Object.entries(byDomain)) {
    byDomainPct[id] = { c: v.c, t: v.t, pct: v.t ? Math.round((v.c / v.t) * 100) : 0 };
  }

  return {
    scaled,
    pass: scaled >= CUT,
    verdict: verdictFor(scaled),
    correct: correctCount,
    total,
    byDomain: byDomainPct,
    weakDomains: weakDomains(byDomain, domains),
    review,
  };
}
