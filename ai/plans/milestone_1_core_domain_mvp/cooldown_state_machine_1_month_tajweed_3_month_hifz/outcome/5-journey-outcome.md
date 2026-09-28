# Task 5 Outcome — Journey Test `cooldown-state-machine.test.ts` (test-first RED)

> **Date:** 2026-09-27 · **Ticket:** `docs/planning/TICKETS.md:818-868` (T2-008 — Dev 2 · M1 · 5 SP)
> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Specs:** `specs.md` (REQ-011 cross-actor journey; REQ-003/004/006/007/008 observable) · **Design:** `plan.md` §7 · **Task def:** `tasks.md` Phase 2
> **Scope guard:** Task 5 touched ONLY the new journey file + the plan's own tracking files (`tasks.md` checkboxes, this outcome). ZERO production source files modified. No `git commit` (orchestrator-owned).

---

## 1. RED STATUS — READ THIS FIRST

**The journey is authored test-first and is RED exactly as planned.** Final verified run: **7 pass / 5 fail / 233 expects** (two consecutive runs — identical matrices, proving teardown totality).

| Step | Status | Reason |
|---|---|---|
| 1 — fixtures + open tajweed cycle (4 rubrics) | ✅ PASS | rubric/purchase/booking services already shipped |
| 2 — 5th submission finalizes FAIL (cooldown ≈ now+30d, `users.suspended === false`) | ✅ PASS | the fail writer is the existing `finalizeRubricFail` path |
| 3 — profile reads `Active` + not purchasable | ✅ PASS | `getMyApplicantProfile` + `deriveCooldownState` shipped |
| 4 — purchase denied `APPLICANT_COOLDOWN_ACTIVE` (422 family, zero writes) | ✅ PASS | `VerificationPurchaseService.purchase` + strict-`>` guard shipped |
| 5 — admin extension (+60d → ≈ stamped+90d, ONE adjust audit row) | ❌ **RED (expected)** | GraphQL document validation: `Cannot query field "adminExtendApplicantCooldown" on type "Mutation".` |
| 6 — profile observes the extended instant | ❌ **RED (expected)** | step 5 never wrote; the profile still reads the 30-day stamp (`toBeGreaterThan(stamp)` fails by design) |
| 9 — non-admin → `FORBIDDEN` (authScopes) | ❌ **RED (expected)** | same missing-field validation error (`extensions.code` "" ≠ "FORBIDDEN") |
| 10 — extend on `passed` → `APPLICANT_ALREADY_CERTIFIED` | ❌ **RED (expected)** | same |
| 11 — `additionalDays: 0` → `APPLICANT_COOLDOWN_EXTENSION_INVALID` | ❌ **RED (expected)** | same |
| 7 — clock-advance fixture → profile reads `Expired` | ✅ PASS | fixture write + read-model shipped |
| 8 — re-application purchase SUCCEEDS (attempts+1, failed → in_evaluation) | ✅ PASS | `recordReapplication` + `transitionToInEvaluation` shipped |
| 12 — hifz arc replay (cooldown ≈ now+90d) | ✅ PASS | duration selection shipped |

**Every non-mutation step (1, 2, 3, 4, 7, 8, 12) passes NOW** — none fails for any reason other than the missing mutation. After the `adminExtendApplicantCooldown` field is registered on the schema (with the `cooldownState` field on `ApplicantProfile`), steps 5, 6, 9, 10, 11 turn green **with zero edits to this file**: the document, the context construction, and every assertion are already written against the final contract (`id/status/cooldownUntil/cooldownActive/canPurchaseVerification/cooldownState` selection, wire enum names `Failed`/`Active`).

## 2. Files created / modified

| File | Change |
|---|---|
| `test/workflows/teachers/cooldown-state-machine.test.ts` | CREATE — 12-step cross-actor journey, ~1270 lines, bun:test |

