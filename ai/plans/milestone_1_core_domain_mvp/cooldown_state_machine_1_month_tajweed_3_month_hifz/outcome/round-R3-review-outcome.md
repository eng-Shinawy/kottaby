# Round R3 — Independent Review Outcome

- **Scope reviewed:** `git diff 94160b9..HEAD` (37 files: enum + guard, repository guarded UPDATE, service derivation/extension with BFLA gate, admin GraphQL mutation, Pothos enum registration + field, i18n leaf en/ar, generated SDL, tests incl. 12-step journey).
- **Reviewer independence:** no other round-R*.md files were read. Contracts consulted: `plan.md` (§5, §6 race table), `tasks.md`, `deferred-items.md` (D4).
- **Verdict: R3: 0 findings (0 fixed, 0 remaining).** No code modifications were required; working tree clean after review.

---

## 1. review-types — canonical naming, aliases, enum imports, type coherence

Evidence gathered:

- `ApplicantCooldownState` is a real TS enum in `backend/enum/teachers/applicant-cooldown-state.enum.ts` with the canonical lowercase values (`none|active|expired`) and a fail-closed `isApplicantCooldownState` guard + pre-allocated member `Set` — byte-for-byte in discipline with `applicant-status.enum.ts`. Re-exported once through `backend/enum/teachers/index.ts`; no duplicate definition anywhere (rg sweep across `backend/` and `test/`).
- `@/` alias consistency: every new import in the diff uses `@/backend/…` / `@/shared/…`; no relative escapes.
- Enum **value**-imports at runtime sites are correct: `applicant-lifecycle.service.ts` (derivation + comparison), `user-management.mappers.ts` (comparison), `enum.pothos.ts` / `applicant.pothos.ts` (Pothos registration) all import the enum as a value; `applicant.types.ts` uses `import type` for the type-only position and its NOTE explicitly preserves that split for consumers.
- Type-construction coherence across all `ApplicantProfileReturnType` producers: exactly two producers exist — `ApplicantLifecycleService.getMyApplicantProfile` and `buildApplicantSnapshot` (`user-management.mappers.ts`, feeding `AdminUserDetailReturnType["applicant"]`, typed as `ApplicantProfileReturnType | null` in `backend/types/admin/admin-user.types.ts:193`). Both now emit all 8 closed fields including `cooldownState`. `bun tsgo` (full build, `--noEmit`) exits 0 — a missing field anywhere would be a compile error because `cooldownState` is a required `readonly`.
- The mappers change replaced the hardcoded stub `cooldownActive: false` with the value read off the shared `deriveCooldownState` (`cooldownState === ApplicantCooldownState.Active`) — one derivation boundary for both surfaces, per the export rationale on `deriveCooldownState`.
- `ApplicantCooldownExtensionAudit` is a closed readonly contract (field name + ISO instants + day count only); it is consumed by the service and persisted via `AuditLogWriteContract.details` (JSON string, ≤2000 chars — the composed payload is ~100 chars).

Result: **no findings.**

## 2. review-backend — races, transactions, audit atomicity, error paths, logger

