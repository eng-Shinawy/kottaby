# Plan Review R1 — Admin Academic Tracking (Memorization & Revision Milestones)

- **Reviewer**: plan-review gatekeeper (spec-driven Phase 1.5 gate, REQ-060)
- **Date**: 2026-09-21
- **Scope**: `specs.md` (577 ln) · `plan.md` (409 ln) · `tasks.md` (321 ln) · `deferred-items.md` (53 ln); `outcome/` research digests treated as trusted ground truth, spot-verified against the live tree where a violation was suspected.
- **Verdict**: **PASS-WITH-FIXES** — 6 findings, all fixed in place; zero unfixed critical findings.

## Findings table (check → result → evidence)

| # | Check | Result | Evidence (before fix) |
|---|---|---|---|
| 1 | Frontend logger path — must be `@/frontend/lib/logger` | ❌ FIXED (3 spots) | Real file: `frontend/lib/logger.ts` (`frontend/utils/logger` does NOT exist). `plan.md:93` (D9), `tasks.md:45`, `tasks.md:217` all said `@/frontend/utils/logger` |
| 2 | i18n leaf-path convention | ❌ FIXED | Task 4.1 (`tasks.md:178`) proposed flat `shared/locale/en/adminAcademic.ts`; live convention is directory leaves (`shared/locale/en/adminStudents/index.ts`). Fixed to `en/adminAcademic/index.ts` + `ar/adminAcademic/index.ts` |
| 3 | GraphQL documents path + sibling contract test | ❌ FIXED | Task 4.4 (`tasks.md:213`) said top-level `sharedDocuments/admin-academic-tracking.documents.ts`; live convention is `frontend/graphql/sharedDocuments/admin/` (flat kebab files inside, e.g. `admin-finance.documents.ts`) matching plan §6.4. Also added the sibling `academic-tracking.documents.test.ts` promised by plan §6.4 / REQ-031.3 but absent from the task |
| 4 | Wire/integration + journey test paths (plan↔tasks drift, sibling naming) | ❌ FIXED | Plan §9 cited `backend/graphql/test/admin-academic-tracking.wire.test.ts` — wrong lane (integration tests live in `frontend/graphql/test/admin/`, sibling `admin-finance.integration.test.ts`); tasks 5.2 lacked the `.integration` suffix. Journey filename drifted 3 ways (`academic-tracking-teacher-to-admin.journey.test.ts` in plan §9/§12, `academic-tracking-observation.test.ts` in task 5.1). Standardized: `frontend/graphql/test/admin/academic-tracking.integration.test.ts` and `test/workflows/admin/academic-tracking.journey.test.ts` (sibling: `*.journey.test.ts`) — 7 occurrences fixed across plan.md/tasks.md |
| 5 | Specs↔plan permission-matrix coherence (specs §2.2/§3.3 vs plan §4.4/D7) | ❌ FIXED | Plan D7 rules soft-deleted students viewable in admin drill-down (200 + governance banner; nonexistent id → admin-only NOT_FOUND; malformed → VALIDATION), but specs REQ-013.4, REQ-021 assumptions, and REQ-051.3 demanded constant-403 denial for ALL soft-deleted/nonexistent causes. specs.md updated at all 3 sites to bind the constant 403 to NON-ADMIN probes and record the D7 admin branches — specs §3.3 matrix and plan §4.4 now coherent |
| 6 | AGENTS.md update requirement vs Rule-File Policy | ❌ FIXED | specs REQ-062.2 + §6.1 required adding an Important References entry to root `AGENTS.md`; `.agents/spec-process-guide/execution/implementation-guide.md:350` + `templates/checklists.md:167` mandate "AGENTS.md files … hand-curated. Plan work NEVER creates or updates them" (tasks 6.2 already followed the policy). specs.md (2 sites) and plan.md §11 (1 site) corrected to docs-only propagation |
| — | i18n compliance: no `Translation.` enum, no two-arg `getTranslations`, no `next-intl`/`shared/messages/` | ✅ PASS | Only FORBIDDEN-list mentions; server i18n is single-arg `getTranslations(locale)`; `getServerTranslations(locale, ns)` two-arg use is the legitimate server-graphql API |
| — | MUI v9 sx-only, `*Outlined` icons, no hardcoded colors | ✅ PASS | plan D9, plan §6.4, tasks anti-pattern pins, 4.3.SR ("icon name not `*Outline`") |
| — | No raw `bun test` | ✅ PASS | Every runner reference is `bun run test/scripts/run-test.ts <path>`; raw form appears only in "NEVER raw" prohibitions |
| — | Invented-path spot-verification (all new-file paths in tasks.md) | ✅ PASS | `backend/types/admin/` (sibling `admin-user.types.ts`), `backend/db/repo/admin/`, `backend/services/admin/`, `shared/locale/types/` + `namespaces/` + root parity tests, `app/(dashboard)/admin/…`, `frontend/views/admin/…`, `test/workflows/admin/`, `frontend/graphql/test/admin/` all exist; `backend/db/test/repo/admin/` is a legitimate new-subdir CREATE mirroring the `repo/admin` split |
| — | REQ→task traceability (23 ids + REQ-053 reserved) | ✅ PASS | All 23 defined ids appear in `tasks.md` (`_Requirements:` lines + table); REQ-053 present as the reserved-note line (tasks.md:319); scripted loop over `grep -oE 'REQ-[0-9]+' specs.md \| sort -u` → 0 missing |
| — | Task pipeline .QL/.TE/.SEC/.SR/.IV | ✅ PASS | Present on every implementation task 1.1–5.2 and 6.2; 0.1/0.2/3.5/6.1/6.3 are gate/review tasks (pipeline N/A by template) |
| — | Knowledge-propagation task present | ✅ PASS | Task 6.2 → `docs/admin/academic-tracking.md` |
| — | No bottom-nav | ✅ PASS | Zero "bottom" hits across all four docs |
| — | GraphQL registration + SDL pins + codegen same-changeset | ✅ PASS | D5 + task 3.3 (both barrels touched once each; `schema-surface`/`sdl-static-assertions` pins 57→59 + `generate:gqlSchema`/`codegen` artifacts in the SAME changeset) |
| — | Truncation & structure | ✅ PASS | All four files end on complete lines; plan.md carries all 12 sections (Overview/decisions D1–D9 · Data Models · API contracts+SDL+§4.4 permission matrix · Services/Repos+§5.3 concurrency+§5.4 journey · UX/Nav · Security/Tenancy · Errors · Testing · Perf/Deploy · Outcome protocol · Self-cert) |
| — | deferred-items ledger | ✅ PASS (see limitation L1) | No ❌/⚠️ ledger rows; initialized empty per template |

