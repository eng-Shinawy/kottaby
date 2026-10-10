# Evidence Matrix — §8. Decision Verification (All 33 Resolved Decisions) (Task 5.3 · REQ-013 AC-3)

**Checklist section:** `docs/planning/PRODUCTION_READINESS.md` §8 — Decision Verification (All 33 Resolved Decisions) · **33 rows** (21 AUTOMATED-TEST · 11 SCRIPT-PROBE · 1 DOC-SIGNOFF)

**Reconciliation source (definitive gate report):** `docs/planning/launch-report-20261009T191940Z.json` — 173 rows, 165 PASS / 8 WAIVED / 0 FAIL; verdict FAIL solely because the 8 waiver signatories are blank (task 4.5 signs). The earlier `launch-report-20261009T165246Z.json` (64 rows) is historical evidence, not a reconciliation source.

**Section tally:** 32 PASS + 1 WAIVED = 33 rows — every report row with `section: 8` appears exactly once below, no extras, none missing (33/173 of the full census).

**Disposition notation:** `✅ PASS` = report `result: PASS`, `exitStatus: 0` (all 173 rows carry exitStatus 0). `☐ WHY` = report `result: WAIVED` — the row carries its waiver verbatim from the report's `waivers[]` array (WHY text + named owner), keyed to the `deferred-items.md` ledger pointer; full waiver text in the Waiver detail section below. All evidence paths are repo-relative.

## Matrix (rowId → modality → command → evidenceRef → disposition)

| rowId | modality | command | evidenceRef | disposition |
|---|---|---|---|---|
| `8.1` | SCRIPT-PROBE | `bun run scripts/launch/probe-decisions.ts` | `logs/2026-10-09T22-12-09/probe-decisions.log` | ✅ PASS |
| `8.2` | SCRIPT-PROBE | `bun run scripts/launch/probe-decisions.ts` | `logs/2026-10-09T22-12-09/probe-decisions.log` | ✅ PASS |
| `8.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/logic/students/handshake-code-generation-locks.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/logic/students/handshake-code-generation-locks.test.ts.log` | ✅ PASS |
| `8.4` | SCRIPT-PROBE | `bun run scripts/launch/probe-decisions.ts` | `logs/2026-10-09T22-12-09/probe-decisions.log` | ✅ PASS |
| `8.5` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/logic/audit/audit-immutability.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/logic/audit/audit-immutability.test.ts.log` | ✅ PASS |
| `8.6` | SCRIPT-PROBE | `bun run scripts/launch/probe-decisions.ts` | `logs/2026-10-09T22-12-09/probe-decisions.log` | ✅ PASS |
| `8.7` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/schema/users/users-governance.static-assertions.test.ts` | `logs/2026-10-09T22-12-09/backend/db/schema/users/users-governance.static-assertions.test.ts.log` | ✅ PASS |
| `8.8` | SCRIPT-PROBE | `bun run scripts/launch/probe-decisions.ts` | `logs/2026-10-09T22-12-09/probe-decisions.log` | ✅ PASS |
| `8.9` | SCRIPT-PROBE | `bun run scripts/launch/probe-decisions.ts` | `logs/2026-10-09T22-12-09/probe-decisions.log` | ✅ PASS |
| `8.10` | SCRIPT-PROBE | `bun run scripts/launch/probe-decisions.ts` | `logs/2026-10-09T22-12-09/probe-decisions.log` | ✅ PASS |
| `8.11` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts shared/constants/evaluation-rubric.constants.test.ts` | `logs/2026-10-09T22-12-09/shared/constants/evaluation-rubric.constants.test.ts.log` | ✅ PASS |
| `8.12` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `8.13` | DOC-SIGNOFF | `bun run test/scripts/run-test.ts shared/constants/session-fees.constants.test.ts` | `docs/planning/PRODUCTION_READINESS.md` | ✅ PASS |
| `8.14` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/sessions/session-dual-confirmation.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/sessions/session-dual-confirmation.journey.test.ts.log` | ✅ PASS |
| `8.15` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts.log` | ✅ PASS |
| `8.16` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/applicant.repository.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/repo/teachers/applicant.repository.test.ts.log` | ✅ PASS |
| `8.17` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts.log` | ✅ PASS |
| `8.18` | SCRIPT-PROBE | `bun run scripts/launch/probe-decisions.ts` | `logs/2026-10-09T22-12-09/probe-decisions.log` | ✅ PASS |
| `8.19` | SCRIPT-PROBE | `bun run scripts/launch/probe-decisions.ts` | `logs/2026-10-09T22-12-09/probe-decisions.log` | ✅ PASS |
| `8.20` | SCRIPT-PROBE | `bun run scripts/launch/probe-decisions.ts` | `logs/2026-10-09T22-12-09/probe-decisions.log` | ✅ PASS |
| `8.21` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/enum/shared/surah-juz-ref.enum.test.ts` | `logs/2026-10-09T22-12-09/backend/enum/shared/surah-juz-ref.enum.test.ts.log` | ✅ PASS |
| `8.22` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/repo/students/student.repository.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/repo/students/student.repository.test.ts.log` | ✅ PASS |
| `8.23` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/repo/students/student.parent-monitoring.repository.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/repo/students/student.parent-monitoring.repository.test.ts.log` | ✅ PASS |
| `8.24` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/parents/parent-link-request.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/parents/parent-link-request.service.test.ts.log` | ✅ PASS |
| `8.25` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/teachers/teacher-inactivity.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/teachers/teacher-inactivity.service.test.ts.log` | ✅ PASS |
| `8.26` | SCRIPT-PROBE | `bun run scripts/launch/probe-decisions.ts` | `logs/2026-10-09T22-12-09/probe-decisions.log` | ☐ WHY + owner — waived (ledger D2); full text in Waiver detail below; signatory blank at report time |
| `8.27` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/billing/subscription-admin.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/billing/subscription-admin.service.test.ts.log` | ✅ PASS |
| `8.28` | AUTOMATED-TEST | `bun run test:graphql backend/graphql/test/session-arbitration.wire.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-session-arbitration.log` | ✅ PASS |
| `8.29` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/logic/admin/admin-user.repository.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/logic/admin/admin-user.repository.test.ts.log` | ✅ PASS |
| `8.30` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/evaluation.repository.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/repo/teachers/evaluation.repository.test.ts.log` | ✅ PASS |
| `8.31` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/schema/classes/report-homework-schema.static-assertions.test.ts` | `logs/2026-10-09T22-12-09/backend/db/schema/classes/report-homework-schema.static-assertions.test.ts.log` | ✅ PASS |
| `8.32` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/repo/classes/recitation.repository.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/repo/classes/recitation.repository.test.ts.log` | ✅ PASS |
| `8.33` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/logic/shared/schema-registry-census.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/logic/shared/schema-registry-census.test.ts.log` | ✅ PASS |

