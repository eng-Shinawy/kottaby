# Tasks — Dispute Resolution with Admin Arbitration

<!-- Plan Directory: ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/ -->
<!-- Inputs: specs.md (REQ-0…REQ-10) · plan.md (D-1…D-10) · Templates: .agents/spec-process-guide/templates/ -->

## Document Information

- **Feature Name**: Dispute Resolution with Admin Arbitration
- **Target Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/`
- **Outcome Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/outcome/`
- **Version**: 1.0 · **Date**: 2026-09-11

## Non-Negotiable Execution Protocol (applies to every task)

1. **Pre-Execution**: read ALL files in `ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/outcome/`.
2. **Per-file quality loop** after every edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0; auto-prints applicable AGENTS.md + instruction files).
3. **Semantic review checklist** before any `[x]` (ownership/tenancy, atomicity, env-config, dead code, cross-layer, value-import enums, ledger discipline).
4. **Post-execution**: write `outcome/<task-id>-outcome.md`; flip checkbox here. (Review-gate rounds use their template-mandated file names: `outcome/plan-review-R1.md`, `outcome/midpoint-review-R1.md`.)
5. **Drizzle convention**: schema changes → `bun run db push`; custom SQL only → `bun db migrate`.

## Layer → rule-file mapping (sub-loop.ts auto-discovers; listed for reference)

| Files touched | AGENTS.md | Instructions |
|---|---|---|
| `backend/db/schema/**`, TBD repo/service | `AGENTS.md`, `backend/AGENTS.md` + layer dirs | `.agents/instructions/backend.instructions.md` (`+ tests.instructions.md` for `*.test.ts`) |
| `frontend/**`, `app/**` | `frontend/AGENTS.md`, `app/AGENTS.md` (+ layer dirs) | `.agents/instructions/frontend.instructions.md` |
| `shared/locale/**` | `shared/AGENTS.md` | — |
| `test/workflows/**` | `test/workflows/AGENTS.md` | `.agents/instructions/tests.instructions.md` |

## Implementation Strategy

Backend-first with a **test-first journey** authored right after repo primitives, then service → GraphQL → codegen → frontend → journeys green → review waves → propagation. Single-writer arbitration surface preserved byte-for-byte.

---

### Task 0: Pre-Implementation Baseline & Ledgers

