# Test Bank Analysis — validity & difficulty

Dual-role review (Anthropic AI expert + certification psychometrician) over every item. Each item was
checked for a correct, doc-grounded key and rewritten toward legitimate cert-exam difficulty and realism.

| Exam | Items | Valid (ok+fixed) | Fixed keys | Dubious | Difficulty E / M / H |
|------|-------|------------------|-----------|---------|----------------------|
| CCAO-F | 303 | 303 (100%) | 28 | 0 | 27% / 54% / 19% |
| CCDV-F | 351 | 350 (100%) | 6 | 1 | 26% / 52% / 22% |
| CCAR-F | 378 | 378 (100%) | 9 | 0 | 25% / 53% / 22% |
| CCAR-P | 316 | 316 (100%) | 31 | 0 | 25% / 51% / 25% |

**Notes**
- "Fixed keys" = items whose answer/options the expert corrected during review.
- "Dubious" = items the reviewer could not fully verify against docs; recommend SME attention first.
- "Reverted" revisions (uniqueness guard) kept the original stem to avoid duplicates.
- Difficulty is the reviewer's calibration to a minimally-qualified candidate; the target mix is ~25/50/25.
- All banks pass `validate.mjs` (schema, references, unique stems, domain coverage, multi-response).
- Content remains AI-authored + AI-reviewed; a human SME spot-check per exam is still recommended before high-stakes use.

**Flagged for SME review**
- `CCDV-F / G-D5-044` — extended-thinking `budget_tokens` migration to `claude-opus-4-8`; reviewer could not fully verify the version-specific detail against docs. Verify before use.
