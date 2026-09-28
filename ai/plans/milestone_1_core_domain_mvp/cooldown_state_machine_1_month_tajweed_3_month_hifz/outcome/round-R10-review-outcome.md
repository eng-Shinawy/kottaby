# Round R10 — Independent Review Outcome

**Scope:** `git diff 94160b9..HEAD` (backend-only cooldown state machine slice: TS enum + guard, guarded repo UPDATE, service derivation/extension + BFLA gate + audit, admin GraphQL mutation, Pothos enum/field, i18n en/ar, generated SDL, tests).
**Special focus this round:** DATA & MIGRATION SAFETY (review-backend perspective).
**Method:** adversarial sweep from four sequential perspectives, every claim below re-verified against the diff and by executing the permitted tooling (`bun tsgo`, targeted `run-test.ts`, per-file sub-loop). Pre-existing-at-94160b9 issues excluded. No files modified by this review.

## Verdict

**R10: 0 findings** — zero fixes applied, zero remaining.

---

## Perspective 1 — review-types (standard sweep)

Evidence:
- `backend/enum/teachers/applicant-cooldown-state.enum.ts` (new): `ApplicantCooldownState` (none|active|expired) + `isApplicantCooldownState` fail-closed guard (string typeof short-circuit, `ReadonlySet` membership). Barrel export added in `backend/enum/teachers/index.ts`. No pgEnum anywhere — confirmed by the schema-surface pin ("no pgEnum behind it") and the absence of any schema delta (see P2a).
- `backend/types/teachers/applicant.types.ts`: `ApplicantProfileReturnType` gains `readonly cooldownState: ApplicantCooldownState` (8-field closed shape; docblock updated 7→8). New `ApplicantCooldownExtensionAudit` contract (`field: "cooldown_until"`, `from: string | null`, `to: string`, `additionalDays: number`) — metadata only, no PII surface.
- Both producers of the profile shape updated: service `getMyApplicantProfile` (derives `cooldownState` from the SAME captured `now` as `cooldownActive`) and admin mapper `buildApplicantSnapshot` (`backend/services/admin/user-management.mappers.ts`), which now derives `cooldownActive` from the shared `deriveCooldownState` boundary instead of the previous hardcoded `cooldownActive: false` (that hardcode is REMOVED by this diff, so it is not a pre-existing finding; the fix is in scope and correct). `AdminUserDetailReturnType.applicant` reuses `ApplicantProfileReturnType` (`backend/types/admin/admin-user.types.ts:193`), so type-level propagation is complete and compiler-enforced — `bun tsgo` exits clean.
- Hygiene scans over all added lines: `console.*` → 0 matches; plan-artifact references (`ai/plans`, `plan.md`, `specs.md`, `tasks.md`, `deferred-items.md`, `REQ-\d`) → 0 matches in code (the repo test additionally pins their absence statically).

## Perspective 2 — review-backend (standard sweep + DATA & MIGRATION SAFETY focus)

**(a) ZERO schema delta claim — VERIFIED.**
- `git diff 94160b9..HEAD --name-only` filtered for schema/migration/SQL/drizzle artifacts → empty (only `backend/db/repo/teachers/applicant.repository.ts` and a NEW test file `backend/db/test/repo/teachers/applicant.repository.test.ts` exist under `backend/db`; no file under `backend/db/schema/**`, no `*.sql`, no drizzle `meta/_journal` artifacts).
- Working tree contains no leaked `db push`/`migrate` outputs (only untracked plan outcome notes from other rounds, not read).
- `applicants.cooldownUntil` (`timestamp("cooldown_until")`) is byte-untouched; the plan's "no schema delta; guarded UPDATE only" contract holds.

**(b) Write-path column confinement — VERIFIED at the SQL/template level.**
- `ApplicantRepository.extendCooldownOnce` (`backend/db/repo/teachers/applicant.repository.ts:562-583`) is a single Drizzle UPDATE: `.set({ cooldownUntil: newExpiry, updatedAt: sql\`now()\` })` → exactly `SET "cooldown_until" = $1, "updated_at" = now()`; WHERE = `id = $2 AND status IN ('pending','in_evaluation','failed')` (bound enum values, `inArray`); `.returning()`. No other column of any table is reachable from this statement.
- Fully parameterized (no `${` interpolation, no status string literals — both statically pinned by the repo test suite); no prepared statement; no `users` import/contact.
- Behaviorally proven by the repo tests: lifecycle status, `verification_attempts`, `last_attempt_at`, and the account row's `suspended`/`suspendedAt`/`suspendedPeriodDays` all survive the write untouched; `updated_at` stamps strictly forward; `RETURNING *` returns exactly the canonical 7 columns.

**(c) Existing-row compatibility (NULL / very old / far-future) — VERIFIED against plan §5.3/D2.**
- Service math (`applicant-lifecycle.service.ts:503-506`): `base = row.cooldownUntil ?? EPOCH_PAST` (`new Date(0)`), `newExpiry = new Date(Math.max(base.getTime(), now.getTime()) + additionalDays * MS_PER_DAY)` — exactly the plan's `max(currentCooldownUntil, now) + days`:
  - NULL `cooldown_until` → sentinel collapses to `now` → fresh window from today (never a 1970 expiry).
  - Very old / already-expired value → `max(old, now) = now` → fresh window; the "extend a 30-day-old expiry into the past" failure mode from D2 is structurally impossible.
  - Active / far-future value → stored base honored verbatim + days (LENGTHEN-only; wire test pins base + 60 days to the millisecond on both wire and committed row).
