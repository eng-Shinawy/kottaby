# Round R11 — Final Confirmation Review

Scope: `git diff 94160b9..HEAD` (backend-only cooldown state machine: TS enum + guard, guarded
repo UPDATE, service derivation/extension + BFLA gate + audit, admin GraphQL mutation, Pothos
enum/field, i18n en/ar, generated SDL, tests). Independent review — no prior-round knowledge.

Environment constraints honored: no `quality-gate`/`oxlint`/`lint:type-aware`/`biome:check`;
verification via `bun tsgo`, per-file `sub-loop.ts --lifecycle duplicates`, targeted
`test/scripts/run-test.ts`, `generate:gqlSchema` + `codegen` + git.

---

## Perspective 1 — review-types (naming, duplicates, aliases, enum imports, construction coherence)

Evidence:
- `ApplicantCooldownState` is declared exactly once (`backend/enum/teachers/applicant-cooldown-state.enum.ts`,
  members `None/Active/Expired` → `"none"/"active"/"expired"`); re-exported once via
  `backend/enum/teachers/index.ts`; no symbol collision anywhere under `backend/`, `shared/`, `frontend/`
  (rg sweep over all non-generated sources).
- Pothos registration is single (`enum.pothos.ts` `ApplicantCooldownStatePothosEnum`) and the domain
  object (`applicant.pothos.ts`) imports the registered ref — no re-registration (would be a runtime
  "already declared" error); `tsgo -b --noEmit` clean confirms.
- Import forms correct at every site: value imports where the enum is constructed/compared at runtime
  (service `deriveCooldownState`, mappers `cooldownState === Active`, pothos registry, tests);
  `import type` in `applicant.types.ts` (with an explanatory NOTE pinning the discipline).
- `ApplicantProfileReturnType` grew `cooldownState`; the only two producers (service
  `getMyApplicantProfile`, admin `buildApplicantSnapshot`) both supply it — type check clean.
- SDL enum matches the TS single source: wire names `None/Active/Expired`, runtime values
  `none/active/expired` (pinned by `schema-surface.test.ts` "3 canonical values" test).
- `isApplicantCooldownState` has no production consumer today — accepted, NOT a finding: the guard is an
  explicit planned deliverable of this plan (mirrors `isApplicantStatus`'s public-vocabulary role;
  transport values of the GraphQL enum are schema-validated; the 4-tier guard test suite pins it).

Result: 0 findings.

## Perspective 2 — review-backend (races/TOCTOU, dead code, cross-layer imports, tx atomicity, error/logger/i18n, comment hygiene)

Evidence:
- Guarded writes: `transitionToInEvaluation` / `transitionToFailed` / `extendCooldownOnce` fold the
  lifecycle pre-state into the WHERE predicate with `RETURNING` — zero-row = miss signal; no
  read-modify-write. `recordVerificationAttempt` is a single atomic `col = col + 1`.
- Transaction atomicity: extension write + exactly ONE audit row via `AuditService.createAuditLog`
  inside ONE `withTransaction` (savepoint when an outer tx is supplied); the post-write profile
  re-read rides the same tx; the fail-closed null arm is chaos-probe tested.
- Error/logger/i18n discipline: all user-facing copy via `getServerTranslations` property access;
  no `console.*` in any changed file (rg sweep); denials logged once each with structured
  `code/entity/entityId`; happy paths silent. The post-commit success event uses `logDomainError`
  deliberately (documented in the service header, structured `code` context, ids + instants only,
  test-pinned `APPLICANT_COOLDOWN_EXTENDED`) — accepted as the codebase's single `[DOMAIN]` channel.