No other file touched (verified by `git status` review; the worktree's other modifications belong to Tasks 1–4).

## 3. How the journey binds to the surfaces (design decisions)

1. **Service tier (green steps).** Applicant reads go through `ApplicantLifecycleService.getMyApplicantProfile`; the purchase denial/permit through `VerificationPurchaseService.purchase`; the fail finalization through the real `EvaluationRubricService.submitRubricEvaluation` → rubric-finalization path (purchase → activation → booking → completion → submissions, exactly the shipped arc).
2. **GraphQL tier (RED→green admin steps).** `adminExtendApplicantCooldown` is a Pothos side-effect registration with NO named export, so the journey executes the REAL schema in-process: `graphql({ schema: graphQLSchema, source: EXTEND_COOLDOWN_MUTATION, variableValues, contextValue })`. This is the only way to exercise the mutation's authScopes honestly (harness rule 4). Until the field exists, `graphql()` fails document validation — the designed RED mode; after it exists, the same execution drives authScopes → resolver → `ApplicantLifecycleService.extendApplicantCooldown` → wire payload.
3. **Honest context, no monkey-patching.** `verifiedSessionContext(userId, locale)` builds exactly what `createGraphQLContext` builds for a verified session of that fixture user: `user` read fresh from the real `users` row (passwordHash stripped, `preferredRecitation: null`), `role` via `toUserRole(row.role)`, `isSuperAdmin` derived, real locale, `createAuthCookieOut()`, `requestId`/`t` mirroring the factory. A non-admin caller is non-admin because their REAL row says so.
4. **Error contract asserted on both tiers.** Service tier: `expectTypedDenial` (class + `error.code` + translated substring). Wire tier: `expectWireDenial` (exactly one error element, `extensions.code`, localized message). Step 4 additionally runs the caught `ValidationError` through the REAL `finalizeGraphqlErrors` and asserts the domain pass-through (`extensions.code` preserved verbatim, never masked) plus the canonical transport row `ERROR_CODE_HTTP_STATUS.VALIDATION === 422` — the "HTTP 422 via the error finalizer" mapping at its single source of truth.
5. **Two-source-split lock.** `expectGovernanceTripleUntouched(userId)` (direct `users` read: `suspended === false`, `suspendedAt === null`, `suspendedPeriodDays === null`) runs after the fail stamp (step 2), after the admin extension (step 5), and after the hifz stamp (step 12).
6. **Clock advance = fixture write.** `advanceCooldownIntoThePast(applicantUserId)` — ONE committed `db.transaction` rewriting `applicants.cooldown_until` to a past instant. No production time-mocking anywhere.
7. **Never-shorten pinned verbatim.** Step 5 captures the stamp at step 2 and asserts the extended instant = stamped + 60d ± clock skew (the stored base honored verbatim, `max(base, now) + days`).

## 4. Harness discipline evidence (5.SR)

- **NO `runInRollback`** — the journey layer's documented exception honored; all fixtures COMMITTED in `beforeAll` (cast provisioner transaction + ONE committing transaction for evaluators/cycle-applicants/plan/locale).
- **Committed fixtures + tracked cleanup** — `TrackedFixtures` (evaluators, three cycle applicants, plan-if-created, every service-created subscription/payment/claim/session/evaluation row) + `journeyCleanup(bundle.registry)` (cast: audit-log sweep under suspended triggers → role-children → users).
- **Zero-residue teardown is load-bearing**: notifications sweep, `student_payments` leg under `withImmutabilityTriggersSuspended`, defensive `studentSubscriptions` sweep, `tracked.cleanup()`, `journeyCleanup(...)`, then post-teardown existence probes over EVERY generated user id (users/applicants/students/teacher/parents/admin/session/evaluations — all 0). Run twice consecutively → identical green-cleanup (no cross-run state; the second run re-provisioned a fresh `jrn_cooldown_<8hex>` cast). Independent post-run DB probe: `users WHERE email LIKE '%jrn_cooldown%'` → 0; `audit_logs WHERE entity_type='applicant'` → 0.
- **External effects intercepted**: `spyOn(NotificationEngine, "publishReceipts").mockImplementation(noop)` at module scope, `mockRestore()` in `afterAll`; every receipt assertion checks the publish count AND `lastPublishedRecipientIds()` targets the applicant ONLY (foreign inboxes untouched).
- **Denials write nothing**: steps 4/9/10/11 each delta-assert the applicant row (status + cooldown + attempts), the idempotency-claim count, and `countAuditLogsForActor(admin)` before/after.
- **No `console.*`, no `any`, no unsafe casts** (guards + type predicates only; `JSON.parse` handled as `unknown` per the audit-trail journey precedent). No production file modified; no production clock mocked.

## 5. Pipeline checklist evidence

| Gate | Command | Result |
|---|---|---|
| 5.QL | `bun run scripts/health/sub-loop.ts test/workflows/teachers/cooldown-state-machine.test.ts --lifecycle duplicates` | ✅ **exit 0** (tsgo → oxlint → biome:check → lint:type-aware → check:duplicates; `check:duplicates` skipped-by-design for `*.test.ts`, outside jscpd scan scope — same as every sibling journey/test file). Two lint findings on the first pass (`sonarjs/different-types-comparison`, `sonarjs/no-redundant-jump`) were fixed in-file and re-verified. |
| 5.TE | `bun run test/scripts/run-test.ts test/workflows/teachers/cooldown-state-machine.test.ts` | 7 pass / 5 fail / 233 expects — RED matrix §1 (all 12 steps asserted; both denial probes + 403 + the two-source-split lock + the hifz arc present) |
| 5.TE (teardown totality) | second consecutive run | identical 7/5, cleanup green both times |
| Typecheck | `bun tsgo` | exit 0, zero errors (journey included; no new errors anywhere) |
| Hygiene | greps over the journey file | zero `console.*`, zero `REQ-*`/task-number/plan-artifact references, no `Translation.` enum, no two-arg `getTranslations` |

## 6. Step-by-step assertion inventory (what the file locks)

1. Cast integrity (pending ×2, terminal `passed`, five certified evaluators), plan contract; purchase→activation→booking(5)→completion(5)→four rubrics (tajweed-79 lowest failing) — quorum pending, zero verdict writes.
2. Fifth submission finalizes: `failed` + cooldown ∈ [windowStart+30d−skew, windowEnd+30d+skew] + strictly future; no teacher/students rows; governance triple untouched; ONE fail notification published to the applicant only.
3. Self profile: `status failed`, `cooldownState Active`, `cooldownActive true`, `canPurchaseVerification false`, `cooldownUntil` = the stamp.
4. Purchase denied: `ValidationError` + `error.code === "APPLICANT_COOLDOWN_ACTIVE"` + `extensions.code` identical + finalizer pass-through + `VALIDATION → 422` taxonomy row + zero writes (no claim, no subscription delta, row byte-identical).
5. Admin extension (+60): wire payload `Failed`/`Active`/not-purchasable, extended instant = stamp+60d±skew, DB row = wire instant, exactly ONE audit row (`Adjust`, entityType `"applicant"`, actorId = admin, details exactly `{field:"cooldown_until", from, to, additionalDays}` — names/instants only), audit count +1 for the admin, governance triple untouched, no fan-out, applicant inbox unchanged.
6. Applicant observes the extended instant (strictly greater than the stamp, ≥ stamp+60d−skew), still `Active`.
7. Clock-advance fixture → profile `Expired`, `cooldownActive false`, `canPurchaseVerification true` (status not passed), stored instant now past.
8. Re-application purchase succeeds (tracked rows, exactly one claim), attempts +1, `lastAttemptAt` stamped, status `failed → in_evaluation`, self profile agrees, no publish (activation owns receipts).
9. Non-admin (real certified-teacher row) → single wire error `FORBIDDEN` with the localized forbidden copy; zero writes, zero audit delta.
10. Admin on the terminal `passed` applicant → `APPLICANT_ALREADY_CERTIFIED`; zero writes.
11. Admin with `additionalDays: 0` → `APPLICANT_COOLDOWN_EXTENSION_INVALID` (the localized bounds copy); zero writes.
12. Full hifz replay: purchase→activation→booking→completion→hifz-79→three passing→fifth finalizes → cooldown ∈ [windowStart+90d−skew, windowEnd+90d+skew]; governance triple untouched; ONE fail notification; the hifz stamp strictly later than the tajweed stamp (duration is data-driven).

## 7. Notes for downstream tasks

- **Mutation implementer:** the journey is the executable contract — register `adminExtendApplicantCooldown(applicantId: Int!, additionalDays: Int!): ApplicantProfile!` with `adminOnlyAuthScopes` and the `cooldownState` field on `ApplicantProfile`, then re-run: `bun run test/scripts/run-test.ts test/workflows/teachers/cooldown-state-machine.test.ts` must go 12/12 with ZERO edits to the file. Wire names asserted: `status: "Failed"`, `cooldownState: "Active"` (TS member names, per the `ApplicantStatus` precedent).
- **Wire-tier contract notes:** the profile payload is read through strict guards (no casts); the mutation document selects exactly the six fields the resolver returns post-extension. If the mutation later grows fields, this selection keeps working unchanged.
- **Review wave (2.5):** nothing to fix in this file for the RED run — the five failures are the designed drive-the-contract state, NOT product defects. Zero genuine product bugs were found in any shipped surface while authoring (steps 1–4, 7, 8, 12 passed on the FIRST authored run).
- **Task 8 (final gate):** the journey must be green; run via the approved runner (never raw `bun test`).
- Orchestrator: no `git commit` performed; `tasks.md` Task 5 checkboxes (5. + 5.QL/5.TE/5.SEC/5.SR/5.IV) flipped.