- Boundary discipline: `deriveCooldownState` uses strict `cooldownUntil > now`, shared by the self profile and the admin snapshot (one derivation, exported); NULL → `None`.
- Bounds: `!Number.isInteger(additionalDays) || < 1 || > 3650` → `APPLICANT_COOLDOWN_EXTENSION_INVALID` (422) — covers 0, 3651, negatives, NaN, non-integer floats (dedicated arm added by commit a3b8b43). Service tests cover bounds 1 and 3650 accepted, 0/3651/negative rejected, localized byte-equal per locale.

**(d) Overflow / insanity bounds — VERIFIED.**
- Max extension 3650 days = 3.1536e11 ms ≪ `Number.MAX_SAFE_INTEGER`; day math is pure UTC epoch arithmetic (DST-immune).
- JS `Date` valid range ±8.64e15 ms; PostgreSQL `timestamp` domain tops out at year 9999 (≈ 2.53e14 ms), so `base + 3.15e11` can never produce an Invalid Date or a PG out-of-range write for any storable base instant. Insane stored far-future values degrade to `max(base, now)` semantics — never shortened, never invalid.

Additional backend sweep (all clean): write + audit share ONE `withTransaction` boundary (audit-insert failure provably rolls the extension back — test-pinned); exactly ONE `AuditActionType.Adjust` / `entityType: "applicant"` audit row per extension; `from` is the pre-read guard value, `to` the written instant; post-commit `logDomainError("APPLICANT_COOLDOWN_EXTENDED", {code, …})` carries ids + ISO instants only; the fail-closed post-write profile re-read arm keeps the non-null return contract; concurrency model matches plan §6 (guarded WHERE predicates, no FOR UPDATE, last-write-wins is monotonic by construction; concurrent-extension vs certification/finalize arms covered by `Promise.allSettled` tests).

## Perspective 3 — review-frontend (generated-SDL integrity only)

- `frontend/graphql/generated/schema.graphql` delta is exactly the three sanctioned elements: `enum ApplicantCooldownState { Active Expired None }`, `ApplicantProfile.cooldownState: ApplicantCooldownState!`, `adminExtendApplicantCooldown(additionalDays: Int!, applicantId: Int!): ApplicantProfile!` — sorted, no other surface touched.
- Integrity re-proven by execution: `sdl-static-assertions.test.ts` (57 pass) reads the COMMITTED artifact and asserts it against `printSchema(lexicographicSortSchema(graphQLSchema))`; `schema-surface.test.ts` (93 pass) pins the mutation-set freeze, sorted admin-block position (18 mutations contiguous), enum-set freeze, exact enum values (wire names + lowercase runtime values), and the `$all` conjunction snapshot.
- Sibling artifact `frontend/graphql/generated/gql/graphql.ts` (unchanged, byte-identical at 94160b9): staleness probed — it mirrors enums only when referenced by a committed frontend document (every `export enum` in the file has ≥2 references: definition + operation usage; e.g. `ProrationDirection`, `AdminUserGovernanceFilter`); no frontend document selects `cooldownState` or the new mutation, so the artifact is exactly what a regeneration would emit. No drift.

## Perspective 4 — pentester (standard sweep)

- BFLA: schema-layer `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` inlined and pinned verbatim off the built schema's `pothosOptions.authScopes`; absent from `PUBLIC_OPERATIONS`; anonymous → `UNAUTHORIZED`, teacher → `FORBIDDEN` (generic scope copy, zero side effects — wire-proven). Defense-in-depth: service-level `assertActiveActorAdmin` runs FIRST (deleted/blocked/actively-suspended ladder), before bounds validation and before any DB contact; denials perform zero writes and mint zero audit rows.
- Identity: audit actor is `requireAdminUser(ctx).id` (session-derived); there is no caller-supplied actor surface — a smuggled `actorId` root arg dies as `GRAPHQL_VALIDATION_FAILED` pre-resolver (wire-pinned).
- Injection: single parameterized UPDATE; enum members as bind values; no interpolation, no raw SQL beyond `sql\`now()\``; statically pinned.
- Input hardening: `requirePositiveIntId(applicantId)` + service integer/bounds gate; `Int!` non-null args at the schema layer.
- Data exposure: audit `details` = `{field, from, to, additionalDays}` only (no PII/credentials/tokens, ≤2000 chars); no notification fan-out (wire-pinned zero rows); two-source split observable pinned (`users.suspended` stays `false` after a successful admin extension).

## Verification executed (all green)

| Check | Result |
|---|---|
| `bun tsgo` | clean |
| per-file sub-loop `--lifecycle duplicates` (16 changed source files: enum, repo, service, mappers, mutation, 2× pothos, types, 6× locale, frontend vocabulary, audit catalog) | 0 failures |
| `applicant-cooldown-state.enum.test.ts` | 22 pass / 0 fail |
| `applicant-lifecycle.service.test.ts` | 57 pass / 0 fail |
| `applicant.repository.test.ts` (live PG, rollback-isolated) | 17 pass / 0 fail |
| `admin-applicant-cooldown.wire.test.ts` (real server + DB) | 12 pass / 0 fail |
| `schema-surface.test.ts` | 93 pass / 0 fail |
| `sdl-static-assertions.test.ts` | 57 pass / 0 fail |
| `errors-namespace.parity.test.ts` | 50 pass / 0 fail |
| `adminUsers-namespace.parity.test.ts` | 67 pass / 0 fail |
| `audit-trail-filters.entityType.test.ts` | 8 pass / 0 fail |
| `cooldown-state-machine.test.ts` (cross-actor journey) | 12 pass / 0 fail |
| `audit-completeness.journey.test.ts` | 19 pass / 0 fail |

## Findings

None. No fixes applied; no files modified; no commits made.

**R10: 0 findings**