## Fixes applied (what / where / why)

1. `plan.md:93`, `tasks.md:45`, `tasks.md:217` — `@/frontend/utils/logger` → `@/frontend/lib/logger` (the utils path does not exist on the tree; sub-loop/quality-gate would fail at implementation time).
2. `tasks.md` task 4.1 — locale leaves `en/adminAcademic.ts` → `en/adminAcademic/index.ts` (same for `ar/`), matching the verified `shared/locale/en/adminStudents/index.ts` convention.
3. `tasks.md` task 4.4 — documents path → `frontend/graphql/sharedDocuments/admin/academic-tracking.documents.ts` (+ sibling `.documents.test.ts` contract test + one `admin/index.ts` barrel export line), matching plan §6.4 and the live `admin-*.documents.ts` pattern; closes the REQ-031.3 contract-test gap.
4. Wire test: `plan.md:367` → `frontend/graphql/test/admin/academic-tracking.integration.test.ts`; `tasks.md` 5.2 (create + run lines) → same filename. Journey test: standardized to `test/workflows/admin/academic-tracking.journey.test.ts` at `plan.md:368`, `plan.md:404`, `tasks.md:233`, `tasks.md:241` — one canonical name, matching the sibling `*.journey.test.ts` convention.
5. `specs.md` REQ-013.4 (:155), REQ-021 assumptions (:202), REQ-051.3 (:325) — reconciled with plan D7: constant 403 binds to non-admin probes; admin branch = malformed → VALIDATION, nonexistent → NOT_FOUND, soft-deleted → viewable + governance banner. Permission matrices (specs §3.3 / plan §4.4) now coherent.
6. `specs.md` REQ-062.2 (:387) + §6.1 Canonical-doc row (:486), `plan.md` §11 (:389) — AGENTS.md Important References requirement removed per the spec-process-guide Rule-File Policy (hand-curated, never updated by plan work); knowledge propagation is docs-only.

Re-verification: `grep` for all stale tokens (`utils/logger`, `academic-tracking-observation`, `academic-tracking-teacher-to-admin`, `admin-academic-tracking.documents`, `backend/graphql/test/admin-academic`, flat `en/adminAcademic.ts`) → zero hits; REQ→task loop → 0 missing ids; all four files still end complete.

## Remaining known limitations (not fixable by this gate)

- **L1 — ledger gate grep counts legend symbols.** The final-gate check `grep -c "❌\|⚠️" deferred-items.md` (tasks 6.3, deferred-items.md §Enforcement) will always return >0 because the template's own Status-Values legend and usage prose contain ❌/⚠️ characters. The authoritative template (`.agents/spec-process-guide/templates/deferred-items-template.md:28-29,53`) carries the same symbols, so this is a repo-wide template limitation, not a plan defect. Executors should read the gate as "zero ❌/⚠️ **ledger-table rows**" (the finished-plan precedent `5_session_evaluation_loop_booking/tasks.md:183` uses the same wording).
- **L2 — thresholds are plan rulings, not ticket-spec'd.** The attention thresholds (D3: avg < 60 over last 10 graded Jadid rows; staleness 14 days) are design decisions with no ticket/planning-doc source (declared as such in specs R-D / plan D3) — flagged as a known ruling for product confirmation, not a violation.
- **L3 — REQ-062 AGENTS.md contradiction resolved toward the Rule-File Policy.** If the project later decides the Important References list should track new canonical docs, that is a hand-curation act outside plan scope (global instruction: update AGENTS.md only when a change alters what it documents).

**Verdict: PASS-WITH-FIXES — 6 findings, 6 fixed, 0 unfixed.** Implementation may proceed.
