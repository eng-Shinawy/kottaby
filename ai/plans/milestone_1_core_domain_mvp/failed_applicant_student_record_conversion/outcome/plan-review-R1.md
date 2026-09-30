# Plan Review — Round 1 (Phase 1.5 Gate)

> **Plan directory:** `ai/plans/milestone_1_core_domain_mvp/failed_applicant_student_record_conversion/`
> **Ticket:** `Failed Applicant → Student Record Conversion` (`docs/planning/TICKETS.md:872-912`) — Dev 2 · Milestone 1 · 3 SP
> **Skill applied:** `@plan-review` (`.agents/skills/plan-review/SKILL.md`) — pre-implementation gate
> **Artifacts reviewed:** `specs.md` (544 lines) · `plan.md` (573 lines) · `tasks.md` (275 lines) · `deferred-items.md` (70 lines)
> **Reviewer:** orchestrator (plan-authoring session)
> **Date:** 2026-09-30

## 1. Verdict

**Plan passes all AGENTS.md rules for the affected layers, after 6 fixes applied in Round 1.**
No blocking architecture, i18n, type-pattern, or test-convention violation remains. The plan is
implementation-ready (subject to its declared `Blocked By` dependency on the Cooldown State Machine).

## 2. Layers touched → rule files applied

| Layer | Paths | Rule files read |
|---|---|---|
| Repositories | `backend/db/repo/users/user.repository.ts` | `backend/db/repo/AGENTS.md`, `backend/AGENTS.md`, `backend.instructions.md` |
| Service | `backend/services/teachers/applicant-conversion.service.ts`, `evaluation-rubric.helpers.ts`, `index.ts` | `backend/services/AGENTS.md`, `backend/AGENTS.md`, `backend.instructions.md` |
| DB tests | `backend/db/test/logic/users/user.repository.test.ts` | `backend/db/test/AGENTS.md`, `tests.instructions.md` |
| Journey tests | `test/workflows/teachers/applicant-student-conversion.journey.test.ts` | `test/workflows/AGENTS.md`, `tests.instructions.md` |
| Docs | `docs/teachers/*.md` | root `AGENTS.md` |

No frontend (`app/`, `frontend/`), no GraphQL resolver/Pothos file, and no schema/migration file is
touched — the corresponding rule sets (MUI v9, Apollo documents, Drizzle schema) are out of play by
construction (zero delta, explicit no-UI ruling).

## 3. Dimensions checked

| Dimension | Result | Evidence |
|---|---|---|
| Type definitions | PASS | No local/Pothos type; both service functions return `Promise<void>`; repo method returns `boolean`; `backend/types/` additions are conditional-only (Task 4). |
| Service boundaries | PASS (N/A) | No client component; conversion runs inside the existing rubric submission transaction. |
| MUI v9 | PASS (N/A) | No frontend file. |
| i18n | PASS | Reuses `errorsTranslations.handshakeExhausted` (`shared/locale/en/errors/index.ts:75` + `ar` parity); server text via single-arg `getServerTranslations(locale)` from `@/shared/locale/server-graphql`; no `next-intl`, no `Translation.` enum, no two-arg `getTranslations`. |
| Logging | PASS | Backend `logger` (`@/backend/lib/logger`); no `console.*`; no logging on the happy/idempotent path. |
| Test conventions | PASS | Repo tests `runInRollback` + `tx`-threaded (F4); journey test real services + real DB, no `runInRollback`, tracked cleanup. |
| GraphQL documents | PASS (N/A) | No Apollo document added. |
| Path accuracy | PASS after fixes | All cited `path:line` verified against the working tree (F1, F2, F3, F6). |
| Traceability | PASS | REQ-001…REQ-011 each appear in `specs.md`, `plan.md`, and `tasks.md`; D1…D10 each appear in `plan.md` and `tasks.md`; every ticket Gherkin clause maps to a REQ + task + test. |
| Deferred-items ledger | PASS | 5 entries (D1–D5), all 📋; blocker grep `^\| D[0-9]+ .*(❌\|⚠️)` returns 0. |

## 4. Findings & Fixes (Round 1)

