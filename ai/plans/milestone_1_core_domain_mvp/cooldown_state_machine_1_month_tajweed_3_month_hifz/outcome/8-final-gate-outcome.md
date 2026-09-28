# Task 8 Outcome — Phase 4 Final Quality Gate + Deferred-Items Enforcement

> **Date:** 2026-09-27 · **Ticket:** `docs/planning/TICKETS.md:818-868` (T2-008 — Dev 2 · M1 · 5 SP)
> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Specs:** `specs.md` (REQ-001..REQ-011) · **Design:** `plan.md` · **Ledger:** `deferred-items.md` · **Task def:** `tasks.md` Phase 4
> **Scope guard:** Task 8 is a VERIFICATION gate — zero source modifications. It authored only this outcome, flipped its own `tasks.md` checkboxes, and appended the worklog record. No `git commit`.
> **Git state at gate time:** baseline commit `94160b9` → HEAD `d8487d2` (6 plan commits: enum/repo/i18n foundation, journey test-first, service, mapper fix, GraphQL mutation, SDL regen); worktree CLEAN (`git status --porcelain` → empty).

---

## 1. Gate-by-gate table

| # | Gate | Command | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| G1a | Two-source-split file-level grep | `rg "suspended" backend/services/teachers/applicant-lifecycle.service.ts backend/db/repo/teachers/applicant.repository.ts` | matches ONLY in pre-existing docblock (`:19`) + pre-existing repo projections (`:97`, `:296`) — zero NEW-code mentions | exactly 3 matches, all three byte-identical at baseline `94160b9` (§2 proof) | ✅ PASS |
| G1b | Two-source-split DIFF-SCOPED grep (the security gate) | `git diff 94160b9..HEAD -- <both files> \| grep "^+" \| rg suspended` | ZERO matches (exit 1) | exit 1 — zero matches in every added line of both files | ✅ PASS |
| G2 | Zero-delta rubric-path (REQ-003.5) | `git diff --stat 94160b9..HEAD -- backend/services/teachers/evaluation-rubric.helpers.ts shared/constants/evaluation-rubric.constants.ts` | EMPTY | EMPTY (exit 0, no output); working-tree form + `git status` on both pathspecs also empty | ✅ PASS |
| G3 | Deferred-items ledger | `grep -cE "^\| D[0-9]+ .*(❌\|⚠️)" deferred-items.md` | 0 | `0` (grep exit 1 = no row-anchored ❌/⚠️; D1..D7 all 📋) | ✅ PASS |
| G4 | Traceability | `for r in $(grep -oE 'REQ-[0-9]+' specs.md \| sort -u); do grep -q "$r" tasks.md \|\| echo MISSING: $r; done` | zero MISSING | zero MISSING — REQ-001..REQ-011 (11 ids) all present in `tasks.md` | ✅ PASS |
| G5a | Typecheck | `bun tsgo` | exit 0; 0 "error TS" (baseline 0) | exit 0; `grep -c "error TS"` → 0 | ✅ PASS |
| G5b | Biome | `bun biome:check` | exit 0; 0 warns (baseline 0) | exit 0; `grep -c warn` → 0; "Checked 2476 files … No fixes applied"; tree stayed clean | ✅ PASS |
| G5c | Type-aware lint | `bun run scripts/lint-service.ts --id final` | exit 0; clean (baseline `success=true`, empty output) | exit 0; only the locked-runner banner, no findings | ✅ PASS |
| G6 | 8.QL sub-loop ×19 | `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per file (single-file script) | 19 × exit 0 | 19 × exit 0 (§4 file list) | ✅ PASS |
| G7 | 8.TE test suite (11 suites) | see §5 | all green at pinned counts | 400 pass / 0 fail / 2731 expects | ✅ PASS |
| G8 | Journey | `bun run test/scripts/run-test.ts test/workflows/teachers/cooldown-state-machine.test.ts` | 12 pass / 0 fail; 12 steps asserted | **12 pass / 0 fail / 264 expects** — full step matrix §6 | ✅ PASS |

**All 8 gates green → FINAL-GATE: PASS** (verdict line at §8).

## 2. Two-source-split grep proofs (8.SEC / REQ-006.2 — quoted output)

### 2.1 File-level (`rg "suspended"` over both files)

```text
backend/services/teachers/applicant-lifecycle.service.ts:19: *     `applicants.cooldown_until` ONLY — never `users.suspended` or any
backend/db/repo/teachers/applicant.repository.ts:97:  readonly suspended: boolean | null;
backend/db/repo/teachers/applicant.repository.ts:296:      suspended: users.suspended,
```

All three matches are PRE-EXISTING (each byte-identical in `git show 94160b9:<file>`, line-for-line):

1. **`applicant-lifecycle.service.ts:19`** — inside the pre-existing module JSDoc block (`:15-22` shown): `*` comment line stating the cooldown decision "never `users.suspended`". This is the DOCUMENTED ABSENCE, not a write — the comment is a ` * ` JSDoc line; no `.set(`, no column assignment. The tasks.md gate's distinguishing condition ("verify the grep distinguishes the comment from a write") is satisfied: the only service mention is prose inside a docblock, unchanged by this plan.
2. **`applicant.repository.ts:97`** — `readonly suspended: boolean | null;` field of the pre-existing admin-directory row shape.
3. **`applicant.repository.ts:296`** — `suspended: users.suspended,` inside the pre-existing `listDirectory` projection (the tasks.md-cited out-of-diff mention; `:97` is its row-type sibling, also pre-existing).

### 2.2 DIFF-SCOPED proof (the binding form: zero matches in NEW code)

```text
$ git diff 94160b9..HEAD -- backend/services/teachers/applicant-lifecycle.service.ts \
      backend/db/repo/teachers/applicant.repository.ts | grep "^+" | rg "suspended"
(exit 1 — ZERO matches)
```

Every added line of both files is free of `suspended`. Supporting isolations: `git diff 94160b9..HEAD -- backend/db/repo/teachers/applicant.repository.ts | grep "^+" | rg "users"` → zero (the pre-existing `users` import at `:26` is untouched; the new `extendCooldownOnce` writes ONLY `applicants.cooldown_until` + `updated_at`); the service has zero `@/backend/db/schema` imports (the `users` table is not imported at all). Runtime locks hold in the green suites: repo test 9, the service two-source-split probe (direct `users` row read → `suspended === false`, `suspendedAt === null`, `suspendedPeriodDays === null`), the wire-test triple, and journey steps 2/5/12 (`expectGovernanceTripleUntouched`).

## 3. Baseline-delta statement

Baseline (`outcome/0-baseline-outcome.md`, clean tree at `94160b9`): tsgo **0** errors · biome **0** warnings · lint-service **clean** (`success=true`, empty output). Final-gate results: tsgo **0** · biome **0** · lint **clean**. **Delta = 0 / 0 / 0 — zero new errors, warnings, or lint findings.** (`biome` checked 2476 files vs 2471 at baseline: the plan's 5 new tracked TS files; "No fixes applied", tree clean after the run.)

## 4. 8.QL sub-loop ledger (19 files × `--lifecycle duplicates` → exit 0)

`backend/enum/teachers/applicant-cooldown-state.enum.ts` · `applicant-cooldown-state.enum.test.ts` · `index.ts` · `backend/types/teachers/applicant.types.ts` · `backend/db/repo/teachers/applicant.repository.ts` · `backend/db/test/repo/teachers/applicant.repository.test.ts` · `shared/locale/types/errors/labels.ts` · `shared/locale/en/errors/index.ts` · `shared/locale/ar/errors/index.ts` · `shared/locale/errors-namespace.parity.test.ts` · `backend/services/teachers/applicant-lifecycle.service.ts` · `applicant-lifecycle.service.test.ts` · `backend/services/admin/user-management.mappers.ts` · `test/workflows/teachers/cooldown-state-machine.test.ts` · `backend/graphql/pothos/shared/enum.pothos.ts` · `backend/graphql/pothos/teachers/applicant.pothos.ts` · `backend/graphql/mutation/admin/admin-governance.mutation.ts` · `backend/graphql/test/admin-applicant-cooldown.wire.test.ts` · `backend/graphql/test/schema-surface.test.ts`

All 19 ran as individual single-file invocations (the script is single-file only) and each printed `✅ All checks for lifecycle "duplicates" passed` with exit 0 (tsgo → oxlint → biome → lint:type-aware → check:duplicates).

## 5. 8.TE full-suite results (via `bun run test/scripts/run-test.ts`)

| Suite | Result | Expects |
|---|---|---|
| `backend/enum/teachers/applicant-cooldown-state.enum.test.ts` | 22 pass / 0 fail | 283 |
| `shared/locale/errors-namespace.parity.test.ts` | 50 pass / 0 fail | 382 |
| `shared/locale/applicant-namespace.parity.test.ts` | 35 pass / 0 fail | 374 |
| `backend/db/test/repo/teachers/applicant.repository.test.ts` | 17 pass / 0 fail | 56 |
| `backend/db/test/repo/teachers/applicant.repository.transition.test.ts` (sibling regression) | 32 pass / 0 fail | 103 |
| `backend/services/teachers/applicant-lifecycle.service.test.ts` | 56 pass / 0 fail | 327 |
| `backend/db/test/logic/teachers/applicant-lifecycle.test.ts` | 10 pass / 0 fail | 38 |
| `backend/services/admin/user-management.service.test.ts` | 61 pass / 0 fail | 236 |
| `backend/graphql/test/admin-applicant-cooldown.wire.test.ts` | 12 pass / 0 fail | 54 |
| `backend/graphql/test/schema-surface.test.ts` | 93 pass / 0 fail | 614 |
| `test/workflows/teachers/cooldown-state-machine.test.ts` (journey) | 12 pass / 0 fail | 264 |
| **TOTAL** | **400 pass / 0 fail** | **2731** |

## 6. Journey matrix (12/12 asserted — REQ-011)

| Step | Assertion | Result |
|---|---|---|
| 1 | System: cast + certified evaluators + open tajweed cycle (4 rubrics) | PASS |
| 2 | System: 5th submission finalizes FAIL — cooldown ≈ now+30d, `failed`, account untouched (two-source-split lock) | PASS |
| 3 | Applicant: self profile `Active` + not purchasable | PASS |
| 4 | Applicant: purchase DENIED `APPLICANT_COOLDOWN_ACTIVE` (422 family, zero writes) | PASS |
| 5 | Admin: +60d extension lengthens the stored base verbatim (≈ stamped+90d), ONE adjust audit row | PASS |
| 6 | Applicant: profile observes the extended instant, still `Active` | PASS |
| 7 | System: expiry passes → read-model `Expired` (still re-purchasable) | PASS |
| 8 | Applicant: re-application purchase SUCCEEDS — attempts+1, `failed → in_evaluation` | PASS |
| 9 | Non-admin: extension DENIED `FORBIDDEN` at the mutation scope, zero writes | PASS |
| 10 | Admin: certified applicant's cooldown cannot be extended (`APPLICANT_ALREADY_CERTIFIED`), zero writes | PASS |
| 11 | Admin: `additionalDays: 0` rejected `APPLICANT_COOLDOWN_EXTENSION_INVALID`, zero writes | PASS |
| 12 | System: hifz arc replay — lowest failing score drives the 90-day minimum | PASS |

## 7. 8.SR semantic-review checklist (final-gate spot re-verification)

- **Two-source split:** §2 proofs (code-diff + runtime + test pins). ✅
- **Races:** extend-vs-finalize and extend-vs-certification concurrency probes ran green inside the 56/0 service suite; the guarded repo WHERE-predicate + `APPLICANT_ALREADY_FINALIZED`/certified-conflict collapse verified by the implementing tasks and re-run green. ✅
- **Enums-as-values:** value imports confirmed (`ApplicantStatus` at `applicant.repository.ts:27`, `ApplicantCooldownState`/`ApplicantStatus`/`AuditActionType` at `applicant-lifecycle.service.ts:53-55`, `applicant.pothos.ts`/`enum.pothos.ts` registrations, `UserRole` at `admin-governance.mutation.ts:47`); no `import type` on any runtime enum in the new code; no hardcoded member arrays in Pothos files. ✅
- **No cross-layer imports:** `shared/locale/**` has zero `@/backend|@/frontend|@/app` imports (all files, tests included); zero `@/backend/db/schema` imports in the service/mapper; zero `@/backend/db/repo` imports in the mutation/Pothos files. ✅
- **No dead code:** the new i18n leaf ships WITH its consumer in the same diff (`extendApplicantCooldown`); the known D6 guard-consumer gap is the ledgered intentional deferral (📋, not a blocker). ✅
- **Hygiene:** zero `console.*` in added CODE lines (the only match is a test pin asserting the source does NOT contain `console.`); zero plan-artifact refs (`REQ-\d`/`Task \d`/`Phase \d`/plan-file names) in added code lines; zero `Translation.` / two-arg `getTranslations` / `getBackendTranslations`. (The unscoped whole-diff grep hits live exclusively under `ai/plans/**` documentation, which legitimately references them.) ✅

## 8. Final verdict

Baseline-delta 0/0/0 · two-source-split grep proofs clean (file-level matches all pre-existing; diff-scoped zero) · rubric-path zero-delta · ledger 0 blockers · traceability 0 misses · 19/19 sub-loops · 400/0 tests incl. the 12/12 journey.

**FINAL-GATE: PASS**
