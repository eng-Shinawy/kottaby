# Plan Review R1 — Phase 1.5 `@plan-review` Gate (Task 1.9)

**VERDICT: PASS** — no CRITICAL/HIGH findings after applying the 0.2-outcome verified adjustments.
All MEDIUM/LOW findings below carry an explicit execution-time resolution; none change observable
behavior. Phase 2 (task 2.1) is unblocked.

**Date:** 2026-09-01 · **Requirements:** REQ-083
**Reviewed artifacts (READ-ONLY):** `specs.md`, `plan.md`, `tasks.md` of
`ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/`
**Method:** `.agents/skills/plan-review/SKILL.md` workflow — affected layers mapped, every layer
AGENTS.md / instruction file consulted (see §4), and every load-bearing in-tree claim of the plan
re-verified against the live tree (0.2-outcome.md anchors plus the fresh re-verifications in §3).

---

## 1. Findings

### MEDIUM

- **M1 — Task 2.4 still mandates CREATE of `admin-gate.helpers.ts`** (`tasks.md:160-173`);
  verified reality (0.2 Finding 1): `backend/services/admin/admin-gate.helpers.ts` already exists
  (commit `a259524`) shipping `assertActorAdmin` (`:59-90`, verbatim extraction) + `toAuditActionType`,
  and `user-management.service.ts` already consumes it (import at `:65`; private copy already
  deleted — the byte-parity rewire step is done by the sibling wave).
  → **Resolution at task 2.4 execution time:** take the pre-registered consume-and-extend branch
  (REQ-004 extraction-collision note; ledger rows `D-GATE-SHARING` / `D-GATE-LANDED`): append
  `assertActorAdminActive` additively in the existing file, add
  `export * from "./admin-gate.helpers";` to `backend/services/admin/index.ts`, skip the
  CREATE + private-copy-deletion steps, and still run the DEV3-016 regression locks
  (61-test service suite + 3-test chaos suite) green. Verified-in-tree reality is authoritative;
  no plan rewrite needed.

- **M2 — Stale numeric anchors** (`tasks.md:42`, `tasks.md:46`, `tasks.md:49`, `specs.md:7`,
  `plan.md:93`, `plan.md:305`, `plan.md:316`): `user-management.service.ts` (file is 445 lines;
  cited ranges `240-271`/`503-580` exceed EOF; `withTransaction` import at `:62` not `:67`;
  `createUser` at `:265`), `notification-engine.service.ts` (`NotificationEngineCallOptions` at
  `:35-38`; `emitForUser` at `:43-78`; `publishReceipts` at `:117-123`; file is 182 lines),
  `user-provisioning.helpers.ts` (`isUniqueViolation` at `:54-69`, not `:74`).
  → **Resolution:** the full cited→actual drift register in `outcome/0.2-outcome.md` is the
  authoritative anchor table for every downstream task. Every symbol exists with the exact
  signature and semantics the tasks assume; drift is numeric-only. No plan edit required.

- **M3 — `TeacherRepository.findById` executor prescription** (`tasks.md:131`, `plan.md:268`):
  the plan prescribes a plain `(tx ?? db)` executor (mirroring `admin-user.repository.ts:399`),
  but `backend/db/repo/AGENTS.md` mandates `queryDb(tx)` (Neon HTTP fast path) for
  non-transactional reads — the pattern `UserRepository.findById`
  (`backend/db/repo/users/user.repository.ts:75-95`) actually ships.
  → **Resolution at task 2.2 execution time:** implement `findById`'s bare-read branch via
  `queryDb(tx)` per the repo-layer Neon rule; signature `(id, tx?)` and semantics are unchanged.

### LOW

- **L1 — Task-numbering gap** (`tasks.md:62-93`): Phase 1 lists 1.1, 1.2, then jumps to 1.9; no
  1.3–1.8 exist. Cosmetic only; checklist integrity unaffected. No action.
- **L2 — Instruction-file staleness surfaced during the review (NOT plan defects; no action on
  this ticket):** `tests.instructions.md` cites `scripts/run-test/run-test.ts` (actual:
  `test/scripts/run-test.ts` — the plan uses the correct path); root/backend instruction text
  describes `getServerTranslations(locale, "<namespace>")` two-arg form while the real
  `shared/locale/server-graphql.ts:3-5` is one-arg full-tree — the plan correctly follows the code.