- **Guarded write / TOCTOU:** `extendCooldownOnce` is ONE `UPDATE … WHERE id = ? AND status IN (pending, in_evaluation, failed) RETURNING *` — the eligible pre-states are the predicate, re-evaluated at write time under the row lock, so an interleaved certification can never be overwritten. Extend-vs-extend last-write-wins (incl. the stale-snapshot supersede nuance and the audit `from` = read-snapshot fidelity) is **explicitly accepted** by plan §6 race table and ledgered in `deferred-items.md` D4 ("no `SELECT FOR UPDATE` … audit trail records BOTH extensions … never-shortens holds against the original base") — implementation matches the accepted contract, so this is a documented design decision, not a defect.
- **Transaction boundaries:** `extendApplicantCooldown` = actor gate (BEFORE any tx opens) → bounds check (BEFORE any DB contact) → ONE `withTransaction(outerTx, …)` containing: guard read → base/max math → guarded write → `AuditService.createAuditLog` (same `tx` → shares commit/rollback fate) → in-tx profile re-read. Savepoint-vs-top-level branch delegated to the canonical `withTransaction` substrate. Audit-row atomicity with the write holds.
- **Error-path completeness:** every throw is reachable and localized — `UnauthorizedError` / `ForbiddenError` (actor gate), `APPLICANT_COOLDOWN_EXTENSION_INVALID` (bounds, static copy in both locales), `APPLICANT_NOT_FOUND` (read miss + fail-closed post-write re-read miss), `APPLICANT_ALREADY_CERTIFIED` (read arm + guarded-write-miss collapse, both via the shared `denyAlreadyCertified`). The two write-miss causes (concurrent certification vs. concurrent delete) collapse onto the certified rejection — fail-closed, zero writes, no data harm; the service tier disambiguates the read miss from the certified status as documented.
- **Dead code:** none. `isApplicantCooldownState` is currently exercised only by tests but is plan-mandated (tasks.md Task 1: "guard mirrors the `isApplicantStatus` discipline") — canonical vocabulary surface, not dead code. `denyAlreadyCertified` is used by both certified arms; `EPOCH_PAST`/`MS_PER_DAY` are used; module-private `MS_PER_DAY` mirrors the existing in-repo pattern (`subscription-activation.service.ts` keeps a private copy alongside the exported billing one).
- **Cross-layer imports:** `services/teachers → services/admin` (`assertActiveActorAdmin`, `AuditService`) and `services/admin → services/teachers` (`deriveCooldownState`) are new directions but follow established repo precedent for cross-service imports (`student-onboarding.helpers` → billing; `cold-start-certification.service` → notifications); the alternative (duplicating the derivation or the gate) would violate the single-boundary rule.
- **`console.*`:** none in any changed source (rg sweep; only a test asserting absence and a doc comment mentioning the rule).
- **Logger contract:** `logger.logDomainError` fires on exactly the enumerated domain rejections plus the post-commit `APPLICANT_COOLDOWN_EXTENDED` event — the latter is mandated verbatim by tasks.md Task 4. `DomainErrorContext` admits the extra keys. Happy paths otherwise silent.

Result: **no findings.**

## 3. review-frontend — generated SDL fidelity

- `bun run generate:gqlSchema` was executed during review: it rewrote `frontend/graphql/generated/schema.graphql` with a **zero-byte diff** against the committed file → the SDL is exactly what the Pothos sources produce; no hand-edits.
- Diff content verified: `enum ApplicantCooldownState { Active Expired None }` (wire names None/Active/Expired over the lowercase runtime values), `ApplicantProfile.cooldownState: ApplicantCooldownState!`, and `adminExtendApplicantCooldown(additionalDays: Int!, applicantId: Int!): ApplicantProfile!` — args and return type contract-exact.
- `git diff 94160b9..HEAD --name-only` shows the ONLY frontend change is the generated file; zero frontend source files touched.

Result: **no findings.**

## 4. pentester — abuse sweep of `adminExtendApplicantCooldown`