- [x] 0. Establish error baseline + ledgers
  - Run: `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt`; `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`; `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Confirm ledger: `ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/deferred-items.md` (already seeded at planning time)
  - Write outcome: `outcome/0-baseline-outcome.md` (counts + any pre-existing anomalies observed)
  - _Requirements: REQ-0_

### Phase 1.5: Plan Review Gate (MANDATORY — executed during planning)

- [x] 1.5 Review complete plan via @plan-review skill; record verdict + fixes in `outcome/plan-review-R1.md`
  - Round 1 executed at planning time; see outcome file for dimension findings and fixes applied
  - _Requirements: REQ-0_

---

### Phase 2: Backend Foundation

- [x] 2.1 Enum extensions (DisputeResolution + NotificationType) and schema push
  - Extend `backend/enum/scheduling/dispute-resolution.enum.ts` (+ `Refund`, `PartialRefund`, `Uphold`; update `isDisputeResolution` coverage stays total)
  - Extend `NotificationType` TS mirror (`backend/enum/notifications/notification-type.enum.ts`) with `session_dispute_opened` / `session_dispute_resolved`, then the pgEnum list in `backend/db/schema/enums.ts:69`; run `bun run db push`
  - Regenerate nothing else yet (GraphQL surfaces come in 3.1)
  - [x] 2.1.QL `bun run scripts/health/sub-loop.ts <each edited file> --lifecycle duplicates` (exit 0)
  - [x] 2.1.TE enum unit-level assertions: new members present; guard totality (`Object.values` round-trip)
  - [x] 2.1.SEC N/A (values only) — confirm no behavior drift in shipped members (snapshot the enum list pre/post)
  - [x] 2.1.SR value imports used where consumed; no dead members
  - [x] 2.1.IV read printed rule files; validate
  - Outcome: `outcome/2.1-enum-extensions-outcome.md`
  - _Requirements: REQ-1, REQ-5, REQ-7_

- [x] 2.2 Canonical arbitration types
  - Create `backend/types/classes/session-arbitration.types.ts`: `SessionArbitrationProbeType`, `AdminDisputeCaseReturnType`, `ArbitrateDisputeInput`-shaped input type (service DTO), per `backend/types/AGENTS.md`
  - Verify composed ReturnTypes exist (`ReportReturnType`, `HomeWorkReturnType`, `RecitationReturnType`, `AdminAuditLogEntryReturnType`); if a ReturnType name differs, adapt to the canonical one — never invent a duplicate
  - If `backend/types/classes` contributes to the live `@/backend/types` barrel, add the new file there per barrel rules (relative `export *`, no imports)
  - [x] 2.2.QL sub-loop exit 0 · [x] 2.2.TE type-only file (no runtime tests) · [x] 2.2.SEC no client data widened · [x] 2.2.SR no duplicate type definitions · [x] 2.2.IV read printed rule files
  - Outcome: `outcome/2.2-types-outcome.md`
  - _Requirements: REQ-5, REQ-6_

- [x] 2.3 Repository primitives + 100% repo tests
  - `backend/db/repo/classes/session.repository.ts` (+ helpers): `openPostConfirmationDisputeOnce`, `resolveConsumedDisputeOnce`, `findArbitrationProbe`
  - `backend/db/repo/billing/wallet.repository.ts`: `debitForArbitrationOnce` (INSERT compensating `withdrawal`/`completed` row + guarded `balance >= amount` UPDATE, same tx)
  - Tests: extend `backend/db/test/repo/classes/session.repository.test.ts` and the wallet repo suite — happy paths, wrong-state/non-participant/double-fire null-miss matrix, insufficient-balance null, verified column effects, provenance lane NULL no-op path (repo-level via crafted row)
  - Tests use `runInRollback` + `tx` everywhere + try/catch error helpers; run via `bun run test/scripts/run-test.ts <test-path>`
  - [x] 2.3.QL / 2.3.TE (Tiers 1-4: boundary on amounts 0/large/2dp, chaos double-fire races, security deny matrix) / 2.3.SEC (predicate tenancy, mass-assignment shape) / 2.3.SR (atomicity, no read-then-write drift) / 2.3.IV
  - Outcome: `outcome/2.3-repo-primitives-outcome.md`
  - _Requirements: REQ-1, REQ-2, REQ-3, REQ-4, REQ-10_

- [x] 2.4 Journey test authored TEST-FIRST (expected red until 2.5/2.6 land)
  - Create `test/workflows/sessions/post-confirmation-dispute.journey.test.ts`: J1 Refund, J2 Partial, J3 Uphold + denials (non-admin resolve, teacher post-confirmation open, classification mismatch, insufficient wallet) + concurrent double-arbitration race
  - Provision the actor cast via the shared `actor-context` factory with a per-run prefix `` `jrn_sessions_${randomUUID().slice(0,8)}` `` (test/workflows/AGENTS.md rules 3–4)
  - Committed fixtures + tracked `afterAll` cleanup with zero-residue re-probes; NO `runInRollback`; notifications spied at the engine boundary
  - [x] 2.4.QL / 2.4.TE / 2.4.SEC / 2.4.SR / 2.4.IV
  - Outcome: `outcome/2.4-journey-test-first-outcome.md`
  - _Requirements: REQ-1 … REQ-10 (journey is the acceptance harness)_

- [x] 2.5 `SessionArbitrationService` — open, arbitrate, case review
  - New `backend/services/classes/session-arbitration.service.ts` (+ `.helpers.ts`): `openPostConfirmationDispute`, `arbitrateDispute` (classification dispatch, partial-amount validation, wallet reversal + lane credit orchestration, audit contract `buildArbitrationAuditContract`), `getAdminDisputeCase` (compose repo primitives + `AuditTrailService.listAuditTrail`, admin re-asserted via `assertAdminGovernanceClean`)
  - All mutations single-tx; notification receipts collected in-tx (publish deferred to caller in 3.1) OR emitted via the notification service from 2.6 once both land (wire at integration point; keep service pure-returning receipts)
  - Service tests: probe-chain matrix, all three outcomes, classification mismatches, audit-row assertions ({resolution, amounts, notePresent}), insufficient-funds rollback, note-content exclusion
  - [x] 2.5.QL / 2.5.TE (Tiers 1-4 incl. Promise.allSettled double-arbitrate) / 2.5.SEC (BOLA/BFLA/BOPLA + wildcard hygiene N/A-no-LIKE) / 2.5.SR / 2.5.IV
  - Outcome: `outcome/2.5-arbitration-service-outcome.md`
  - _Requirements: REQ-1 … REQ-6, REQ-8, REQ-10_

- [x] 2.6 `SessionDisputeNotificationService` — dispute waves
  - New `backend/services/classes/session-dispute-notification.service.ts`: `notifyAdminsOfDisputeOpened`, `notifyParticipantsOfDisputeResolved`; audience via `BroadcastAudienceRepository.resolveAudienceIds`; claim keys `session:<id>:dispute-opened|dispute-resolved`; per-recipient locale; publish-after-commit contract documented in callers
  - Wire into arbitration flows (open + resolve) for the CONSUMED generation only
  - Tests: recipient enumeration, claim-key determinism, in-tx receipts + post-commit publish ordering (spy), zero-emission for held-generation rows
  - [x] 2.6.QL / 2.6.TE / 2.6.SEC (recipient scoping) / 2.6.SR / 2.6.IV
  - Outcome: `outcome/2.6-notification-waves-outcome.md`
  - _Requirements: REQ-7_

- [x] 2.7 Mid-Point Review Gate (backend-only)
  - Dispatch review-backend / review-types / review-config subagents over Tasks 2.1–2.6 diff; fix findings; re-review to zero backend-specific findings
  - Run `bun run test/scripts/run-test.ts` on the new repo/service suites; journey suite may be green by now
  - Outcome: `outcome/midpoint-review-R1.md`
  - _Requirements: REQ-0_

---

### Phase 3: GraphQL Surface

- [x] 3.1 Pothos mutations + query + schema/codegen
  - `backend/graphql/mutation/classes/` + query dirs: `openPostConfirmationDispute` field; extend `resolveSessionDispute` input with `partialAmount`; new `adminDisputeCase` query + `AdminDisputeCase` object type (types from `@/backend/types`, single canonical object types)
  - Resolver dispatch: Cancel/Complete → shipped `resolveSessionDispute`; Refund/PartialRefund/Uphold → `arbitrateDispute`; publish notification receipts post-commit in the resolver/service shell per `docs/notifications/realtime-engine.md` contract
  - `bun run generate:gqlSchema && bun codegen`
  - [x] 3.1.QL / 3.1.TE (GraphQL tests via `setupTestServerLifecycle` + `testClient`: SDL surface pinning, denial bytes, dispatch matrix) / 3.1.SEC (scope gates, depth no-op) / 3.1.SR / 3.1.IV
  - Outcome: `outcome/3.1-graphql-surface-outcome.md`
  - _Requirements: REQ-1 … REQ-8, REQ-10_

---

### Phase 4: Frontend Surfaces

- [x] 4.1 GraphQL documents (+ codegen outputs committed)
  - Extend `frontend/graphql/sharedDocuments/scheduling/session-disputes.documents.ts`: `openPostConfirmationDisputeMutationDocument` (+ `id` on every object), `partialAmount` on the resolve document, `adminDisputeCaseQueryDocument`; re-export via `frontend/graphql/sharedDocuments/scheduling/index.ts`
  - [x] 4.1.QL / [x] 4.1.TE (document shape snapshot via generated types) / [x] 4.1.SEC / [x] 4.1.SR / [x] 4.1.IV
  - Outcome: `outcome/4.1-documents-outcome.md`
  - _Requirements: REQ-5, REQ-6, REQ-9_

- [x] 4.2 Admin `/disputes` extensions
  - `frontend/views/admin/disputes/`: extend `ResolveDisputeOptionGroup` to a **prop-driven** outcome list + rewritten change handler (the shipped two-way whitelist collapses unknown values to `Cancel`); thread `fee`/`feeHeld` props into `ResolveDisputeDialog` from the container's existing query data; add the partial-amount field with client validation; new `AdminDisputeCaseDialog` consuming `adminDisputeCase` (report/homework/recitation/audit, honest empty states); row chips showing escrow class
  - [x] 4.2.QL / 4.2.TE / 4.2.SEC / 4.2.SR / 4.2.IV
  - Outcome: `outcome/4.2-admin-disputes-ui-outcome.md`
  - _Requirements: REQ-5, REQ-6, REQ-9_

- [x] 4.3 Student dispute action (post-confirmation)
  - `frontend/views/student/sessions/` row lifecycle CTAs: enable Dispute ONLY for student-role views via a role-scoped predicate `isDisputable(session, role)` — `SessionRow` is shared with the teacher surface, so the shipped shared `DISPUTABLE_STATUSES` set must NOT be widened (that would expose the CTA on teacher rows too)
  - Parameterize the dispute confirmation dialog: `SessionDisputeConfirmDialog` hardwires `openSessionDisputeMutationDocument`; accept the mutation document + result accessor as props (built on the already prop-driven layout) and pass `openPostConfirmationDisputeMutationDocument` from the student-side arm
  - [x] 4.3.QL / 4.3.TE / 4.3.SEC / 4.3.SR / 4.3.IV
  - Outcome: `outcome/4.3-student-dispute-action-outcome.md`
  - _Requirements: REQ-1, REQ-9_

- [x] 4.4 Locale keys (en + ar) + parity
  - `shared/locale/{types,en,ar}/errors/` : `partialRefundAmountInvalid`, `disputeResolutionMismatch`; extend `sessions` namespace labels for post-confirmation copy (open confirm copy, outcome labels, case dialog titles)
  - Parity tests green: `shared/locale/sessions-namespace.parity.test.ts` (+ errors parity)
  - [x] 4.4.QL / [x] 4.4.TE (parity) / [x] 4.4.SEC / [x] 4.4.SR / [x] 4.4.IV
  - Outcome: `outcome/4.4-locale-outcome.md`
  - _Requirements: REQ-0.5, REQ-2, REQ-3, REQ-5, REQ-9_

---

### Phase 5: Hardening & Penetration

- [x] 5.1 Journey green + adversarial wave
  - `bun run test/scripts/run-test.ts test/workflows/sessions/post-confirmation-dispute.journey.test.ts` until green, then `bun run test/scripts/run-test.ts test/workflows`
  - Pen probes: student→arbitrate (403), admin→open dispute (oracle not-found), teacher→post-confirmation open, cross-family resolutions both directions, `partialAmount` fuzz (negative, zero, fee, over-precision, NaN string), concurrent refund+withdrawal wallet race
  - [x] 5.1.QL / 5.1.TE / 5.1.SEC / 5.1.SR / 5.1.IV
  - Outcome: `outcome/5.1-hardening-outcome.md`
  - _Requirements: REQ-1 … REQ-10_

---

### Phase 6: Final Gate & Propagation

- [x] 6.1 Deferred-items enforcement + full quality gate
  - `grep -E '^\| D[0-9]+' ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/deferred-items.md | grep -c "❌\|⚠️"` must be 0 (the legend lines contain the emoji, so scope the grep to ledger rows)
  - Close deferred item D4: audit actual admin-cohort size vs `resolveAudienceIds` bounds; flip D4 to ✅ (fits) or shrink scope deterministically
  - Close deferred item D5's precondition: canonical-doc diff ready for 6.2
  - `bun quality-gate` green; diff vs `/tmp/baseline-*` shows zero new errors; full test slice (db/services/graphql/workflows/ui) green
  - Outcome: `outcome/6.1-final-gate-outcome.md`
  - _Requirements: REQ-0, REQ-10_

- [x] 6.2 Knowledge propagation
  - Create `docs/sessions/dispute-arbitration.md` (canonical reference: two-generation model, classification, quantized-student-credit ruling D-4, compensating withdrawal-row pattern D-5, notification waves, audit convention, boundary with sibling tickets)
  - Update ONLY `docs/…` canonical docs that changed behavior (e.g. `docs/sessions/session-lifecycle.md` post-confirmation hop + `docs/admin/admin-session-governance.md` boundary note) — AGENTS.md / instructions stay untouched
  - Outcome: `outcome/6.2-knowledge-propagation-outcome.md`
  - _Requirements: REQ-0_