| # | Severity | Dimension | Finding | Fix applied |
|---|---|---|---|---|
| F1 | MEDIUM | Path accuracy | `plan.md` §10 file #5 cited `backend/services/test/teachers/applicant-conversion.service.test.ts`; service tests are **co-located** (`backend/services/teachers/<name>.service.test.ts`), not under a `services/test/` tree. | Corrected to `backend/services/teachers/applicant-conversion.service.test.ts`. |
| F2 | MEDIUM | Path accuracy | `plan.md` §10 file #6 cited `backend/services/test/teachers/evaluation-rubric*.test.ts`. | Corrected to `backend/services/teachers/evaluation-rubric.service.test.ts` (the real shipped file). |
| F3 | MEDIUM | Path accuracy | `plan.md` §10 file #4 and `tasks.md` cited `backend/db/test/repo/users/user.repository.test.ts`; no `users` directory exists under `backend/db/test/repo/`. The canonical `UserRepository` test file is `backend/db/test/logic/users/user.repository.test.ts` (`runInRollback`, `tx`-threaded, `entity-setup`). | Repointed all 3 `tasks.md` occurrences + `plan.md` §10; updated the layer→rule-file map row (`tasks.md`). |
| F4 | LOW | Convention completeness | Repo tests in the `repo/`/repo domain tree must reach 100% coverage of the new method; the plan implied but did not state it. | Covered by Task 1 `.TE` (Tier 1 100% branches) and the repo-test path fix (F3). |
| F5 | MEDIUM | Architectural consistency | `plan.md` §8 declared `convertToStudent(userId, tx)` and "return value ignored", while `tasks.md` Task 2 declared `convertToStudent(applicantUserId, tx, t)` and a `ConflictError("APPLICANT_ROLE_NOT_TEACHER")`. Also: a new localized key would have been required, contradicting the "no new key" requirement. | Reconciled both to `convertToStudent(applicantUserId, tx, t)`; the role invariant now throws a **plain `Error`** (internal inconsistency, mirroring `finalizeRubricPass`'s zero-row throw at `evaluation-rubric.helpers.ts:363`), so no new i18n key is needed. |
| F6 | LOW | Path accuracy | `specs.md` §3.7 cited `backend/db/test/helpers/entity-setup.ts`. | Corrected to `backend/db/test/entity-setup.ts`. |
| F7 | MEDIUM | Barrel / import hygiene | The new `ApplicantConversionService` was not added to the `backend/services/teachers/index.ts` domain barrel (sibling services are barrel-exported and re-exported via `@/backend/services`). | Added the barrel file to `plan.md` §10 (row 3) and as an explicit step in `tasks.md` Task 2. |
| F8 | LOW | Logging discipline | `tasks.md` Task 2 `.SR` required `logger.logDomainError` on the idempotent no-op path, contradicting the domain-service discipline (happy/idempotent paths emit nothing). | Reworded `.SR` to forbid logging on the happy/idempotent path. |

### Structural additions (fill-the-gap, no violation found)

- `plan.md` — appended **Appendix A** (explicit titled sections required by the plan structure gate): **A.1 Data Models** (canonical shapes touched, zero delta), **A.2 API Contracts & SDL** (per-surface delta = NONE), **A.3 Permission Matrix** (role × surface post-conversion), **A.4 UX / Navigation Specification** (explicit no-UI ruling). The design already contained Overview, decisions D1–D10, Repo/Service signatures, concurrency assessment (§7), Journey design (§11), and Security/Tenancy mitigations (§12).
- `specs.md` — removed a stray `@/frontend/utils/logger` mention from AC-002.1 (this plan ships zero frontend code; backend files use `@/backend/lib/logger`).

## 5. Anti-pattern sweep (Post-generation audit #4)

| Anti-pattern | Result |
|---|---|
| `Translation.` enum | Absent (only cited in prohibition text). |
| Two-arg `getTranslations(...)` | Absent (only cited in prohibition text). |
| `@/frontend/utils/logger` | Removed (F fix). |
| Raw `bun test` on workflows | Absent — journeys use `bun test test/workflows`; DB unit tests use `bun run test/scripts/run-test.ts`. |
| Bottom-nav surface | Absent (documented as nonexistent in the repo). |
| Invented paths | None remaining — every backtick-quoted path resolves in the working tree (F1–F3, F6 fixed). |

## 6. Truncation check (Post-generation audit #1)

All four artifacts end on complete prose/table lines (verified by tail inspection). No mid-sentence or
mid-table cutoff. Effective file sizes: `specs.md` 544 lines, `plan.md` 573 lines (incl. Appendix A),
`tasks.md` 275 lines, `deferred-items.md` 70 lines.

## 7. Residual risks carried to implementation (not review failures)

- **R4 (blocker not yet implemented):** the Cooldown State Machine ticket is not yet implemented; the conversion mechanics (Tasks 1–3) are independently testable because the shipped rubric fail path already stamps `cooldown_until`.
- **R3 / D9:** the converted account's JWT still asserts `teacher` until the next silent refresh; forced invalidation is deferred-by-design (`deferred-items.md` D3).
- **R6 / D6:** `myApplicantProfile` stays Teacher-only; the widening is a deferred cross-plan item (`deferred-items.md` D1).

## 8. Next steps

- [ ] Proceed to implementation following `tasks.md` (Task 0 → Phase 1.5 → Tasks 1–8).
- [ ] The Plan Review Gate is complete for Round 1; no Round 2 is required (zero unresolved violations).
- [ ] Commit the patched plan files.