- **Authentication/authorization layering (3 independent layers):** ① `authScopes: { $all: { authenticated: true, role: [Admin] } }` inlined verbatim (census-scanner readable) — anonymous → `UNAUTHORIZED`, authenticated non-admin → `FORBIDDEN`, both pre-resolver; ② `requireAdminUser(ctx)` belt (narrows `ctx.user`; `user.id` is the only actor source); ③ service-side `assertActiveActorAdmin` (deleted → blocked → actively-suspended deterministic ladder) — anonymous/missing/non-admin/governed actor denied with zero writes and zero audit rows before bounds and before any applicant contact. Wire tests prove all three: anonymous via Apollo client AND raw HTTP, teacher token → FORBIDDEN with zero side effects, unresolvable actor id denied at the service gate (service test).
- **BOLA:** the surface is admin-only by contract; `applicantId` is the intended governance target (applicants share the global `users` PK; there is no tenant scoping to bypass). No client-supplied actor identity exists — the smuggled-`actorId` argument dies as `GRAPHQL_VALIDATION_FAILED` pre-resolver (wire test), and the audit `actorId` comes exclusively from the resolver's session user.
- **Input validation:** `applicantId` → `requirePositiveIntId` at the resolver (0/negative/non-integer rejected). `additionalDays` → GraphQL `Int!` guarantees integer; server-side bounds `[1, 3650]` (`Number.isInteger` + min/max) enforced in the service BEFORE any DB contact; boundary values 1 and 3650 accepted, 0/−1/3651 rejected with zero writes (service tests). No overflow: max shift is 3650 × 86,400,000 ms.
- **Injection:** the UPDATE is parameterized Drizzle — id, expiry instant, and the three status members are bound values; the only raw SQL is the `now()` literal. Repo source-shape tests pin this.
- **Information leakage:** all user-facing denials resolve through localized static copy (no ids, no internal state; the bounds copy carries no ICU placeholder — pinned by the parity test in both locales); domain error codes are the documented vocabulary and pass the masking boundary (wire-asserted).
- **Replay/idempotency:** the mutation is deliberately non-idempotent-but-monotone — each call can only lengthen the cooldown (`max(stored, now) + days`); repeated submits each land ONE audit row, so the effect is observable and bounded by admin identity. Accepted semantics per plan §6.
- **Audit-trail integrity:** rows are INSERT-only through `AuditService.createAuditLog` inside the extension's transaction (DB immutability trigger as defense in depth); details carry field NAME + ISO instants + day count only — no contact PII, no credentials, no tokens; truncation-safe; the census entry (`Adjust` / `applicant`) is registered and the completeness journey executes it. Actor attribution is session-derived and cannot be forged via arguments.

Result: **no findings.**

## 5. Verification matrix (all green)

| Check | Command | Result |
|---|---|---|
| Type coherence | `bun tsgo` | exit 0 |
| Enum guard (Tier 1–4) | `run-test.ts backend/enum/teachers/applicant-cooldown-state.enum.test.ts` | 22 pass / 0 fail |
| Repo guarded write | `run-test.ts backend/db/test/repo/teachers/applicant.repository.test.ts` | 17 pass / 0 fail |
| Service (incl. concurrency + actor gate) | `run-test.ts backend/services/teachers/applicant-lifecycle.service.test.ts` | 56 pass / 0 fail |
| GraphQL wire abuse | `run-test.ts backend/graphql/test/admin-applicant-cooldown.wire.test.ts` | 12 pass / 0 fail |
| Schema surface | `run-test.ts backend/graphql/test/schema-surface.test.ts` | 93 pass / 0 fail |
| SDL static assertions | `run-test.ts backend/graphql/test/sdl-static-assertions.test.ts` | 57 pass / 0 fail |
| Locale parity | `run-test.ts shared/locale/errors-namespace.parity.test.ts` | 50 pass / 0 fail |
| 12-step journey | `run-test.ts test/workflows/teachers/cooldown-state-machine.test.ts` | 12 pass / 0 fail |
| Audit completeness journey | `run-test.ts test/workflows/admin/audit-completeness.journey.test.ts` | 19 pass / 0 fail |
| SDL regeneration fidelity | `bun run generate:gqlSchema` → `git diff` | zero diff |
| Per-file sub-loop (`--lifecycle duplicates`) | 8 implementation files | all exit 0 |
| `console.*` / unsafe-cast sweep | rg over changed sources | clean |
| Working tree after review | `git status --porcelain` | clean (no changes made) |

## 6. Explicitly-checked accepted risks (not findings)

1. **Extend-vs-extend last-write-wins** (incl. stale-snapshot supersede and audit-`from` fidelity) — accepted by plan §6, ledgered as D4; the "never shortens" property holds per-invocation against the read base exactly as the plan words it.
2. **Concurrent-delete collapse** — a write miss caused by a concurrent user deletion surfaces as the typed `APPLICANT_ALREADY_CERTIFIED` rejection rather than `APPLICANT_NOT_FOUND`; fail-closed, zero writes, astronomically narrow window.
3. **`isApplicantCooldownState` runtime-unused today** — plan-mandated guard mirroring the enum discipline; canonical surface for future transport payloads.

## Verdict

**R3: 0 findings (0 fixed, 0 remaining).** The implementation satisfies all four review perspectives with evidence; no fixes were necessary; no files were modified by this review.