## Waiver detail (verbatim from the report's `waivers[]`)

**8.26:**

- **WHY:** The teacher_request_preference pgEnum (backend/db/schema/enums.ts:271), the teacher.request_preference column (backend/db/schema/teachers/teacher.ts:54), and the TS mirror exist and are probe-verified; the runtime intake (queue / reject / offer_alternatives) is waived-with-sign-off to the matching/intake backlog (deferred-items ledger D2).
- **Owner:** Dev 3 (matching/intake backlog)
- **Ledger pointer:** `deferred-items.md` D2 (✅ resolved-pointer, waived-with-sign-off)
- **Signatory:** blank in the report (`signatory: ""`) — the task-4.5 human sign-off attaches it; an unsigned waiver blocks the verdict exactly like a failed row (`PRODUCTION_READINESS.md:12`)

## Reproducibility

- Row registry: `scripts/launch/launch-checklist.ts` · gate harness: `scripts/launch/launch-gate.ts` · report writer: `scripts/launch/launch-report.ts` (per-row tuples + stages + waivers + verdict)
- Re-run: `LOAD_TEST_EMAIL=… LOAD_TEST_PASSWORD=… ADMIN_PASSWORD='Seed_Pass1!' bun run scripts/launch/launch-gate.ts` (drill servers on `127.0.0.1:3100` / `:3101`); log evidence under `logs/<run-stamp>/`
- This matrix: 33/33 §8 rows reconciled 1:1 with the definitive report; count-verified (total across §1–§9 matrices: 173/173).

