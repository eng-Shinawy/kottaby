# Round R6 — Independent Review Outcome

Scope: `git diff 94160b9..HEAD` (39 files). Special focus: i18n & localization integrity.
Constraints honored: no `bun quality-gate` / `bun oxlint` / `bun lint:type-aware` / `bun biome:check`; verification via `bun tsgo`, per-file `sub-loop --lifecycle duplicates`, targeted `test/scripts/run-test.ts`, `generate:gqlSchema`, `bun run codegen`, git/rg.

## Verdict

**R6: 1 finding (fixed).**

- F1 [Medium] Admin audit-trail entity-type label catalogs missing `applicant` — **FIXED** (6 files, re-verified).

---

## Perspective evidence

### 1. review-types — standard sweep
- `backend/enum/teachers/applicant-cooldown-state.enum.ts`: string enum (`none|active|expired`) + fail-closed guard over a pre-allocated `ReadonlySet`; exported via the `backend/enum/teachers` barrel. Guard unit suite 22/22 (branch/boundary/chaos/security tiers incl. prototype-attack and coercion cases).
- `ApplicantProfileReturnType` gains `readonly cooldownState: ApplicantCooldownState` (type-only import discipline documented in-file); `AdminUserDetailReturnType.applicant` reuses the canonical type (`backend/types/admin/admin-user.types.ts:193`), so the admin mapper producing the new field type-checks — `bun tsgo` clean (run twice, before and after fixes).
- `ApplicantCooldownExtensionAudit`: closed shape — field NAME literal `"cooldown_until"`, ISO `from`/`to`, `additionalDays`; no PII/credential slots.
- `AuditLogWriteContract.entityType: string` accepts `"applicant"`; `details` JSON bounded by the schema's ≤2000-char constraint (fixed-key document, bounded by construction).
- `withTransaction(outerTx, fn)` uses `outerTx.transaction(fn)` — savepoint semantics match the service's doc claims (outerTx is the final optional parameter).

### 2. review-backend — standard sweep
- Repository `extendCooldownOnce`: ONE guarded UPDATE — `WHERE id = $1 AND status IN (pending, in_evaluation, failed)`; `ApplicantStatus` has exactly 4 members, so the guard set is precisely the non-terminal fold (certified `passed` matches zero rows). Fully parameterized (id, expiry, statuses bound); `sql\`now()\`` fragment carries no interpolation; `tx` required (no standalone branch); `RETURNING *` feeds the service's audit composition.
- Service `extendApplicantCooldown`: BFLA gate (`assertActiveActorAdmin` — deleted → blocked → active-suspension precedence) runs BEFORE bounds validation and BEFORE any DB contact; bounds `!Number.isInteger || <1 || >3650` mirror the sibling `SUSPENSION_PERIOD_MIN/MAX_DAYS`; captured-now discipline (one `new Date()` joins base selection); `base = max(stored, now)` can only lengthen; guarded-write miss collapses onto the typed certified rejection; exactly ONE audit row composed from the session actor id inside the same tx; fail-closed post-write profile re-read.
- `user-management.mappers.ts`: `buildApplicantSnapshot` now derives `cooldownActive` from the shared `deriveCooldownState` (removes the pre-existing hardcoded `false` stub) — one derivation boundary shared with the self profile; single captured `now` per snapshot.
- Audit census: `ADMIN_ACTION_CENSUS` entry (`adminExtendApplicantCooldown` → `ApplicantLifecycleService.extendApplicantCooldown`, adjust/applicant, wired) — `audit-completeness.journey.test.ts` 19/19.
- Logging discipline holds: `logDomainError` only on enumerated rejections + the documented post-commit event; no `console.*`; no plan-artifact refs in code.

### 3. review-frontend — generated-SDL integrity
- `bun run generate:gqlSchema` → wrote 61105 bytes; `git diff`/`git status` on `frontend/graphql/generated/schema.graphql` **empty** (byte-identical regeneration).
- Additionally ran `bun run codegen` → zero drift in `frontend/graphql/generated/` (no frontend document selects `cooldownState`/`ApplicantCooldownState` yet; `gql/graphql.ts` history shows it deliberately lags until frontend consumption — same convention as at base). Reverted nothing (nothing dirtied).

### 4. pentester — standard sweep
- BFLA: `$all { authenticated, role: [Admin] }` inlined statically (census-readable); anonymous → `UNAUTHORIZED`, teacher token → `FORBIDDEN` with the generic scope copy and byte-identical row + unchanged audit counts (wire-asserted).
- Identity: audit actor is `requireAdminUser(ctx).id` only; no client-supplied actor surface (a smuggled `actorId` root arg dies `GRAPHQL_VALIDATION_FAILED` pre-resolver — wire-pinned).
- Injection: drizzle parameterized end-to-end; no dynamic SQL. IDOR: applicantId is admin-gated and existence/status-checked in-tx; the guarded predicate re-evaluates status atomically at write time (concurrent-certification collapse onto the typed rejection).
- Disclosure: domain codes are generic; localized copies carry zero identifiers and zero ICU placeholders (parity-pinned); unexpected internals bubble to the masking boundary (DomainError pass-through preserved codes verbatim — verified in `backend/lib/errors/error-masking/`).
- Write confinement: only `cooldown_until` + `updated_at`; `users.suspended` stays `false` (wire-asserted two-source split). DoS bounded (≤3650 days, single-row UPDATE).