- **L3 — Internal tension settled in practice:** `tasks.md:24` (NON-NEGOTIABLE #7) mandates a ❌
  ledger entry for any unlocatable substrate, conflicting with the locked ledger glyph policy
  (Phase-5 gate `grep -c "❌\|⚠️" deferred-items.md = 0`). Tasks 0.1/0.2 already harmonized this
  (blocked/absent states recorded as RESOLVED-REFERENCE rows, e.g. `D-GATE-LANDED`). Verified
  current ledger: **0 glyph matches**; 6 rows, all RESOLVED-REFERENCE with owners.

## 2. Rule compliance matrix (spot-verified against the live tree)

| Dimension | Verdict | Evidence |
|---|---|---|
| Layer data flow (resolver → service → repo) | PASS | Thin resolver mandated (`plan.md:171-195`); no repo imports outside the repo layer |
| Canonical types discipline (REQ-003) | PASS | `TeacherColdStartCertificationInput` sited in `backend/types/teachers/teacher.types.ts`; barrel `backend/types/teachers/index.ts` already re-exports `./teacher.types` (verified) |
| i18n shape (REQ-051/002) | PASS | Flat `ErrorsLabels` additions beside existing groups; `adminUsers.userNotFound` reuse verified at `shared/locale/types/errors/index.ts:67-69`; `applicantTranslations` tree node verified at `shared/locale/types/message.ts:21`; `ctx.t("errorsTranslations")` pattern verified at `backend/graphql/mutation/notifications/notification.mutation.ts:115-116` |
| Service conventions | PASS | Single `withTransaction` boundary; same-`tx` to every call; publish strictly post-commit — structurally supported (0.2 verified in-tx `emitForUser` returns the receipt WITHOUT publishing, `:65-68`) |
| GraphQL surface (REQ-060/061) | PASS | `$all` conjunction precedent verified at `admin-users.mutation.ts:64-68`; return type reuse verified at `admin-user.pothos.ts:235-300` — `AdminTeacherSnapshotPothosObject` (`:179-188`) fields exactly match the planned document selection (`isApproved/isEvaluator/isOnline/averageRating`); zero new Pothos types |
| Frontend document (REQ-062) | PASS | `frontend/graphql/sharedDocuments/admin/index.ts:9` barrel state matches plan §5.4 exactly; documents-contract + parity test precedents exist |
| Closed error taxonomy (REQ-050) | PASS | 7-code closed set via the verified `ConflictError(code, message)` overload (`errors.ts:170-182`) and existing error classes; no new subclasses; single masking at the finalizer |
| Test layering (REQ-070..075) | PASS | Journey test-first BEFORE the service (task 2.1 < 2.5); harness verified (`provisionAdminActor` `actor-context.ts:136`, `provisionStudentActor` `:88`, `SpiedFanoutTransport`, `withAuditDeleteTriggersSuspended` `db-cleanup.ts:83`); `runInRollback`-forbidden journey rule stated; repo T1–T3 + chaos + wire matrix + document contract test all planned with sanctioned runner only |
| Zero schema drift (REQ-045) | PASS | No schema/migration task anywhere; Phase-5 gate re-asserts the empty diff |
| Ledger hygiene (REQ-076) | PASS | 5 pre-registered + 1 audit row, all RESOLVED-REFERENCE; glyph grep = 0 |
| Honest UI deferral (REQ-063/064) | PASS | No markup, `.BF`/`.BS` recorded N/A-with-rationale on task 4.1; D-UI owns the affordance |

## 3. Fresh verifications performed by THIS review (beyond 0.2's audit)

- `backend/types/teachers/teacher.types.ts` — current tree already contains the exact interface
  task 1.1 prescribes (concurrent task-1.1 execution in flight; working-tree diff `+5` lines) —
  consistent with the plan; NOT a conflict (consumers must tolerate the concurrent landing).
- `shared/locale/types/errors/index.ts` working-tree diff already carries the three new keys
  verbatim-named per REQ-051 (concurrent task-1.2 execution) — key names match the error taxonomy.
- `getServerTranslations` signature (one-arg, full tree): `shared/locale/server-graphql.ts:3-5`.
- `NotificationEngine.listMyNotifications` exists (`notification-engine.service.ts:125`) — journey
  step 4's inbox-read dependency confirmed.
- Runner path: `test/scripts/run-test.ts` exists; `scripts/run-test/run-test.ts` does not.
- `grep -c "❌\|⚠️" deferred-items.md` → 0 at review time.

## 4. Rule files consulted

Root `AGENTS.md`; `.agents/instructions/backend.instructions.md`; `.agents/instructions/frontend.instructions.md`;
`.agents/instructions/tests.instructions.md`; `backend/services/AGENTS.md`; `backend/db/repo/AGENTS.md`;
`frontend/graphql/sharedDocuments/AGENTS.md`; layer reminders surfaced during verification
(`backend/graphql/`, `backend/graphql/mutation/`, `backend/graphql/pothos/`, `backend/types/`,
`shared/`, `shared/locale/`, `frontend/`, `frontend/graphql/` AGENTS.md — read/acknowledged).

## 5. Gate disposition

- Gate statement (`tasks.md:92`): `plan-review-R1.md` MUST exist with a PASS verdict before task
  2.1 is checked off — **satisfied by this file**.
- No CRITICAL/HIGH findings; no ledger ❌ required (M2/M1 lineage already carried by
  `D-GATE-SHARING`/`D-GATE-LANDED` and the 0.2 drift register).
- No plan document (`specs.md`/`plan.md`/`tasks.md`) was modified by this review — per the task's
  read-only mandate; MEDIUM findings are resolved by execution-time adjustment, documented above.

## Files Changed

- CREATED `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/plan-review-R1.md` (this file)
- `tasks.md` — flipped the `1.9` checkbox only

## Files Deliberately NOT Changed

- `specs.md`, `plan.md`, `tasks.md` content (read-only review mandate)
- `deferred-items.md` — no new row needed; existing rows already carry the M1/M2 lineage
- No source files anywhere; no schema/migration paths touched

## Cross-File Dependencies

- Task 2.4: consume-and-extend branch is now the locked execution path (M1).
- Task 2.2: `queryDb(tx)` executor ruling for `findById` (M3).
- All Phase-2/3 tasks: anchor lookups MUST consult the 0.2 drift register (M2).

## Deviations

- The tasks.md gate text (line 92) says unresolved findings must be fixed by in-file plan amendment
  or a ❌ ledger row. Neither mechanism was used: (a) plan-text MEDIUMs require no behavioral change
  and the assignment explicitly forbids plan-doc edits from this gate; (b) the locked glyph policy
  forbids ❌ rows. Both mechanisms are substituted by the documented resolution notes in §1, which
  is the assignment's prescribed handling ("no plan rewrite needed unless the finding changes
  behavior" — none do).

## 1.9.SR self-check record

- Every verdict line above cites a live-verified `path:line` anchor re-read during this review.
- Read-only scope honored: zero plan-doc edits; the only non-outcome mutation is the single
  checkbox flip mandated by the assignment.
