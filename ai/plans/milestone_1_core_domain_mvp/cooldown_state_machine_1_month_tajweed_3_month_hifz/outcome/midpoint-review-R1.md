# Mid-Point Review Gate — Fix Wave R1 (`outcome/midpoint-review-R1.md`)

> **Date:** 2026-09-27 · **Gate:** Phase 2.5 mid-point backend review (fix wave R1)
> **Scope guard:** this wave touched ONLY the three files listed in §3 plus this outcome and the ledger. No `git commit` (orchestrator-owned). Tasks 1–5 code otherwise untouched.

---

## 1. Aggregated findings (review-backend + review-types)

| # | Severity | File | Finding |
|---|---|---|---|
| 1 | MEDIUM | `backend/services/admin/user-management.mappers.ts` | `buildApplicantSnapshot` derives a live `cooldownState` (via the service's shared `deriveCooldownState`) but keeps the pre-existing hardcoded `cooldownActive: false` and a `canPurchaseVerification` derivation that ignores the cooldown. The admin detail wire slot reuses the canonical applicant profile shape (`backend/types/admin/admin-user.types.ts:193` — `applicant: ApplicantProfileReturnType \| null`), so once the GraphQL phase exposes it the admin payload would self-contradict (`cooldownState: "Active"` + `cooldownActive: false` + `canPurchaseVerification: true` while the cooldown blocks purchase). |
| 2 | LOW | `test/workflows/teachers/cooldown-state-machine.test.ts` (~:686, :691) | Comments `// Phase 1 —` / `// Phase 2 —` collide with the repo's plan-artifact grep convention (`Phase \d` is a final-gate pattern). Wording-only fix; zero behavioral surface. |
| 3 | LOW | `deferred-items.md` | Ledger updates only: D4 audit-fidelity nuance, new D6 (guard without a production consumer), new D7 (residual admin-snapshot test gap — required because Finding 1 changed `canPurchaseVerification` semantics). |

## 2. Fixes applied per finding

### Finding 1 — mapper semantic alignment (MEDIUM)

`backend/services/admin/user-management.mappers.ts` — `buildApplicantSnapshot` now derives ALL THREE cooldown observables from ONE captured `now`, with the shared derivation as the single source of the boundary:

- **Shared-helper check (per the finding's instruction):** the lifecycle service already exports the shared strict-`>` boundary helper (`deriveCooldownState(cooldownUntil, now)`) — established in the Task-4 wave precisely for this cross-surface reuse (services-AGENTS single-writer read-surface rule: consumers import the owning service's derivation, never re-derive against the repo/table). The service's own `getMyApplicantProfile` keeps its inline `cooldownActive = row.cooldownUntil !== null && row.cooldownUntil > now` — its semantics are test-pinned (56/0), and its Active arm is *the exact same predicate* the shared helper evaluates, so exporting nothing new was the cleaner choice: zero service delta, zero risk to the pinned suite, one boundary for both surfaces.
- **`cooldownActive`:** derived as `cooldownState === ApplicantCooldownState.Active` — definitionally identical to the service's inline predicate (the helper's Active arm IS `cooldownUntil !== null && cooldownUntil > now`, strict `>`), and read OFF the enumeration rather than re-stating the comparison, so the boolean cannot drift from the enumeration inside the same payload.
- **`canPurchaseVerification`:** CHANGED from the pre-existing `row.applicantStatus !== ApplicantStatus.Passed` (a cooldown-blind hardcode-adjacent derivation) to the canonical self-profile semantics: `!cooldownActive && row.applicantStatus !== ApplicantStatus.Passed` — mirroring `getMyApplicantProfile` exactly (`cooldownActive → not purchasable`; certification remains terminal). The mapper imports `ApplicantCooldownState` as a VALUE (enum-as-value discipline).
- **Docblock accuracy:** the builder's JSDoc no longer claims an absolute "cannot drift"; it now states the accurate invariant — the two surfaces share ONE derivation boundary and one rule set, each evaluated at its own read instant (semantic drift impossible; ordinary time-passage divergence between two separate reads expected and correct). The builder keeps the captured-now comment mirroring the service's discipline.
- **Service untouched:** no change to `applicant-lifecycle.service.ts` — public behavior and test-pinned internals preserved (the finding's "if in doubt, keep the service as-is" arm).
- **Test pin:** NO user-management-mappers test file exists (`backend/services/admin/` has mappers tests only for `admin-academic-tracking`; `user-management.service.test.ts` covers the snapshot indirectly and pins only `status`, not the cooldown fields). Per the finding's instruction, no new test file was created; the gap is ledgered as **D7**. Confirmed no existing pin contradicted the new semantics: `user-management.service.test.ts` re-run green (61/61).

### Finding 2 — journey comment wording (LOW)

`test/workflows/teachers/cooldown-state-machine.test.ts` :686/:691 — `// Phase 1 —` → `// Stage 1 —`, `// Phase 2 —` → `// Stage 2 —`. Verified via grep: zero `Phase \d` matches remain in the file. No other line changed; the journey's RED matrix is untouched by design.

### Finding 3 — deferred-items ledger (documentation only)

`ai/plans/.../deferred-items.md`:

- **D4 (Notes appended):** under last-write-wins, each audit row's `from` is the guard-READ snapshot, not the true pre-write instant — an interim concurrent write may exist between the read and the write; both attempts remain audit-observable and the never-shortens property still holds against the original base.
- **D6 (added):** `isApplicantCooldownState` fail-closed guard has no production consumer yet (the read-model derives enum members; nothing parses an external cooldown-state string). Status 📋 Deferred-by-design; Source Task 1; Target first transport/parse consumer or the `bun run check:unused` (knip) scan.
- **D7 (added):** dedicated mutual-consistency pin for the admin applicant snapshot — no user-management-mappers test file exists, so the admin-side three-field consistency pin lives only in the service suite. Status 📋 Deferred-by-design; Source Task 2.5 (this wave); Target first admin-mappers test file or the post-implementation review wave. This row exists BECAUSE Finding 1 changed `canPurchaseVerification` semantics.
- Enforcement prose updated (D1..D7 all 📋). Row-anchored blocker grep `^\| D[0-9]+ .*(❌|⚠️)` → **0**.

## 3. Files modified

| File | Change |
|---|---|
| `backend/services/admin/user-management.mappers.ts` | +import (`ApplicantCooldownState` value), builder docblock rewritten, snapshot body: one captured `now` + three derived observables (+22/−10 incl. docblock) |
| `test/workflows/teachers/cooldown-state-machine.test.ts` | 2 comment lines reworded (Phase → Stage) |
| `ai/plans/.../deferred-items.md` | D4 note appended; D6, D7 rows added; enforcement prose updated |
| `outcome/midpoint-review-R1.md` | this file |

## 4. Gate results

| Gate | Command | Result |
|---|---|---|
| Sub-loop (mapper) | `bun run scripts/health/sub-loop.ts backend/services/admin/user-management.mappers.ts --lifecycle duplicates` | ✅ exit 0 (tsgo → oxlint → biome:check → lint:type-aware → check:duplicates all passed) |
| Sub-loop (journey) | `bun run scripts/health/sub-loop.ts test/workflows/teachers/cooldown-state-machine.test.ts --lifecycle duplicates` | ✅ exit 0 (check:duplicates skipped-by-design — outside jscpd scope) |
| Typecheck | `bun tsgo` | ✅ **0 errors total** |
| Ledger enforcement | `grep -cE "^\| D[0-9]+ .*(❌\|⚠️)" deferred-items.md` | ✅ **0** |
| Admin regression (mapper consumer) | `bun run test/scripts/run-test.ts backend/services/admin/user-management.service.test.ts` | ✅ **61 pass / 0 fail / 236 expects** |
| Service suite (pinned, untouched) | `bun run test/scripts/run-test.ts backend/services/teachers/applicant-lifecycle.service.test.ts` | ✅ **56 pass / 0 fail / 327 expects** |
| Journey (comment-only change) | `bun run test/scripts/run-test.ts test/workflows/teachers/cooldown-state-machine.test.ts` | ✅ **7 pass / 5 fail / 233 expects** — the exact designed RED matrix (mutation-dependent steps 5, 6, 9, 10, 11 deny on the absent `adminExtendApplicantCooldown` field); flips to 12/12 in the GraphQL phase with zero file edits |
| Hygiene greps | plan artifacts (`REQ-\d`, `Task \d`, `Phase \d`, plan-file names) + `console.*` over both code files | ✅ zero matches |

## 5. Re-review readiness statement

All three findings from the aggregated mid-point review are resolved or ledgered; every fixed file re-passed the per-file sub-loop at the strictest lifecycle stage, the repo typechecks clean, the pinned service suite is regression-free (56/0), the mapper's consuming admin suite is green (61/0), and the journey reproduces its designed RED matrix unchanged (7 pass / 5 fail, all five failures on the not-yet-shipped mutation field). No new findings were introduced by the fixes. **The backend slice of Tasks 1–5 is re-review-ready with zero open backend findings** — the gate can advance to the GraphQL phase (Task 6), which owns flipping the journey green.