- Two-source split intact: cooldown decision reads `applicants.cooldown_until` ONLY; the `users`
  table is never imported into the lifecycle module (the actor-side BFLA gate legitimately reads the
  ACTOR's user row via `admin-guards.helpers`). Extension writes touch only `cooldown_until` +
  `updated_at` (journey test pins the governance triple byte-identical).
- Comment hygiene: zero plan-artifact references in code (the repo test itself enforces
  `/REQ-\d|DEV2|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/` absence; independent rg sweep of
  every added line found only domain vocabulary); referenced engineering docs
  (`docs/teachers/applicant-lifecycle.md §2.1`, `docs/drizzle/prepared-statements.md`) exist and match.
- `REQ-060` in the mutation header is byte-identical at 94160b9 — pre-existing, not a finding.

**Finding 1 (fixed) — [Low] backend/services/teachers/applicant-lifecycle.service.ts:465 —
stale-base lost update between concurrent admin extensions (TOCTOU).**
`extendApplicantCooldown` read the applicant row with a NON-locking `findByUserId`, computed the
lengthen-only expiry `max(base, now) + days` in the application, then wrote through
`extendCooldownOnce` — whose guard re-checks the STATUS but not the stored instant. Two extensions
racing on distinct connections could both read the same base; the smaller write could commit last,
silently shortening a concurrently committed longer window — violating the documented
"can only LENGTHEN, never shorten" invariant and leaving an audit `to` that no longer matches the row.
Fix: the in-transaction guard read now takes the row's `FOR UPDATE` gate lock via the existing
`ApplicantRepository.findForBookingGate` (the same primitive the booking/finalize flows use; lock held
to commit, so a rival extension/certification serializes behind it and the base can never be stale).
Docblock + inline comment updated to state the lock rationale; the repo primitive's docblock now lists
"a rival admin cooldown extension" among the gate-locked writers. No schema/API change.

Result: 1 finding → fixed.

## Perspective 3 — review-frontend (generated-SDL integrity)

Evidence:
- `bun run generate:gqlSchema` → `git diff` EMPTY (committed `frontend/graphql/generated/schema.graphql`
  is byte-stable; the committed diff adds exactly the `ApplicantCooldownState` enum, the
  `cooldownState: ApplicantCooldownState!` field, and the `adminExtendApplicantCooldown` mutation).
- `bun run codegen` → `git status` shows no drift in the tracked generated
  `frontend/graphql/generated/gql/graphql.ts`.
- `bun run tsgo` clean ⇒ frontend type layer agrees with the refreshed artifacts.

Result: 0 findings.

## Perspective 4 — pentester (authz chain, BOLA/IDOR, injection, leakage, abuse, two-source split)

Evidence:
- Authz chain is triple-gated: `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
  (pinned verbatim by the surface test), `requireAdminUser(ctx)` prelude, and the service-side
  `assertActiveActorAdmin` BFLA gate that runs FIRST (anonymous → UNAUTHORIZED class; missing /
  non-admin / governed actor → FORBIDDEN class; zero writes, zero audit rows — tested).
- BOLA/IDOR: the acting identity comes exclusively from `ctx.user.id` (no such resolver arg; a
  smuggled `actorId` arg dies as `GRAPHQL_VALIDATION_FAILED` pre-resolver — wire-tested). `applicantId`
  is an admin-scoped target selector, which is the intended admin surface; identity-probe tests pin
  that denials disclose nothing about other applicants. Not in the public-operations allowlist
  (wire-tested).
- Injection: all repo statements parameterized (bound ids/statuses/instants; constant `$1` raw SQL);
  no string interpolation of client data anywhere in the changed cluster.
- Leakage/abuse: `additionalDays` bounds-checked to integer [1, 3650] BEFORE any DB contact
  (boundary tests both edges); audit details carry field NAME + ISO instants + day count only (no PII);
  log payloads are entity ids + instants; returned profile carries no governance fields (BOPLA);
  `entity_type` is a varchar column — the new `applicant` mint is a legitimate value, mirrored in the
  frontend vocabulary + en/ar labels + parity locks.

Result: 0 findings.

---

## Verification after the fix

- `bun run tsgo` — clean (exit 0), re-run post-fix.
- Per-file sub-loop (`--lifecycle duplicates`) — 0 issues on all three modified files.
- Re-run affected/adjacent suites (all green):
  - `backend/services/teachers/applicant-lifecycle.service.test.ts` — 57 pass / 0 fail
    (includes the re-anchored post-write-miss chaos probe)
  - `backend/graphql/test/admin-applicant-cooldown.wire.test.ts` — 12 pass / 0 fail
  - `backend/db/test/repo/teachers/applicant.repository.test.ts` — 17 pass / 0 fail
  - `test/workflows/teachers/cooldown-state-machine.test.ts` — 12 pass / 0 fail (12-step journey)
  - `backend/graphql/test/schema-surface.test.ts` — 93 pass / 0 fail
  - `backend/graphql/test/sdl-static-assertions.test.ts` — 57 pass / 0 fail
  - `backend/enum/teachers/applicant-cooldown-state.enum.test.ts` — 22 pass / 0 fail
  - `shared/locale/errors-namespace.parity.test.ts` — 50 pass / 0 fail
  - `shared/locale/adminUsers-namespace.parity.test.ts` — 67 pass / 0 fail
  - `test/workflows/admin/audit-completeness.journey.test.ts` — 19 pass / 0 fail
  - `frontend/views/admin/audit/audit-trail-filters.entityType.test.ts` — 8 pass / 0 fail
- SDL/codegen regenerated earlier in the round — zero drift; the fix touches no schema surface.
- NO git commit performed (per round rules).

## Files modified by this round

- `backend/services/teachers/applicant-lifecycle.service.ts` — gate-locked guard read (`findForBookingGate`)
  in `extendApplicantCooldown` + docblock/comment updates.
- `backend/db/repo/teachers/applicant.repository.ts` — `findForBookingGate` docblock now lists the
  admin cooldown extension among the gate-locked writers.
- `backend/services/teachers/applicant-lifecycle.service.test.ts` — post-write-miss chaos probe
  re-anchored to the post-fix read topology (stub targets the shaper's `findByUserId`).

## Verdict

R11: 1 finding (fixed)

---

## Orchestrator Disposition (post-review)

The R11 finding is a **re-discovery of the plan-accepted D4 tradeoff**, not a new defect:

- The plan's design (§6 race table, "concurrent-admin-extensions" row) explicitly accepts last-write-wins on `cooldown_until` for this 5-SP ticket, with both extensions audit-observable.
- The plan's §6 discipline states **"SELECT FOR UPDATE Usage: NONE"** for this ticket; deferred item **D4** explicitly routes a `FOR UPDATE` variant (e.g. a purpose-built `findByIdForUpdate`) to a **future performance-hardening ticket (post-M1)**.
- The mid-point review already appended this exact nuance to D4's ledger notes ("`from` is the guard-read snapshot, not the true pre-write instant; never-shortens holds vs the original base, not an interim write").
- The applied fix reused `findForBookingGate` (the booking flow's gate lock), coupling cooldown reads to an unrelated flow's lock topology — a deadlock-ordering risk the plan's race analysis never covered.

**Action:** the three file changes were **reverted** per PLAN LOCK (plan §6 + D4 are authoritative). The finding is dispositioned as design-accepted (D4), not open. Recommendation recorded for the future hardening ticket: a purpose-built `ApplicantRepository.findByIdForUpdate` with single-flow lock semantics.

**Post-revert verification:** worktree restored to HEAD (R10-reviewed state); affected suites re-verified green (service 57, repo 17, journey 12) — see round-R12 outcome for the final consecutive-zero confirmation.
