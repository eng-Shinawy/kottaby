# Round R9 — Independent Review Outcome

Scope: `git diff 94160b9..HEAD` (46 files, +5325/−122) — backend-only cooldown state machine: TS enum + guard, repository guarded UPDATE, service derivation/extension + BFLA gate + audit, admin GraphQL mutation, Pothos enum/field, i18n en/ar, generated SDL, tests.

Environment constraints honored: no `bun quality-gate` / `bun oxlint` / `bun lint:type-aware` / `bun biome:check`. Verification via `bun tsgo`, per-file `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`, and targeted `bun run test/scripts/run-test.ts <path>`.

---

## Perspective 1 — review-types (standard sweep)

- `backend/enum/teachers/applicant-cooldown-state.enum.ts` — byte-shape twin of `applicant-status.enum.ts` (TS enum + pre-allocated `ReadonlySet` guard, fail-closed, no throw). Barrel export added to `backend/enum/teachers/index.ts` alongside the three siblings.
- `backend/types/teachers/applicant.types.ts` — `ApplicantProfileReturnType` grows exactly one readonly member (`cooldownState: ApplicantCooldownState`); type-only import with the `useImportType` NOTE extended to cover both enums. New closed `ApplicantCooldownExtensionAudit` contract (`field: "cooldown_until"`, `from: string | null`, `to`, `additionalDays`) — metadata only, no PII.
- `ApplicantSelectType` reuse unchanged; repo `extendCooldownOnce` returns the canonical 7-column row (pinned by the repo suite's key-set assertion).
- `bun tsgo` → clean (run twice: pre- and post-fix).

Evidence: typecheck exit 0; closed-shape key assertions in `applicant-lifecycle.service.test.ts` ("EXACTLY the canonical eight keys").

## Perspective 2 — review-backend (standard sweep)

- Repository: `extendCooldownOnce` is a single guarded UPDATE — non-terminal pre-states folded into WHERE as enum members, `RETURNING *`, `row ?? null` miss signal, REQUIRED `tx` (no `tx ?? db` standalone branch), no prepared statement, parameterized only. Verified live: 17/17 repo tests pass.
- Service: captured-now discipline (one `new Date()` per invocation); strict `cooldownUntil > now` boundary shared by the guard, the profile shaper, and `deriveCooldownState` (exported, single derivation point); extension math `max(stored, now) + days` lengthens only; `withTransaction(outerTx, …)` wraps read → terminal guard → guarded write → `AuditService.createAuditLog` (same tx) → fail-closed profile re-read; post-commit event outside the tx. Bounds 1..3650 integer-checked before any DB contact.
- BFLA gate: `assertActiveActorAdmin(actorId, locale, outerTx)` FIRST — zero writes/audit rows on anonymous/missing/non-admin/governed actor; mutation layer additionally `$all`-gates and sources `actorId` exclusively from `ctx.user.id`.
- Mappers: `buildApplicantSnapshot` now derives `cooldownActive` FROM `deriveCooldownState` (boolean read off the enumeration — no drift possible) and mirrors the applicant-facing purchase semantics; no import cycle (verified: `audit.service` imports schema+types only; `tsgo` green).
- i18n: `applicantCooldownExtensionInvalid` (en/ar, zero ICU placeholders, pinned in `errors-namespace.parity.test.ts`), `entityTypeLabels.applicant` (48-slot parity inventory updated), audit-label catalog entry, frontend `ENTITY_TYPE_KEY_BY_WIRE` + entityType filter test.
- No `console.*` in any changed file; no plan-artifact references in added lines (scanned all added lines of the 46-file diff; the only hit is the anti-plan-artifact regex pin inside the repo test itself).

Evidence: 57/57 service, 17/17 repo, 12/12 wire, 12/12 journey, 19/19 audit-completeness journey, 67/67 locale parity, 8/8 frontend label tests pass; sub-loop ✅ on all changed production + test files.

## Perspective 3 — review-frontend (generated-SDL integrity only)

- `frontend/graphql/generated/schema.graphql`: new `enum ApplicantCooldownState { Active Expired None }` (built schema is sorted; wire names are the TS member names, runtime values lowercase — verified against the canonical enum by `schema-surface.test.ts`), `ApplicantProfile.cooldownState: ApplicantCooldownState!`, `adminExtendApplicantCooldown(additionalDays: Int!, applicantId: Int!): ApplicantProfile!` at its sorted position in the admin block.
- `schema-surface.test.ts` includes the deterministic re-emission test ("frontend/graphql/generated/schema.graphql matches a fresh deterministic emission") — passing ⇒ committed artifact is byte-current with the built schema. 93/93 pass. `sdl-static-assertions.test.ts` twin suite re-anchored (53-op baseline, documented one-time reconciliation). 57/57 pass.
- `frontend/graphql/generated/gql/graphql.ts` unchanged by the diff — verified NOT stale: codegen output is document-driven (`codegen.ts` documents = `frontend/graphql/sharedDocuments/**` + `frontend/views/**/*.documents.ts`); the only `ApplicantProfile`-selecting document (`applicant.documents.ts`) does not select `cooldownState`, and no frontend document references the new mutation/enum, so regeneration is a no-op. Its "seven public profile fields" doc comment remains accurate for that document's selection set.

## Perspective 4 — pentester (standard sweep)

- BFLA/BOLA: admin `$all` scope pre-resolver; defense-in-depth service gate re-asserts active-admin before bounds validation and any DB contact; wire test proves anonymous→UNAUTHORIZED, teacher→FORBIDDEN (generic copy, zero side effects), and a smuggled `actorId` arg dies as GRAPHQL_VALIDATION_FAILED pre-resolver.
- Injection: every value Drizzle-parameterized; guard folds enum members into WHERE; repo suite's static pins prove no interpolation, no status string literals, no `--`, no `.prepare(`.
- Bounds/abuse: `additionalDays` rejected outside [1, 3650] and non-integers (fractional probe proves validation precedes the existence read); 3650-day arithmetic cannot overflow; verified 0/3651/negative/fractional rejections leave zero writes and zero audit rows.
- Oracles: `APPLICANT_NOT_FOUND` vs `APPLICANT_ALREADY_CERTIFIED` distinction exists but the surface is admin-only (acceptable); audit details carry field name + ISO instants + day count only.
- Two-source split observable asserted in three suites (repo/service/wire/journey): `users.suspended/suspendedAt/suspendedPeriodDays` untouched by every cooldown write.

## Special focus — pattern-consistency audit vs the 3 closest siblings

(a) `extendCooldownOnce` vs `transitionToFailed` (guarded-UPDATE discipline): identical tx-required signature (`tx: DBTransaction`, final param, no standalone branch), identical pre-state-folded-into-WHERE predicate shape (enum members via `inArray`/`eq`), identical `RETURNING *` → `row ?? null` miss semantics, identical doc/parameterization/no-prepared-statement commentary. **Parity — no drift.** (The `returning({ id })` + boolean shape of `finalizeOnCertification` is a pre-existing, documented difference for an unconditional terminal write.)

(b) `extendApplicantCooldown` vs the governance finalize pipeline (`setSuspendedAxis` in `user-governance.helpers.ts`): same validation order — `assertActiveActorAdmin` FIRST → id/bounds validation → `withTransaction` → guarded write → audit composed + `AuditService.createAuditLog(…, tx)` in-transaction → in-tx detail/profile re-read with fail-closed null arm → return. Same `getServerTranslations(locale).errorsTranslations` access pattern; same metadata-only audit-details composition; same `outerTx`-as-final-parameter composition seam. The rubric-finalize sibling (`submitRubricEvaluation`) orders shape-validation before its governance gate, but for an ADMIN write the governance pipeline (gate-first) is the matching precedent, and the service doc states the mirroring explicitly. **Parity — no drift.**

(c) Pothos registration + mutation shape vs `ApplicantStatus` + `adminSetUserSuspended`: enum registered ONCE in `shared/enum.pothos.ts` via the same `gqlSchemaBuilder.enumType(Enum, { name })` one-liner with registry-header + member-name wire-convention doc (identical to the `RubricWeaknessArea`/`BroadcastStatus` registration family). Mutation: same side-effect `mutationField` registration, scalar `t.arg`s, INLINED `$all` literal (byte-shape of `adminOnlyAuthScopes`, the discipline the census-drift scanner statically classifies — same as the file's two siblings and `adminStopBroadcast`), `requirePositiveIntId` id guard, session-sourced actor, uncaught DomainError propagation. `requireAdminUser(ctx)` belt (used by `admin-finance`/`subscription-admin`/`admin-stop-broadcast` mutations) is behaviorally identical to the file's inline `ctx.user` narrow — centralized-prelude form, not drift. Cross-domain pothos deep import matches `evaluation.pothos` precedent. **Parity — no defect.**

(d) Tests vs mirror precedents:
- Enum test = byte-shape twin of `applicant-status.enum.test.ts` (same header, same LCG `fuzzStrings`, same 4-tier structure). No drift.
- Repo test mirrors `applicant.repository.transition.test.ts` (runInRollback, entity-setup-only fixtures, direct read-back oracles, Tier-4 static source pins incl. the anti-plan-artifact regex). No drift.
- Wire test mirrors `parent-link.wire.test.ts` fixture strategy (`randomUUID` marker, one committing tx in `beforeAll`, real `login` over the wire, FK-safe `afterAll` hard delete with zero-residue probe); its `withAuditDeleteTriggersSuspended` audit sweep + `countUsersByIds` probe reuse sanctioned `test/helpers/db-cleanup.ts` helpers needed because the suite itself mints audit rows. No drift.
- Journey test uses the sanctioned journey harness (`createJourneyFixtures`/`journeyCleanup`/`journeyPrefix`/`catchJourneyError`, committed `beforeAll` fixtures, publish-seam spy, residue probes). No drift.

**One defect-class drift found** (see Finding 1): the post-commit event's structured-log context omitted the `code` member — unique among 204 sibling `logDomainError` call-sites, which all carry `code` in the ctx — and short of the feature's own observability contract, which pins the log payload as `{ code: "APPLICANT_COOLDOWN_EXTENDED", applicantId, additionalDays, oldExpiry, newExpiry }`. The channel/message choice itself (success event on the domain-log channel) is plan-pinned verbatim (plan.md/tasks.md/specs.md) and is therefore treated as a sanctioned, documented decision — not re-litigated.

---

## Findings

### [LOW] backend/services/teachers/applicant-lifecycle.service.ts:526 — post-commit `APPLICANT_COOLDOWN_EXTENDED` log ctx lacks the machine-readable `code` member — FIXED

Every other `logger.logDomainError` call-site in the backend (204 occurrences across services) passes `code` inside the `DomainErrorContext`; log consumers keying on the standard `code` field found nothing on this event (the code rode only the free-text message). The structured-log payload contract for this event also specifies `{ code: "APPLICANT_COOLDOWN_EXTENDED", applicantId, additionalDays, oldExpiry, newExpiry }`.

Fix applied: added `code: "APPLICANT_COOLDOWN_EXTENDED"` to the ctx object (plus rationale comment); strengthened the service-suite pin (`ctxArg.toMatchObject({ code, applicantId, additionalDays })`).

Re-verification after fix:
- `bun run scripts/health/sub-loop.ts` on both touched files → ✅ duplicates lifecycle pass.
- `backend/services/teachers/applicant-lifecycle.service.test.ts` → 57 pass / 0 fail.
- `backend/graphql/test/admin-applicant-cooldown.wire.test.ts` → 12 pass / 0 fail.
- `test/workflows/teachers/cooldown-state-machine.test.ts` → 12 pass / 0 fail.
- `bun tsgo` → clean.

Remaining findings: 0.

---

## Verification ledger (targeted runs, all green)

| Suite | Result |
| --- | --- |
| `bun tsgo` | clean (2×) |
| `backend/enum/teachers/applicant-cooldown-state.enum.test.ts` | 22 pass |
| `backend/db/test/repo/teachers/applicant.repository.test.ts` | 17 pass |
| `backend/services/teachers/applicant-lifecycle.service.test.ts` | 57 pass (re-run post-fix) |
| `backend/graphql/test/admin-applicant-cooldown.wire.test.ts` | 12 pass (re-run post-fix) |
| `backend/graphql/test/schema-surface.test.ts` | 93 pass |
| `backend/graphql/test/sdl-static-assertions.test.ts` | 57 pass |
| `shared/locale/errors-namespace.parity.test.ts` + `adminUsers-namespace.parity.test.ts` | 67 pass |
| `frontend/views/admin/audit/audit-trail-filters.entityType.test.ts` | 8 pass |
| `test/workflows/admin/audit-completeness.journey.test.ts` | 19 pass |
| `test/workflows/teachers/cooldown-state-machine.test.ts` | 12 pass (re-run post-fix) |
| sub-loop `--lifecycle duplicates` (all changed production + test + i18n files) | ✅ each |

No git commit performed. Working tree carries exactly the two-file fix above.

## Verdict

**R9: 1 finding (1 fixed, 0 remaining)**
