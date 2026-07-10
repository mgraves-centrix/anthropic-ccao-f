// ============================================================================
// STRICT projection (spec §III.2). The ONLY way question data reaches the
// client. Returns stem+options+type+domain+scenario only — never the key,
// rationale, or reference. A change here that leaks a key must fail the
// key-leak gate (tests/security).
// ============================================================================
import type { QuestionRow, QuestionPublic } from "./types.js";

/** Project a stored question to its public (keyless) shape, optionally reordering options. */
export function projectQuestion(
  row: QuestionRow,
  optionOrder?: number[],
): QuestionPublic {
  const options = optionOrder
    ? optionOrder.map((i) => row.options[i]!)
    : [...row.options];
  const out: QuestionPublic = {
    qid: row.questionId,
    stem: row.stem,
    options,
    type: row.type,
    domain: row.domain,
  };
  if (row.scenarioId !== undefined) out.scenarioId = row.scenarioId;
  if (row.selectCount !== undefined) out.selectCount = row.selectCount;
  return out;
}

/** Fields that must NEVER appear in a client payload (used by the key-leak gate). */
export const FORBIDDEN_CLIENT_FIELDS = [
  "correct",
  "rationale",
  "referenceText",
  "referenceUrl",
] as const;
