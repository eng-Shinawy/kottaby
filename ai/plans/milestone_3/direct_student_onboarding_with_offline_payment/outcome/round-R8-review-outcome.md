# Review Iteration R8 — Independent Re-Review (tests-quality lens, full test-suite walk)

**Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/`
**Task:** 6.1 (post-implementation review iteration R8 — independent reviewer, tests-engineering lens, no prior-round context)
**Branch:** `feat/direct_student_onboarding_with_offline_payment` · **Tip at review:** `4d19242` (test files byte-identical to the state the fix wave's recorded green gates cover — `6608c6d`/`bfbe666`; only plan-doc commits sit on top)
**Method:** scope = `git diff 6bf6c71..HEAD --name-only` filtered to TEST files (12 of 86), then a full read of every plan-created/modified test suite plus the 4 anchor/allowlist deltas, checked against the plan's own test mandates (tasks.md 2.1/2.3/2.4/3.3 + the repo AGENTS.md layers). Read-only — no source files modified. Every verdict anchored to `file:line`. Sandbox hazard from R7's method note re-confirmed (working tree bounces to `main` between calls) — every read was pinned to the REF via `git show <ref>:<path>` / atomic checkout chains.

## Scope (12 test/anchor files)

| # | File | Status | What was checked |
|---|---|---|---|
| 1 | `test/workflows/admin/direct-student-onboarding.journey.test.ts` | NEW (974 ln) | 12-step journey: no `runInRollback`, `jrn_admin_<8hex>` prefix, `@/` aliases only, real-actor denials, tracked teardown + zero-residue probes, J-1..J-3 / JR-1..JR-5 assertion mapping |
| 2 | `test/workflows/admin/audit-completeness.journey.test.ts` | MOD (+28) | New census leg: composite-producer runner, details-contract pins, teardown registration, `tracked.size` 22→23, denial-matrix entry |
| 3 | `test/workflows/admin/audit-completeness.catalog.ts` | MOD (+16) | `secondaryExpectedAuditRows` composite extension + the onboarding census row (docblock constrains secondary ≠ primary honestly) |
| 4 | `backend/services/admin/student-onboarding.service.test.ts` | NEW (913 ln) | 4-tier suite per the `subscription-admin.service.test.ts` pattern: 22 tests, anchor-scoped zero-movement oracle, try/catch helper, spy `afterEach` restore |
| 5 | `backend/db/test/repo/parents/parent.repository.test.ts` | NEW (146 ln) | 100% branch claim: tx/no-tx × found/not-found + Tier 4 rollback probe, `tx` to every call, committed-fixture afterAll zero-residue |
| 6 | `frontend/graphql/test/admin-student-onboarding/admin-student-onboarding.test.ts` | NEW (624 ln) | Real-server wire suite: bearer-per-request auth, `expectMutationError` code pins, per-denial surface-level zero-writer probes, smuggled-field BAD_USER_INPUT abuse probe |
| 7 | `shared/locale/studentOnboarding-namespace.parity.test.ts` | NEW (487 ln) | Parity belt + block pins + function-leaf inventory + Arabic-script sweep + registry wiring (mirrors the sibling namespace gate) |
| 8 | `frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents.test.ts` | NEW (197 ln) | Exact operation/variable/selection-surface pins, zero-fragment pin, barrel identity, TypedDocumentNode binding |
| 9 | `backend/db/test/logic/audit/audit-immutability.test.ts` | MOD | `TEARDOWN_ALLOWLIST_PATHS` += the self-tearing onboarding journey (sorted) — honest, matches the journey's own afterAll teardown |
| 10 | `backend/graphql/test/schema-surface.test.ts` | MOD | Onboarding mutation/type pins added; redundant `RECONCILED_VERIFICATION_PLAN_PURCHASE_MUTATION_FIELDS` double-pin removed with a documented reconciliation (single pin stands, no dangling refs — verified) |
| 11 | `frontend/graphql/test/warnings/warning-surfacing.test.ts` | MOD | `adminOnboardStudentWithOfflinePayment` added to `KNOWN_LIVE_MUTATION_FIELDS` with a warning-incapable rationale docblock |
| 12 | `backend/services/parents/parent-link.static-locks.test.ts` | MOD | Second sanctioned `linkParentIfUnlinked` caller added to the single-writer allowlist with the INV-P1 invariant note |

## Checklist results (tests-quality lens)

| Check | Verdict | Evidence |
|---|---|---|
| No `runInRollback` in the journey layer | **PASS** | Grep over `direct-student-onboarding.journey.test.ts`: zero uses; header documents WHY (`:32-34` — the service spawns its own top-level transactions; cast committed in one `beforeAll` tx, torn down by tracked hard-delete per `test/workflows/AGENTS.md` rule 1) |
| No `expect(...).rejects.*` inside rollback wrappers (or anywhere) | **PASS** | Zero `.rejects` matches in all 12 files (docblocks explicitly forbid it). Denials go through `catchJourneyError` (journey) and `expectServiceError` (service `:298-312`) — both FAIL the test when the call resolves, and both re-throw non-Error catches (no swallowed probes) |
| Every denial honestly exercises its codepath | **PASS** | Journey step 11 calls the service with each non-admin actor's REAL id (teacher/peer-student/other-parent); frontend denials ride real bearer tokens minted by the real `login` mutation; service tier 1 uses real `users` rows. Every denial pins class + `extensions.code` + the EXACT translated message (`expectDomainDenial`, service `:326-330`) AND proves zero anchored movement + zero audit attribution afterwards. No try/catch-and-pass probes anywhere |
| Assertions specific (not just not-null) | **PASS** | Service: exact audit-details JSON pins (`{"role":"student"}` `:437`; the full 7-field subscription details object `:443-453`); journey: `tracked.size` exact counts (`:573` =11, `:969` =20), fresh-window ±60 s skew pins, pairwise-distinct handshake pin; parent-repo: closed key-set pin `["id","createdAt","updatedAt"]`; documents: exact variable/selection surfaces. The only presence-only probes (`frontend.test.ts:425,429` wire id/`paymentVerifiedAt`, `documents.test.ts:195` runtime-use of a compile-time assignment) were examined and dismissed — exact instants are unpinnable over the masked wire and freshness is pinned at the service/journey tiers |
| Parallel-safety (no global-count races left) | **PASS** | Service suite's zero-movement oracle is ANCHOR-scoped (`snapshotWriteCounts` `:198-234` — emails/references/actorIds with fresh UUIDs; docblock `:90-95` explicitly reasons about peer workers on the shared DB); frontend uses `RUN_SALT` + per-fixture UUID emails; journey uses the per-run `jrn_admin_<8hex>` prefix and whole-table `db.$count` oracles — the established journey-layer convention (verified in the pre-existing `admin-session-governance` / `subscription-admin-lifecycle` journeys; single-file exclusive runner, name-level collisions impossible via prefix) |
| Teardown completeness (zero-residue) | **PASS** | Journey `afterAll` `:489-570`: audit sweep FIRST under `withAuditDeleteTriggersSuspended` (both attribution directions) → user-led `deleteUsersByIds` → `tracked.cleanup()` → mandatory zero-residue probes (users=0, ledger=baseline, junction=0, per-entity audit rows=0). Parent-repo `afterAll` `:80-89` re-reads via the repo itself (`findById → null`). Frontend `afterAll` `:306-334`: plan deactivation (no deletion surface — honest) + `deleteUsersByIds` + `countUsersByIds === 0`. Service/parent-repo rollback cases leave nothing by construction. The audit-immutability teardown-allowlist delta (#9) is exactly consistent with the journey's self-teardown |
| 4-tier coverage honesty | **PASS** | Service (`:449-910`): Tier 1 role gate ×4 actors incl. anonymous (`actorId 0` — exercises the gate's genuine not-found arm); Tier 2 all NINE pre-write denials (paymob+stripe whitelist, blank-after-trim, 256-char, unknown plan, inactive plan, lane-less fail-closed, unknown parent, non-parent role, parent-without-role-row) each zero-write; Tier 3 all THREE offline methods + 255 ceiling + trimmed storage + BOTH duplicate arbitrations (email/reference, original-holder coherence) + pairwise-distinct handshake; Tier 4 abuse: vanished-row stub of the guarded parent link fails the whole tx loud with zero residue (`:864-888`) + audit-vocabulary no-PII probe. Journey maps every J-1..J-3 and JR-1..JR-5 step to ≥1 assertion (steps 2-11). Parent-repo delivers its claimed 100% branch (both executor arms × found/not-found + Tier 4 cross-session rollback probe `:135-146`). Frontend covers the full §3.3 matrix (UNAUTHORIZED / FORBIDDEN ×3 / VALIDATION ×2 / CONFLICT ×2 / PLAN_NOT_FOUND / USER_NOT_FOUND) PLUS the extra smuggled-`role` → BAD_USER_INPUT wire-abuse probe (`:586-617`, documented `@ts-expect-error`) |
| Enums as VALUE imports in tests | **PASS** | Journey `:66-71` and service `:66-70` import `AuditActionType`/`PaymentGateway`/`SubscriptionCreditLane`/`SubscriptionStatus`/`Gender`/`UserRole` as values; frontend imports the generated enum values (`:65-76`); audit-completeness delta adds `PaymentGateway` as a value import. The R2-04 fix state at journey `:393` (`UserRole.Student`) verified intact |
| Clean comments (zero plan-artifact refs) | **PASS** | Grep (`REQ-`, `D-ONB`, `tasks.md`, `outcome/`, `phase/task/tier N`, plan paths) over all 12 files: zero plan-artifact references in any hunk this plan added. "Tier" labels are the repo's own suite vocabulary (mandated pattern `subscription-admin.service.test.ts:24-41,498-1329` uses identical Tier 1-4 naming); `AGENTS.md` citations are repo-instruction docs, not plan artifacts. The pre-existing `REQ-032`/`REQ-060/061`/`D2` rows in schema-surface/warning-surfacing are baseline content (already logged R2/R4/R6 — none added by these hunks) |
| Anchor/allowlist deltas honest | **PASS** | All four are documented, minimal, and semantics-preserving: schema-surface removes a redundant double-pin (freeze un-satisfiable against the unique live list) with the single original pin retained and a reconciliation narrative; static-locks adds exactly the one new sanctioned caller with the invariant note; warning-surfacing adds the field with rationale; audit-immutability adds the self-tearing journey |

## Findings

| ID | Severity | File:line | Description | Disposition |
|---|---|---|---|---|
| R8-01 | LOW | `test/workflows/admin/direct-student-onboarding.journey.test.ts:649`, `:679` + `backend/services/admin/student-onboarding.service.test.ts:364` | Three residual raw-literal role assertions — `expect(session.user.role).toBe("student")` (journey step 3), `expect(detail.role).toBe("student")` (journey step 4), `expect(result.student.role).toBe("student")` (service `assertCommittedLeg`) — are instances of the exact R2-04 class (fixed at journey `:393` → `UserRole.Student` by the R2-R3 fix wave) that the fix wave did not convert. `UserRole` is already a value import in both files, so the enum-member form is a drop-in. Test hygiene/consistency only — string-enum members make the comparisons semantically identical, and no assertion weakness results. | Advisory, non-blocking. Follow-up candidate: convert the three literals to `UserRole.Student` for uniformity with the established post-fix convention. |

**Candidates examined and dismissed (not findings):** journey-layer whole-table `db.$count` oracles (repo journey convention; anchor-scoped discipline lives one layer down where peer workers are real); `createTestUser({ role: "admin" })` fixture literals (the entity-setup helper's own documented API form, `entity-setup.ts:72`); `expectDomainDenial` string-literal codes (`DomainError.code` is a plain string in `backend/lib/errors.ts` — no enum exists to import); the three presence-only probes listed above.

## Findings count

- **New (this round):** 1 — 0 CRITICAL / 0 HIGH / 0 MEDIUM / 1 LOW (R8-01, advisory) / 0 INFO.
- **Fixed (prior, re-verified intact in the test layer this round):** R2-04's landed state (journey `:393` `UserRole.Student` + value import) confirmed; zero plan-artifact comments confirmed across every new test file (R1 RF1/RF2 class).
- **Remaining (open from prior rounds):** 0 blocking. Accepted/no-action INFOs stand (R2-05…07, R3-F4…F7, R4-01…02, R5-01, R6-01…02 + the pre-existing out-of-scope comment row).

## Stop-condition tally

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 1 new (advisory, non-blocking) |
| INFO | 0 |

**Blocking total = 0 → stop condition met.** The plan's test layer is in demonstrably strong shape: every denial probe is honest and exact (class + code + translated message + zero-movement oracle), the 4-tier/branch-coverage claims of tasks 2.3/2.4/3.3 are delivered (not just claimed), teardown is zero-residue with self-failing probes, the parallel-safety design is explicit and layered (anchor-scoped counts / run-salts / per-run prefixes), and the four anchor/allowlist deltas are documented reconciliations rather than silent baseline flips. The single new LOW is a three-line consistency nicety of an already-fixed finding's class; no fix wave is required for it unless a future wave is opened anyway.

## Method note

1. **Sandbox branch flakiness (per R7's note, re-confirmed):** the shared working tree reverted to `main` (`07c2675`) between tool calls; bare working-tree reads and `HEAD`-relative git commands returned main's Phase-0/1 state. All reads were pinned to the branch REF (`git show feat/…:<path>`, `git diff 6bf6c71..feat/…`) or run as atomic `git checkout … -q && …` chains.
2. **Verification basis:** read-only rescan — no suites re-run. The audited test bytes are identical to the state carrying the fix wave's recorded green gates (tsgo 0, parity 50/50, service 22/22 — matching the 22 `test(` blocks counted in-tree, journey 11/11 — matching the 11 step tests, documents 10/10), so those gates remain valid for this review's byte-state.