### Special focus — i18n & localization integrity
- **(a) en/ar parity + usage path:** `applicantCooldownExtensionInvalid` present in BOTH maps (`shared/locale/{en,ar}/errors/index.ts`), in the `ErrorsLabels` inventory, and pinned in `errors-namespace.parity.test.ts` (50/50). Usage path verified end-to-end: service throw `ValidationError("APPLICANT_COOLDOWN_EXTENSION_INVALID", getServerTranslations(locale).errorsTranslations.applicantCooldownExtensionInvalid)` → DomainError pass-through at the masking boundary → wire test pins `extensions.code` + byte-equal localized message; service test additionally pins ar+en byte-equality (`applicant-lifecycle.service.test.ts:1458-1459`).
- **(b) Arabic copy quality:** "يجب أن تكون أيام تمديد فترة التهدئة بين 1 و3650 يوماً." — formal MSA; "فترة التهدئة" matches the established vocabulary (`ar/adminTeachers`: `cooldown: "فترة التهدئة"`); Western digits + `و`-attachment + "يوماً" tamyiz exactly mirror the same-namespace sibling `suspensionPeriodInvalid` ("بين 1 و3650 يوماً"); no ids; zero ICU placeholders (pinned in both locales).
- **(c) error-code mapping end-to-end:** service throw → GraphQL `extensions.code` → wire pin all verified; `admin-applicant-cooldown.wire.test.ts` 12/12 (bounds denial asserts code + localized copy + zero writes; nonexistent id; smuggled arg; happy-path oracle).
- **(d) other locale files:** repo locales are en/ar only (verified — no third locale dir). Errors type inventory touched. **GAP FOUND (F1 below):** the admin audit-trail entity-type label catalogs were NOT touched although this diff mints the first-ever `entityType: "applicant"` audit rows. Action-type labels needed nothing (`adjust` is a pre-existing `AuditActionType` member with existing `activity.actionAdjust` chips).
- **(e) hardcoded strings:** none user-facing in the new service/repo/mutation paths — all user-visible copy resolves through `getServerTranslations`; logger strings are internal-only per repo discipline.

## Findings

### F1 [Medium] Admin audit-trail entity-type label catalog missing `applicant` — FIXED
This diff mints the FIRST-EVER `entityType: "applicant"` audit rows (`git grep '"applicant"' 94160b9 -- backend` shows no producer at base; `composeCooldownExtensionAudit` is the only minter). But the curated audit-trail vocabulary — `auditTrail.entityTypeLabels` (en+ar), its `AdminUsersLabels` type inventory, the frontend `ENTITY_TYPE_KEY_BY_WIRE` map (`audit-trail-vocabulary.ts`), and the "every entity-type wire value the backend mints" unit test — all lacked `applicant`. Consequence: the new audit rows' entity chip rendered the raw Latin string `applicant` verbatim in BOTH locales (fail-open display), and the quick-pick filter bar offered no applicant chip — a localization-integrity gap introduced by this diff.

Fix (minimal, 6 files):
- `shared/locale/en/adminUsers/index.ts` — `entityTypeLabels.applicant: "Teacher Applicant"` (reuses the file's established en vocabulary, `teacherApplicant`).
- `shared/locale/ar/adminUsers/index.ts` — `applicant: "متقدم للتدريس"` (established ar term "المتقدم للتدريس", indefinite form matching the chip register: مستخدم/معلم/جلسة; Arabic script — no fallthrough).
- `shared/locale/types/adminUsers/index.ts` — `readonly applicant: string;` in the `entityTypeLabels` type with wire-value doc.
- `frontend/views/admin/audit/audit-trail-vocabulary.ts` — `applicant: "applicant"` in `ENTITY_TYPE_KEY_BY_WIRE` (chip localizes + quick-pick filter offered).
- `shared/locale/adminUsers-namespace.parity.test.ts` — pinned inventory 47→48 slots, `entityTypeLabels.applicant` added.
- `frontend/views/admin/audit/audit-trail-filters.entityType.test.ts` — `applicant` added to the backend-sweep `ALL_WIRE_TYPES`; new pin test asserting exact labels in BOTH locales.

## Re-verification after fix
- Per-file sub-loop `--lifecycle duplicates` → ✅ 0 for all 6 modified files.
- `bun tsgo` → clean.
- `shared/locale/adminUsers-namespace.parity.test.ts` 67/67; `frontend/views/admin/audit/audit-trail-filters.entityType.test.ts` 8/8; `shared/locale/server.test.ts` 21/21; `applicant-namespace.parity.test.ts` 35/35.
- `errors-namespace.parity.test.ts` 50/50; enum guard 22/22; service 57/57; repo 17/17; schema-surface 93/93; sdl-static-assertions 57/57.
- Wire `admin-applicant-cooldown.wire.test.ts` 12/12; `audit-completeness.journey.test.ts` 19/19; `cooldown-state-machine.test.ts` 12/12 (re-run post-fix).
- SDL regeneration byte-identical; `bun run codegen` zero drift.

## Environment notes
4GB sandbox honored: heavy quality-gate binaries skipped per constraint; all verification through the allowed per-file/runner paths. No git commit performed (working tree carries exactly the 6 fix files; pre-existing untracked `round-R3-review-outcome.md` untouched and unread per rules).
