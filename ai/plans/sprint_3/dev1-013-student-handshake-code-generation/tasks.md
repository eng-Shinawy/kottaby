# Implementation Tasks: DEV1-013 — Student Handshake Code Generation

> **Plan of record:** `ai/plans/dev1-013-student-handshake-code-generation/`
> **Specs:** `specs.md` REQ-001..REQ-083 (incl. REQ-J1..J5) · **Design:** `plan.md` D1–D13
> **Ticket:** DEV1-013 (Owner: Dev 1 · Sprint 3 · 2 SP) · **Blocked by:** DEV1-001, DEV1-002, DEV2-001, DEV2-002 (all shipped — verify-only)
> **Scope note:** This is a verification-plus-additive ticket. The DEV1-002 generation path is verify-only (zero production modification). Zero schema drift. Zero mutations. Zero side-effect writes.

---

## Non-Negotiable Execution Protocol (Applies to EVERY Task)

1. **Pre-Execution Outcome Knowledge Read** — Before touching any file, read the `outcome/*.md` of every completed task in this plan plus any `outcome/` artifacts from DEPENDENCY tickets (DEV1-001/002, DEV2-001/002). Record what you will reuse vs. add in the task outcome.
2. **Post-Edit Verification** — After editing ANY file, run:
   `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` → MUST exit 0 before proceeding.
3. **Test Execution** — Run every test file via:
   `bun run test/scripts/run-test.ts <test-path>` (per-file; suite runs via `bun test <dir>` where permitted).
4. **Semantic Review Self-Check** — Before marking any task `[x]`, self-review:
   - Atomicity: does each logical operation run inside one transaction boundary with `tx` propagated to every repository call?
   - Config: no hardcoded env values; no module-level mutable state.
   - Dead code: zero unused exports/imports/variables introduced.
   - Layer purity: `shared/` imports NOTHING from `@/backend/**`, `@/frontend/**`, `@/app/**`; server components never call GraphQL; repositories contain zero business rules.
   - Enums (`UserRole`) are **value imports**, never `import type`, never raw strings.
   - i18n: enum-property access only (`t.key`), never `t('key')`; no `next-intl`.
   - Logging: `logger` only; the submitted handshake code is NEVER logged (D11).
5. **Outcome Documentation** — Every task writes `ai/plans/dev1-013-student-handshake-code-generation/outcome/<task-id>-outcome.md` containing: files touched, decisions/mismatches versus plan, verification evidence (commands + exit codes), and residual risks.
6. **Checkbox Tracking** — Flip `[ ]` → `[x]` ONLY when the task's own verification gates pass AND the outcome file exists.

---

## Phase 0: Pre-Implementation Baseline

### - [ ] 0.1 Record Error Baseline & Initialize Deferred-Items Ledger
- Capture and persist to `outcome/phase0-baseline-outcome.md`:
  - `bun tsgo` error count (exact number + first lines for context)
  - `bun run biome:check` finding count
  - `bun run scripts/lint-service.ts --json --id baseline` output (full JSON artifact path recorded)
  - `git status --porcelain` and `git diff --name-only` dirty-worktree snapshot (prove a clean starting tree; if dirty, document and defer remediation with an ❌ ledger entry)
- Create `ai/plans/dev1-013-student-handshake-code-generation/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`, pre-seeded with exactly three non-blocking forward entries:
  - **D1** — Parent page "Send link request" CTA wire-up → owning ticket DEV1-014 (status: forward-note, non-blocking)
  - **D2** — Real per-parent/per-IP rate limiting for the discovery query → owning stream DEV2-002 (status: forward-note, non-blocking; brute-force mitigation rationale recorded per REQ-034)
  - **D3** — Direct-onboarding (B.6-family) code generation reuse via the shared `generateHandshakeCode` service entry point → owning ticket DEV3-019 (status: forward-note, non-blocking)
- _Requirements: REQ-001, REQ-034, REQ-083_

### - [ ] 0.2 Dependency Guard — Verify (Do NOT Rebuild) Existing Artifacts
- Read and confirm each artifact exists with the expected contract; record file paths + line citations in the outcome. **Reading and asserting only — zero modifications:**
  1. `backend/db/schema/students/students.ts` — `handshake_code varchar(50) NOT NULL`, `unique("students_handshake_code_unique")`, `parent_id` nullable FK → `users.id` ON DELETE SET NULL, shared-PK `students.id = users.id`
  2. `backend/db/schema/users/users.ts` — governance columns: `is_deleted`, `is_blocked`, `suspended`, `suspended_at`, `suspended_period_days`
  3. `RegistrationService` / `StudentRepository.createForRegistration` — bounded (≤5) in-transaction `23505`-retry generation emitting `KSB-<8 uppercase hex>` per `docs/auth/user-registration.md` §2 (verify-only per D1)
  4. DEV2-002 scope system: `authenticated` and `role` scopes resolvable; confirm `$all` conjunction behavior documented in `docs/teachers/applicant-lifecycle.md` §3 is still current
  5. `withPageAuth({ roles, redirectTo })` server wrapper exists for `/parent/handshake` guarding
  6. `frontend/providers/apollo/apolloCache.ts` — locate `typePolicies` and the existing embedded-value precedent (`AdminNoteInfo` / `OnlineMeetingInfo`)
  7. Confirm `test/workflows/` DOES NOT exist → task 2.2 must scaffold it
  - [ ] 0.2.SR **Semantic Review**: assert zero modifications were made by this task (`git diff` still equals the 0.1 snapshot)
- **STOP RULE:** If any artifact is missing/broken → record ❌ in `deferred-items.md` with the owning ticket and HALT this plan; never patch a DEV1-001/DEV1-002/DEV2-002-owned file inline.
- _Requirements: REQ-004_

### - [ ] 0.3 Phase-1.5 Plan-Review Gate
- Run the `@plan-review` pass against `specs.md` + `plan.md` before ANY implementation begins; write `outcome/0.3-plan-review-outcome.md` (must PREDATE all implementation outcomes — REQ-083).
- Resolve any review blockers into either plan amendments or ledger entries before opening Phase 1.
- _Requirements: REQ-083_

---

## Phase 1: Shared Constants, Pure Helpers, Canonical Types & i18n (Zero Schema Tasks — REQ-045)

> **No database schema phase exists for this ticket.** `backend/db/schema/` is the sole structural ground truth and is untouched by construction. `git diff backend/db/schema/** backend/db/migration/**` must remain empty end-to-end.

### - [ ] 1.1 Shared Constants — `shared/constants/handshake-code.constants.ts`
- Create `shared/constants/handshake-code.constants.ts` exporting exactly: `HANDSHAKE_CODE_PREFIX = "KSB-"`, `HANDSHAKE_CODE_PATTERN = /^KSB-[0-9A-F]{8}$/`, `isHandshakeCode(value: unknown): value is string`, `normalizeHandshakeCode(value: string)` (trim → toUpperCase).
- Add one barrel line to `shared/constants/index.ts`: `export * from "./handshake-code.constants";`.
- **Layer purity (blocking):** file imports NOTHING. Verify the shared-layer ESLint `no-restricted-imports` ban trivially holds.
- _Requirements: REQ-011, REQ-020, REQ-002_
- [ ] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts shared/constants/handshake-code.constants.ts --lifecycle duplicates` (exit 0); also run against `shared/constants/index.ts` (exit 0)
- [ ] 1.1.TE **Test Engineering**: 4-Tier on the guards — Tier 1: every branch of `isHandshakeCode` (non-string types incl. object/array/undefined, empty string, valid code); Tier 2: boundary lengths (7/8/9 hex chars, prefix variants `KSB`/`KSB-`, leading/trailing whitespace pre/post-normalization); Tier 3: hostile fuzz inputs — `%KSB-ABCD1234` (LIKE wildcard), underscore, backslash, unicode/RTL payloads, emoji, NUL bytes, multi-KB strings; Tier 4: normalization idempotence (`normalize(normalize(x)) === normalize(x)`) and proof that lowercase-of-valid normalizes into acceptance. Run via `bun run test/scripts/run-test.ts <path>`.
- [ ] 1.1.SEC **Security & Tenancy Audit**: confirm the regex is ReDoS-safe (anchored, bounded `{8}`, no nested quantifiers), and that normalization cannot smuggle a second string past validation (validations run strictly AFTER normalization).
- [ ] 1.1.SR **Semantic Review**: constants are the ONLY source of the pattern in the repo (grep for any duplicated `KSB-` regex in new code — zero hits outside this file and the existing DEV1-002 generator which MAY consume the builder only if byte-identical and its locks stay green); pure functions; zero side effects.
- [ ] 1.1.IV **Instruction Verification**: read `shared/AGENTS.md` and any `*.instructions.md` auto-discovered for `shared/constants/`; confirm compliance in the outcome.
- Outcome: `outcome/1.1-handshake-code-constants-outcome.md`.

### - [ ] 1.2 Pure Mask Helper — `shared/lib/mask-full-name.ts`
- Create `shared/lib/mask-full-name.ts` exporting `maskFullName(fullName: string): string` per plan §2.4:
  - Trim; empty-after-trim → fixed placeholder `"***"` (documented constant).
  - Split on `/\s+/u`; each part → first grapheme + `"***"`; parts joined with single spaces.
  - First grapheme via `Intl.Segmenter(undefined/-locale-free, { granularity: "grapheme" })`; fallback to `Array.from(part)[0]` (code-point fallback) when `Segmenter` is unavailable.
  - TOTAL function: never throws, no I/O, no locale/network dependence, deterministic (same input → same mask).
- _Requirements: REQ-017, REQ-054_
- [ ] 1.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts shared/lib/mask-full-name.ts --lifecycle duplicates` (exit 0)
- [ ] 1.2.TE **Test Engineering**: 4-Tier at 100% statement + branch coverage — Tier 1: all branches (empty, single-part, multi-part, Segmenter-present, Segmenter-absent via guarded mock of `Intl.Segmenter`); Tier 2: single-grapheme names (`"ع"` → `"ع***"`), extra/multiple internal whitespace, leading/trailing whitespace; Tier 3: combining-mark sequences (e.g. `é` composed vs decomposed), emoji incl. ZWJ sequences and skin-tone modifiers, RTL Arabic names (`"أحمد محمد"` → `"أ*** م***"`), Arabic with Latin mixing, numbers/symbols as names; Tier 4: determinism property test (100 random fixtures → `mask(x) === mask(x)`), and result never contains the full original string. Run via `bun run test/scripts/run-test.ts <path>`; attach coverage evidence.
- [ ] 1.2.SEC **Security & Tenancy Audit**: prove the mask leaks at most the leading grapheme of each name part (no length-of-remainder signal beyond a fixed cluster); confirm zero throw paths (no oracle via exceptions).
- [ ] 1.2.SR **Semantic Review**: pure/deterministic/no clock/no env; single mask constants in one place; shared-layer purity.
- [ ] 1.2.IV **Instruction Verification**: read `shared/AGENTS.md` and auto-discovered instruction files for `shared/lib/`; confirm compliance.
- Outcome: `outcome/1.2-mask-full-name-outcome.md`.

### - [ ] 1.3 Canonical Types — extend `backend/types/students/student.types.ts`
- Add (additive-only; existing exports unchanged):
  - `HandshakeCodeLookupReturnType` — readonly `{ maskedName: string; linkable: boolean }` (per plan §2.2).
  - `HandshakeDiscoveryRowType` — `Pick<StudentSelectType, "parentId"> & Pick<UserSelectType, "fullName" | "isDeleted" | "isBlocked" | "suspended" | "suspendedAt" | "suspendedPeriodDays">` with `UserSelectType` imported from `@/backend/types` (indexed-access composition only — no re-derived column shapes per the DEV2-003 contract rule).
- Verify `backend/types/students/index.ts` already re-exports `./student.types` (no barrel edit expected; if missing, one-line additive fix + note in outcome).
- FORBIDDEN: local types in Pothos files later; service-layer `.types.ts` files; any new entity types file.
- _Requirements: REQ-003, REQ-015, REQ-019_
- [ ] 1.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/students/student.types.ts --lifecycle duplicates` (exit 0)
- [ ] 1.3.TE **Test Engineering**: type-level proof — a compile-only spec file (or `tsgo` assertion harness per repo convention) that `HandshakeCodeLookupReturnType` contains EXACTLY the two keys (`keyof` equality assertion) so a future additive field fails compile here first.
- [ ] 1.3.SEC **Security & Tenancy Audit**: BOPLA audit — confirm zero id/contact/governance fields on the return type; confirm the discovery row type is service-internal only (never the GraphQL backing type).
- [ ] 1.3.SR **Semantic Review**: composition-via-`Pick` only; readonly immutability on the return type; no enums as types-only imports anywhere in the diff.
- [ ] 1.3.IV **Instruction Verification**: read `backend/types/AGENTS.md` and auto-discovered instruction files; confirm compliance.
- Outcome: `outcome/1.3-canonical-types-outcome.md`.

### - [ ] 1.4 i18n — Errors Namespace Extension + New `handshakeCode` UI Namespace (ar + en)
- **Errors namespace** (`handshakeCode` grouping) — three-file contract edit per `shared/locale/AGENTS.md`:
  - `shared/locale/types/errors/index.ts`: add `handshakeCode: { handshakeCodeInvalid: string; studentHandshakeNotFound: string }` to the errors schema interface.
  - `shared/locale/en/errors/index.ts`: `handshakeCodeInvalid: "Handshake codes look like KSB-XXXXXXXX (8 hexadecimal characters)."`, `studentHandshakeNotFound: "Student record not found."`
  - `shared/locale/ar/errors/index.ts`: natural Arabic equivalents (RTL-correct).
- **New UI namespace `handshakeCode`** (full registration: types + `en` + `ar` + `MessageSchema` entry + namespace-path registration):
  - Student card keys: `yourCodeTitle`, `yourCodeDescription`, `copyCode`, `codeCopied`, `copyFailed`.
  - Parent discovery page keys: `pageTitle`, `pageDescription`, `inputLabel`, `searchAction`, `invalidFormat`, `notFoundTitle`, `notFoundDescription`, `foundTitle`, `canLinkDescription`, `alreadyLinkedTitle`, `alreadyLinkedDescription`.
- Parity is compile-gated via `MessageSchema` — both locales must define every key or `tsgo` fails (expected gate).
- _Requirements: REQ-002, REQ-050, REQ-051_
- [ ] 1.4.QL **Quality Loop**: sub-loop over EVERY touched locale file (types + en + ar, both namespaces) with `--lifecycle duplicates` (each exit 0); run `bun tsgo` — zero NEW errors vs the 0.1 baseline.
- [ ] 1.4.TE **Test Engineering**: locale-parity assertions per the shared/locale test conventions (every ar key exists for every en key; property-access shape matches the `Translation` enum registration).
- [ ] 1.4.SEC **Security & Tenancy Audit**: audit strings for information leakage — error copy must NOT reveal whether a code exists; `invalidFormat` copy must not enumerate valid codes; Arabic strings reviewed for the same rule.
- [ ] 1.4.SR **Semantic Review**: zero hardcoded user-facing strings outside locale files going forward (grep the diff); no `next-intl`; no `getBackendTranslations`; no `shared/messages/`.
- [ ] 1.4.IV **Instruction Verification**: read `shared/locale/AGENTS.md` and auto-discovered instruction files; confirm the namespace-registration checklist is fully satisfied.
- Outcome: `outcome/1.4-i18n-namespaces-outcome.md`.

---

## Phase 2: Test Locks, Journey Harness, Repositories & Backend Services

### - [ ] 2.1 Permanent Generation & Constraint Lock Tests (TEST-FIRST; verify-only production path)
- **Test files** (inside the sanctioned logic/db test tree, e.g. `backend/db/test/...` + logic suite per repo conventions — follow `backend/db/test/AGENTS.md`):
  - **Format lock (REQ-010):** N=50 student fixtures created via `entity-setup.ts` (real `RegistrationService` path where the helper supports it; otherwise registered students backstopped by direct `createForRegistration`) — assert EVERY `handshakeCode` matches `HANDSHAKE_CODE_PATTERN`, is non-null, and row defaults are exact.
  - **Uniqueness lock (REQ-012):** forced duplicate insert (same code on a second students row) inside `runInRollback` → `expectRepoError` asserting the TRANSLATED-message substring of the unique-constraint violation (never raw keys).
  - **NOT NULL lock (REQ-012):** insert with `handshakeCode: null` → `expectRepoError` on the not-null constraint.
  - **Rollback purity (REQ-040):** forced child-insert failure during registration fixture → assert ZERO residual `users`/`students` rows inside the same rollback scope.
  - **Collision path (REQ-041):** two forced-colliding direct inserts (or the documented injection seam of the existing retry — agent's choice that DOES NOT modify production semantics) → exactly one write wins; loser surfaces the translated `23505` path; verify the existing bounded-retry loop absorbs the collision and still produces a valid-format code.
  - **Immutability scan (REQ-013):** static-assertion test — grep-based assertion that no write statement targets `handshakeCode` outside the registration insert path (the retry's repeated inserts are creation, not mutation).
- ALL tests inside `runInRollback`; every repository/Drizzle call receives `tx` in the correct param position; entities ONLY via `entity-setup.ts` (never seed data); NEVER `expect(...).rejects.toThrow()` inside `runInRollback`.
- _Requirements: REQ-010, REQ-012, REQ-013, REQ-040, REQ-041, REQ-071, REQ-072_
- [ ] 2.1.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on every new test file (exit 0)
- [ ] 2.1.TE **Test Engineering**: execute each file via `bun run test/scripts/run-test.ts <path>`; all green WITHOUT any production-code change (this is the D1 verification promise — if ANY lock fails against the existing implementation, STOP: record ❌ in `deferred-items.md` citing the defective DEV1-002/DEV1-001 surface and halt dependent tasks).
- [ ] 2.1.SEC **Security & Tenancy Audit**: forced-duplicate tests must demonstrate constraint-level (not app-level) enforcement — i.e. enforcement survives direct repository writes that bypass service guards.
- [ ] 2.1.SR **Semantic Review**: no test monkey-patches production modules; collision fixture uses only documented injection seams or direct constrained inserts; zero `console.*`.
- [ ] 2.1.IV **Instruction Verification**: read `backend/db/test/AGENTS.md` (incl. rule 15 — fixtures not seeds) and auto-discovered instruction files; confirm compliance.
- Outcome: `outcome/2.1-generation-lock-tests-outcome.md`.

### - [ ] 2.2 Scaffold `test/workflows/` + Write Handshake-Discovery Journey Test (TEST-FIRST — REQ-077)
- **Scaffold (mandatory — the layer does not exist per 0.2):**
  - `test/workflows/AGENTS.md` — journey rules per Architectural Invariant 10: sequential actor-attributed steps calling REAL services against the REAL test DB; fixtures COMMITTED in `beforeAll` and HARD-DELETED in `afterAll` with tracked IDs; `runInRollback` FORBIDDEN (services spawn their own transactions); permissions resolve honestly via real role membership — NEVER monkey-patched; side effects (none exist in this ticket — REQ-023) asserted absent; spies configured for notification dispatch should any future step emit one (NEVER real email/SMS/push).
  - `test/workflows/helpers/journey-fixtures.ts` — cast builders: `registerStudentActor()` (real `RegistrationService.registerUser` → returns `{ userId, handshakeCode }`), `registerParentActor()`, `linkStudentToParentFixture(studentId, parentUserId)` (direct repository write emulating DEV1-014's future mutation), `setGovernanceFixture(userId, { isDeleted | isBlocked | suspended... })`, and a tracked-ID registry powering the `afterAll` hard-delete teardown.
- **Journey test** — `test/workflows/parents/handshake-discovery.test.ts` executing specs §2.9 steps 1→8 in order, calling `RegistrationService` / `StudentHandshakeService` with `actorUserId`-derived ids (service layer only; GraphQL role-matrix denials live in the REQ-074 tier, cross-referenced not duplicated):
  1. *System*: register student → assert `handshakeCode` matches `HANDSHAKE_CODE_PATTERN`, unique, non-null (REQ-J1 precondition).
  2. *Student*: `getMyHandshakeCode(studentUserId)` returns own code verbatim. **Step 2b denials**: documented in-test via scope-layer cross-reference (GraphQL tier owns `FORBIDDEN`/`UNAUTHORIZED` assertions — journey asserts the service rejects a null/foreign-identity call shape honestly where applicable).
  3. *Parent*: `findStudentByHandshakeCode(code)` → `{ maskedName, linkable: true }`; assert `maskedName ≠ fullName` and the payload object has EXACTLY two keys (REJ-J1).
  4. *Parent*: lowercase variant of the real code RESOLVES identically; structurally invalid input rejects with `ValidationError`; valid-format-but-missing code returns `null` (no throw) (observer outcomes per REQ-J-first-class states).
  5. *Fixture (DEV1-014 emulation)*: `linkStudentToParentFixture(...)` → *Second Parent*: same code → `linkable: false`; assert payload contains NO parent identity, NO ids (REQ-J2).
  6. *Fixture*: three governance variants (isDeleted / isBlocked / active suspension) → *Parent* re-searches SAME code each time → `null`, byte-identical outcome to a nonexistent code (REQ-J3).
  7. *Record-only step*: deleted/blocked callers are denied at the DEV2-002 context boundary (upstream fail-closed) — asserted as a documented comment + cross-reference, not re-tested here.
  8. *Teardown*: every tracked fixture id hard-deleted; assert residue probe queries return empty.
- Actors per the specs §2.9 actor table: Student (Yusuf), Parent (Fatima), Second Parent, Teacher/Admin/Supervisor/Anonymous (denied; GraphQL tier), System (registration service).
- _Requirements: REQ-077, REQ-J1, REQ-J2, REQ-J3, REQ-J4, REQ-J5, REQ-010, REQ-016, REQ-018, REQ-019, REQ-020, REQ-021, REQ-023_
- [ ] 2.2.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on `test/workflows/AGENTS.md`, `test/workflows/helpers/journey-fixtures.ts`, `test/workflows/parents/handshake-discovery.test.ts` (each exit 0)
- [ ] 2.2.TE **Test Engineering**: run via `bun run test/scripts/run-test.ts test/workflows/parents/handshake-discovery.test.ts`; THEN `bun test test/workflows`. **Expected state immediately after this task:** the journey RED-steps fail because `StudentHandshakeService` does not yet exist (test-first discipline) — the test file MUST compile and the RED steps must fail only on the missing service surface, never on fixture/harness defects. Harness itself must pass its own smoke checks (registration fixture + teardown) using existing services.
- [ ] 2.2.SEC **Security & Tenancy Audit**: fixtures grant NO elevated permissions (real roles only); teardown provably removes all rows (tracked-id list asserted empty on lookup); no real notification channels reachable.
- [ ] 2.2.SR **Semantic Review**: no `runInRollback` anywhere under `test/workflows/` (grep gate); fixture ids tracked, never hardcoded; journey steps carry actor attribution comments.
- [ ] 2.2.IV **Instruction Verification**: validate the new `test/workflows/AGENTS.md` against Architectural Invariant 10 and auto-discovered instruction files.
- Outcome: `outcome/2.2-journey-harness-outcome.md`.

### - [ ] 2.3 Repository — Additive Read Methods on `backend/db/repo/students/student.repository.ts`
- Add exactly two methods (existing methods untouched):
  - `findHandshakeCodeByStudentId(studentId: number, tx?: DBTransaction): Promise<string | null>` — single-column equality read via the `queryDb(tx)` Neon-HTTP-eligible pattern.
  - `findDiscoveryByHandshakeCode(code: string, tx?: DBTransaction): Promise<HandshakeDiscoveryRowType | null>` — students⋈users JOIN on shared PK selecting EXACTLY the `Pick`'d columns; parameterized equality `eq(students.handshakeCode, code)`; NO LIKE/ILIKE, NO `sql` templates (zero inline-comment/parameter-binding hazard), NO `inArray`, NO prepared-statement misuse.
- Repos contain zero business rules, zero log strings, zero i18n imports; `tx` is optional-last and propagated into every Drizzle call.
- Imports: `DBTransaction` and `HandshakeDiscoveryRowType` from `@/backend/types` (canonical locations only).
- _Requirements: REQ-014, REQ-035, REQ-042, REQ-043_
- [ ] 2.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/students/student.repository.ts --lifecycle duplicates` (exit 0)
- [ ] 2.3.TE **Test Engineering**: 4-Tier DB tests (new spec file per repo conventions) — Tier 1: both methods return expected rows/values for `entity-setup.ts` fixtures incl. the JOIN returning exactly the picked columns (no extra columns — column-name assertion on the returned object); Tier 2: `tx`-provided vs default-executor paths both work (call each method with `tx` from `runInRollback` and without); Tier 3: lookups for nonexistent ids/codes return `null`; unicode/garbage codes pass through the parameterized path harmlessly (validation lives in service — repo must simply return null); Tier 4: tx-rollback verified — fixtures written inside `runInRollback` are invisible after rollback. Every test receives `tx` in the correct param position. Run via `bun run test/scripts/run-test.ts <path>`.
- [ ] 2.3.SEC **Security & Tenancy Audit**: BOLA — no method accepts a caller-controlled owner id that isn't scoped by the service above (documented); injection surface — prove the only predicate is the parameterized equality (grep the diff for `sql\`` — zero hits); BOPLA — selection is a fixed column list, never spread-driven.
- [ ] 2.3.SR **Semantic Review**: additive-only diff; import ordering per biome; no re-exports, no barrels touched unless the repo subdirectory convention requires it (verify, don't assume).
- [ ] 2.3.IV **Instruction Verification**: read `backend/db/repo/AGENTS.md` (queryDb pattern, optional-last `tx`, no-prepared-statement note for single-scalar equality) and auto-discovered instruction files; confirm compliance.
- Outcome: `outcome/2.3-student-repository-lookups-outcome.md`.

### - [ ] 2.4 Service — `backend/services/students/student-handshake.service.ts` + Governance Helper
- Create `backend/services/students/student-handshake.helpers.ts` (runtime file — NOT `.types.ts`):
  - `isGovernanceExcludedFromDiscovery(governance, now: Date): boolean` per plan §4.1 — fail-closed: `isDeleted || isBlocked` → excluded; `!suspended` → included; suspended with missing `suspendedAt`/`suspendedPeriodDays` → excluded (fail-closed); active-window math `suspendedAt + periodDays > now` → excluded.
- Create `backend/services/students/student-handshake.service.ts`:
  - `getMyHandshakeCode(studentUserId: number, locale: string): Promise<string>` — identity is ONLY the argument (resolver passes `ctx.user.id`); repo read; null row → `NotFoundError("STUDENT", getServerTranslations(locale, "errors").errors.handshakeCode? — per negotiated errors-shape)`. Use the entity-name form (`NotFoundError("STUDENT", msg)`) → `extensions.code = STUDENT_NOT_FOUND` with message sourced from `studentHandshakeNotFound` via `getServerTranslations(locale, "errors")` (property access only).
  - `findStudentByHandshakeCode(code: string, locale: string, tx?: DBTransaction): Promise<HandshakeCodeLookupReturnType | null>` — strictly in this order: (1) `normalizeHandshakeCode(code)` → `isHandshakeCode` guard; failure → `ValidationError` with `handshakeCodeInvalid` message, thrown **BEFORE any DB read**; (2) repo discovery read with `tx` propagated when present; (3) null row → return `null`; (4) `isGovernanceExcludedFromDiscovery(row, new Date())` → return `null` (indistinguishable from nonexistent); (5) return `{ maskedName: maskFullName(fullName), linkable: parentId === null }`.
- Logging (D11/REQ-052): expected rejections via `logger.logDomainError` with bounded context (`{ code: <extensions.code>, entity: "students", entityId when known }`); the SUBMITTED code string is NEVER logged (stricter than spec's allowed post-validation logging); unexpected failures via `logger.error`; zero `console.*`; ZERO writes/audit/notification rows (REQ-023); silent happy path (REQ-053).
- _Requirements: REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-023, REQ-030, REQ-043, REQ-050, REQ-052, REQ-053, REQ-054_
- [ ] 2.4.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on BOTH service + helper files (exit 0)
- [ ] 2.4.TE **Test Engineering** (service spec file, fixtures-only): 4-Tier —
  - Tier 1: `getMyHandshakeCode` happy path + missing-row `NotFoundError`; `findStudentByHandshakeCode` valid hit → `{maskedName, linkable: true}`; already-linked fixture (`parentId` set via entity-setup) → `linkable: false` and NO `parentId` key on the result; nonexistent code → `null`.
  - Tier 2: normalization — `ksb-abcd1234` (lowercase of an existing uppercase code) resolves; surrounding-whitespace variants resolve; suspension boundary fixtures (ends-in-past → VISIBLE; ends-exactly-now vs `now` boundary → excluded per spec; missing `suspendedAt`/`suspendedPeriodDays` with `suspended=true` → excluded fail-closed).
  - Tier 3: malformed fuzz rejected PRE-DB — `%KSB-ABCD1234`, `_`, `\`, unicode payloads, RTL strings, empty, whitespace-only, over/under-length (assert repo method spy received ZERO calls); three governance fixtures (`isDeleted`, `isBlocked`, active suspension) each → `null`, byte-identical to the nonexistent-code result (deep-equal assertion).
  - Tier 4: extensions-code mapping assertions (`VALIDATION`, `STUDENT_NOT_FOUND`); log assertions — domain-error log contains NO raw submitted code; no writes observed during reads (audit/notification tables untouched, verified by count probes).
  - All DB-coupled tests inside `runInRollback` with `tx` plumbing; entities via `entity-setup.ts`; failures via `expectRepoError` where constraint-level. Run via `bun run test/scripts/run-test.ts <path>`. **100% statement + branch coverage** on both new modules; attach coverage evidence (REQ-070).
- [ ] 2.4.SEC **Security & Tenancy Audit**:
  - BOLA/IDOR: `getMyHandshakeCode` has zero caller-supplied identity surface; discovery treats the code as the out-of-band capability with governance collapse (document the oracle-hygiene rationale).
  - BOPLA: closed readonly return type; grep-verified zero `{ ...input }` spreads anywhere in the ticket diff.
  - BFLA: no permission logic in service (scopes gate at GraphQL); governance reads never mutate.
  - Injection: pre-DB regex gate + parameterized equality only; `escapeLikeWildcards` documented as NOT APPLICABLE (no LIKE/ILIKE exists) — record the affirmation in the outcome per REQ-022.
- [ ] 2.4.SR **Semantic Review**: validation strictly precedes persistence reads (asserted by spy test); pure predicate imported from helpers; no module-level mutable state; no catch-and-swallow; DomainError subclasses only (grep: zero `new Error(`).
- [ ] 2.4.IV **Instruction Verification**: read `backend/services/AGENTS.md` and auto-discovered instruction files; confirm compliance.
- Re-run the 2.2 journey test → all journey steps now GREEN.
- Outcome: `outcome/2.4-handshake-service-outcome.md`.

### - [ ] 2.M Mid-Point Review Gate
- Freeze and audit before GraphQL wiring:
  - Re-run ALL Phase 1–2 test files; capture full green evidence.
  - Confirm the 2.2 journey suite is fully GREEN (8 steps).
  - `git diff backend/db/schema/** backend/db/migration/**` MUST be empty (REQ-045) — paste the literal command + empty output into the outcome.
  - `bun tsgo` / `biome:check` counts ≤ the 0.1 baseline (zero NEW findings).
  - Coverage report: 100% stmt/branch on `handshake-code.constants.ts`, `mask-full-name.ts`, `student-handshake.service.ts`, `student-handshake.helpers.ts` (REQ-070).
  - Ledger check: no new ❌/⚠️ entries beyond D1–D3; resolve or downgrade any discovered blockers before Phase 3.
- Write `outcome/2.M-midpoint-review-outcome.md`. **Do not proceed to Phase 3 on any red gate.**
- _Requirements: REQ-045, REQ-070, REQ-076, REQ-077_

---

## Phase 3: GraphQL Resolvers & API Surface

### - [ ] 3.1 Pothos Object Type + Query Module
- Create `backend/graphql/pothos/students/handshake-code.pothos.ts` (+ sub-directory barrel if absent): `gqlSchemaBuilder.objectRef<HandshakeCodeLookupReturnType>("HandshakeCodeLookup")` exposing ONLY `maskedName: t.exposeString(...)` and `linkable: t.exposeBoolean(...)`. **NO `id` field BY DESIGN** (REQ-019/D7); backing type imported from `@/backend/types` (never a local type).
- Create `backend/graphql/query/students/handshake-code.query.ts` (+ barrel wiring per `docs/graphql/api-gateway-and-routing.md` §8 side-effect registration):
  - `myHandshakeCode: String!` — `authScopes: { $all: { authenticated: true, role: [UserRole.Student] } }`; thin resolver: `StudentHandshakeService.getMyHandshakeCode(ctx.user.id, ctx.locale)`.
  - `findStudentByHandshakeCode(code: String!): HandshakeCodeLookup` — `authScopes: { $all: { authenticated: true, role: [UserRole.Parent] } }`; thin resolver delegating with `args.code` + `ctx.locale`.
- **D8 mandatory:** the `$all` conjunction is required — anonymous → `UNAUTHORIZED` (401 semantics); authenticated wrong-role (INCLUDING the sibling role on each query, plus teacher/supervisor/all admin roles) → `FORBIDDEN` (403 semantics), exactly per `docs/teachers/applicant-lifecycle.md` §3 and REQ-031.
- Resolvers: top-level STATIC imports only (Bun ESM rule — no `await import`); `UserRole` as a VALUE import from `@/backend/enum/users/user-role.enum`; no try/catch swallowing (DomainErrors propagate to the boundary finalizer); no localization via `ctx.t` needed for service-internal errors (service already localizes via `getServerTranslations`) — `ctx.t("<namespace>")` used only if a resolver-local message ever becomes necessary.
- NO mutations; NO existing operation modified; public-operation allowlist untouched.
- _Requirements: REQ-030, REQ-031, REQ-050, REQ-060, REQ-061_
- [ ] 3.1.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on every new/edited graphql file (exit 0)
- [ ] 3.1.TE **Test Engineering**: schema-shape assertions live in 3.3's integration tier; here add unit assertions that both fields carry the documented scopes (builder-introspection test per existing graphql test conventions).
- [ ] 3.1.SEC **Security & Tenancy Audit**: independent re-derivation of the permission matrix (plan §3.4) from the code — verify `$all` semantics produce 401-for-anon and 403-for-wrong-role (not inverted/mixed); verify NO admin/supervisor bypass exists; confirm zero client-controllable fields beyond `code`.
- [ ] 3.1.SR **Semantic Review**: thin resolvers only (delegate + locale propagation); no i18n keys hardcoded; no types defined in resolver files; barrel registrations complete.
- [ ] 3.1.IV **Instruction Verification**: read `backend/graphql/AGENTS.md`, `backend/graphql/query/` conventions, `docs/graphql/api-gateway-and-routing.md`, and auto-discovered instruction files; confirm compliance.
- Outcome: `outcome/3.1-graphql-surface-outcome.md`.

### - [ ] 3.2 Codegen Sync (Same Change Set)
- Run `bun run generate:gqlSchema && bun codegen`; commit ALL generated artifacts IN THIS TASK's change set.
- Diff discipline: the schema/typed-document diff contains ONLY this ticket's additions (two queries + `HandshakeCodeLookup`); any unrelated drift → investigate before proceeding (do not absorb foreign diffs silently).
- _Requirements: REQ-062_
- [ ] 3.2.QL **Quality Loop**: sub-loop on generated artifacts where the tooling permits (skip with justification if the health tooling excludes generated paths — record the decision)
- [ ] 3.2.SR **Semantic Review**: diff audit (paste relevant hunks into the outcome); generated types referenced only from `graphql.ts`/generated roots later.
- [ ] 3.2.IV **Instruction Verification**: confirm with `frontend/graphql/AGENTS.md` + backend graphql conventions that artifact placement matches expectations.
- Outcome: `outcome/3.2-codegen-sync-outcome.md`.

### - [ ] 3.3 GraphQL Integration Test Matrix
- New integration spec via `setupTestServerLifecycle` + `testClient` (domain-consistent location per existing integration test conventions):
  - **Full REQ-031/065 role matrix on BOTH queries** (one parameterized table test): anonymous → `UNAUTHORIZED`; student/parent happy paths; EVERY wrong role (incl. parent-on-`myHandshakeCode`, student-on-`findStudentByHandshakeCode`, teacher, supervisor, super-admin) → `FORBIDDEN`.
  - **Happy-path payload contract:** response object has EXACTLY `{ maskedName, linkable }`; a **forbidden-key scan** asserts absence of `id`, `studentId`, `userId`, `email`, `phone`, `parentId`, `isDeleted`, `isBlocked`, `suspended*` on the payload (REQ-019/033).
  - **Self-identity (REQ-030):** two student fixtures — student B NEVER receives student A's code through `myHandshakeCode`.
  - **Failure cells:** malformed code → `extensions.code = VALIDATION`; valid-but-missing → `null` (no error field); student without a students row (defect fixture) → `STUDENT_NOT_FOUND`; assertions via `CombinedGraphQLErrors`/`expectMutationError`-class helpers per the error-handling contract; NEVER HTTP-status assertions.
  - **Locale propagation:** error messages render in the requested locale (en + ar) for `VALIDATION`/`STUDENT_NOT_FOUND`.
- _Requirements: REQ-016, REQ-019, REQ-031, REQ-050, REQ-051, REQ-060, REQ-074_
- [ ] 3.3.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on the integration spec file (exit 0)
- [ ] 3.3.TE **Test Engineering**: 4-Tier mapping — Tier 1 (every matrix cell), Tier 2 (boundary: suspended-window fixture at discovery time, lowercase-normalized lookup over the wire), Tier 3 (fuzzed `code` inputs incl. `%`, unicode, oversized strings → all `VALIDATION`; null-payload nullability), Tier 4 (authorization: token substitution — re-signed tokens for wrong roles; prove scope evaluation precedes service execution via a service-spy assertion of zero calls on denied cells). Run via `bun run test/scripts/run-test.ts <path>`.
- [ ] 3.3.SEC **Security & Tenancy Audit**: prove pre-resolver scope evaluation (denied calls never execute the service — spy assertion); prove governance-collapsed fixtures return `null` over the IDENTICAL channel as nonexistent codes (response shape equality for REQ-J3's network twin); confirm no timing/difference hints are asserted-away at this tier.
- [ ] 3.3.SR **Semantic Review**: zero hardcoded expectation strings (expectations read from the locale contract/preload helpers); fixtures via sanctioned builders; no test-only code added under `backend/graphql/`.
- [ ] 3.3.IV **Instruction Verification**: read `docs/graphql/error-handling-contract.md`, `docs/graphql/domain-error-extensions-code.md`, and auto-discovered graphql-test instruction files; confirm compliance.
- Outcome: `outcome/3.3-graphql-integration-matrix-outcome.md`.

---

## Phase 4: Frontend — Documents, Cache, Views & Pages

### - [ ] 4.1 GraphQL Documents + Apollo Cache Registration + Embedded-Types List
- Create `frontend/graphql/sharedDocuments/students/handshake-code.documents.ts`:
  - `myHandshakeCodeQueryDocument` (`query MyHandshakeCode`) and `findStudentByHandshakeCodeQueryDocument` (`query FindStudentByHandshakeCode($code: String!)`) — `gql` + `TypedDocumentNode<…>` imported from `@apollo/client` (NEVER `/core`); types exclusively from the generated `graphql.ts`; NEITHER document selects `id` on `HandshakeCodeLookup`.
  - Register through the `students` sub-directory barrel (`frontend/graphql/sharedDocuments/students/index.ts`) per `frontend/graphql/sharedDocuments/AGENTS.md`.
- Edit `frontend/providers/apollo/apolloCache.ts`: add `HandshakeCodeLookup: { keyFields: false }` to `typePolicies` (follows `AdminNoteInfo`/`OnlineMeetingInfo` precedent; eliminates the normalization warning structurally).
- Add the embedded-types list entry in `frontend/graphql/AGENTS.md` (rule-only one-liner — code edits here, full narrative in Phase 7).
- _Requirements: REQ-061, REQ-063_
- [ ] 4.1.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on every touched frontend graphql/provider file (exit 0)
- [ ] 4.1.TE **Test Engineering**: document-shape tests (assert both documents omit `id`; assert cache `typePolicies` contains `HandshakeCodeLookup.keyFields === false` via a cache-construction unit test); Apollo MockedProvider round-trip proves no normalization warning is emitted for a lookup result.
- [ ] 4.1.SEC **Security & Tenancy Audit**: documents must not accidentally request extra fields; embedded `keyFields:false` cannot leak identity-derived cache keys (audit confirms zero id-based keying).
- [ ] 4.1.SR **Semantic Review**: no `useLazyQuery` anywhere (grep gate); hooks imported only from `@apollo/client/react`; barrel exports additive.
- [ ] 4.1.IV **Instruction Verification**: read `frontend/graphql/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md`, and auto-discovered instruction files; confirm compliance.
- Outcome: `outcome/4.1-shared-documents-outcome.md`.

### - [ ] 4.2 Student "Your Handshake Code" Card (additive, existing profile surface)
- Create the card component (e.g. `frontend/components/students/HandshakeCodeCard.tsx` or the co-located view folder matching the existing profile surface's conventions) and MOUNT it additively into the existing student profile/container (NO new student route per D12):
  - `useQuery(myHandshakeCodeQueryDocument)` (hooks from `@apollo/client/react`); loading → skeleton (title + code line + action) per existing skeleton conventions; error → `extensions.code`-branched handling (`FORBIDDEN` → existing `PermissionDeniedFallback`-style pattern; unexpected → localized error state).
  - Code presentation: localized `yourCodeTitle`/`yourCodeDescription`; code chip rendered with `direction: ltr` + `unicodeBidi: isolate` inside `sx` so it reads correctly inside RTL Arabic layouts; fixed-pitch-safe treatment.
  - Copy affordance: `navigator.clipboard.writeText` with try/catch fallback + localized `codeCopied` confirmation and `copyFailed` fallback notice (`aria-live` polite region per accessibility conventions).
  - ALL labels via `useAppTranslation(Translation.<HandshakeCodeNs>)` with enum-property access (`t.yourCodeTitle`), NEVER `t('...')`.
  - MUI v9 discipline: ALL styling in `sx`; colors via `sx={(theme) => ({...theme.palette...})}` theme-callback; `*Outlined` icons ONLY (e.g. `ContentCopyOutlined`); zero direct style props.
- _Requirements: REQ-014, REQ-064, REQ-065, REQ-066, REQ-067_
- [ ] 4.2.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on the new component + the modified container (exit 0 each)
- [ ] 4.2.TE **Unit / Component Tests**: Happy DOM + Apollo MockedProvider via the sanctioned component runner (`test/ui` conventions): renders the fixture code from a mocked query; translation-driven assertions via `readTranslation(handle, locale)` + `TestWrapper locale` + `translation-preload.ts` (ZERO hardcoded strings); copy-click test (clipboard mocked) → localized confirmation state transition; failure branch (clipboard reject) → `copyFailed`; loading skeleton; `STUDENT_NOT_FOUND`/error branch; BOTH locales (ar + en) exercised; run via `bun run test/scripts/run-test.ts <path>`.
- [ ] 4.2.BF **Agent-Browser Functional Self-Loop**:
  - Launch the dev server; connect via agent-browser (Playwright).
  - Log in as a student fixture → navigate to the profile surface → assert the card renders the REAL handshake code returned by GraphQL (network inspection: `MyHandshakeCode` operation observed once).
  - Click copy → assert clipboard contains the exact code; assert the localized "copied" confirmation appears in en, then repeat the flow in the `ar` locale.
  - Negative path: force the query to fail (route mock/block) → assert the localized error surface renders and no unhandled console errors appear.
  - Iterative self-loop: any functional defect → patch → re-run flow until clean.
- [ ] 4.2.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
  - Capture high-resolution screenshots of the card-in-surface at Desktop 1440x900, Tablet 768x1024, Mobile 375x812 × locales en (LTR) + ar (RTL), light + dark themes.
  - Analyze each capture: code chip stays LTR/`unicode-bidi:isolate` inside RTL layout; no text truncation/overflow at 375px; spacing rhythm consistent with the existing profile cards; theme-palette colors only (screenshot pixel-sampling sanity check around borders/backgrounds); skeleton parity with sibling cards.
  - Iterative self-loop: inspect screenshot → identify defect → patch `sx` tokens → re-capture → repeat until visually polished; attach final capture set to the outcome.
- [ ] 4.2.SR **Semantic Review**: zero direct style props (grep for `fontWeight=|mb=|mt=|p=|display=` — zero hits); no hardcoded colors/strings; `*Outlined` icons only; no `FormEvent` anywhere; identity is fully server-derived (component carries no student-id props).
- [ ] 4.2.IV **Instruction Verification**: read `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/components/ui/AGENTS.md`, any `frontend.instructions.md` / `mobile-desktop.instructions.md`; confirm compliance.
- Outcome: `outcome/4.2-student-handshake-card-outcome.md`.

### - [ ] 4.3 Parent Discovery Page — `/parent/handshake` + Navigation Item
- **Route:** create `app/(dashboard)/parent/handshake/page.tsx` (Server Component) — `withPageAuth({ roles: [UserRole.Parent], redirectTo: "/parent/handshake" })` (anonymous → `/login?redirect=/parent/handshake`; wrong role → `/dashboard`); `await getTranslations(locale)` (single-arg) for shell labels passed as props to the client container.
- **Client container** `frontend/views/parent/handshake/HandshakeDiscoveryContainer.tsx`:
  - Local state: `codeInput` + `validatedCode` (derived via `normalizeHandshakeCode` + `isHandshakeCode` from the SHARED constants module — frontend consumes the same canonical gate).
  - `useQuery(findStudentByHandshakeCodeQueryDocument, { variables: { code: validatedCode }, skip: !validatedCode })` — NO `useLazyQuery` anywhere (REQ-063).
  - `HandshakeCodeSearchForm`: submit handler typed `React.SubmitEvent`/`React.SyntheticEvent<HTMLFormElement>` (NEVER `FormEvent`); field carries `aria-invalid={!!formatError}`; on submit → validate; invalid → inline helper `invalidFormat` (NO network call — the skip gate must prevent it); valid → set `validatedCode`.
  - Outcome states (exactly per plan §5.5): idle → page description only; searching → result-region skeleton; `null` → inline `notFoundTitle`/`notFoundDescription` (deliberately NOT error styling); found + `linkable` → masked-name card + `canLinkDescription` (**NO "Send link request" CTA — D1/DEV1-014**; do not even render a disabled placeholder button); found + `!linkable` → masked-name card + `alreadyLinkedTitle`/`alreadyLinkedDescription` (`linkable`-driven copy).
  - GraphQL failures → `extensions.code` branching: `VALIDATION` (server-side re-judgment) → inline input error; `FORBIDDEN` → existing `PermissionDeniedFallback`-pattern surface; unexpected → localized generic error. Never branch on HTTP status.
- **Navigation:** add ONE parent-nav item "Link my child" (translated from the `handshakeCode` namespace) after the parent's existing dashboard entries, icon `LinkOutlined`; mobile bottom nav unchanged (verify the parent's nav contract first — default: untouched).
- MUI v9 discipline: `sx`-only styling; theme-callback colors; logical properties (`marginInlineStart/End`, `text-align: start`) for full RTL mirroring; masked Arabic names render naturally RTL; ≥44px tap targets on mobile.
- _Requirements: REQ-015, REQ-016, REQ-017, REQ-018, REQ-020, REQ-063, REQ-064, REQ-065, REQ-066, REQ-067_
- [ ] 4.3.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on `page.tsx`, the container, form/result components, and the nav file (exit 0 each)
- [ ] 4.3.TE **Unit / Component Tests** (Happy DOM + Apollo MockedProvider, sanctioned runner; BOTH locales):
  - Invalid input submit → inline `invalidFormat` rendered + **global fetch/Apollo-mock assertion of ZERO network operations** (skip-gate proof).
  - Lowercase input of a valid code → query fires with the NORMALIZED (uppercase) variable → masked card renders.
  - `null` result → not-found inline state, asserted NOT to carry error styling (class/ARIA assertion).
  - Found + `linkable: true` → can-link copy; found + `linkable: false` → already-linked copy; BOTH assert no ids/contacts rendered and NO CTA element present (D1).
  - `VALIDATION` GraphQL error from server → inline input error; `FORBIDDEN` error → deny surface.
  - SSR guard tests: anonymous → `/login?redirect=/parent/handshake`; student/teacher/super-admin → `/dashboard` (per existing page-auth test conventions).
  - All assertions translation-driven (`readTranslation(handle, locale)` / preload helpers) — zero hardcoded strings; run via `bun run test/scripts/run-test.ts <path>`.
- [ ] 4.3.BF **Agent-Browser Functional Self-Loop**:
  - Anonymous `GET /parent/handshake` → redirect to `/login?redirect=/parent/handshake` (assert target URL).
  - Student login → `/parent/handshake` → redirect to `/dashboard`; teacher login → same (DOM assertion that the page NEVER renders, no flash).
  - Parent login → `/parent/handshake`:
    - Type garbage (`KSB-1`, unicode, `%KSB-ABCD1234`) → submit → inline helper appears; DevTools network assertion: NO GraphQL request fired.
    - Type lowercase of a REAL fixture code → submit → masked card renders with the masked name (≠ raw fixture name observed at fixture level); network tab shows exactly one `FindStudentByHandshakeCode` call with the normalized variable.
    - Type a valid-format-but-missing code (`KSB-DEADBEEF` unused) → not-found state renders with neutral (non-error) styling.
    - Already-linked fixture code → "already linked" copy; assert NO CTA.
  - en + ar locale flow both executed (locale switch then repeat the found + not-found cases).
  - Iterative self-loop: patch and re-run until every step is clean; record the final green run log in the outcome.
- [ ] 4.3.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
  - Capture every outcome state (idle / invalid / searching-skeleton / not-found / found-linkable / found-already-linked / FORBIDDEN surface) at 1440x900, 768x1024, 375x812 × en(LTR)/ar(RTL) × light/dark.
  - Analyze: input/result alignment mirrors correctly in RTL; masked Arabic names render correctly; code-related atoms remain LTR; no truncation/overflow at 375px; palette-only colors (pixel-sample borders/backgrounds); typography hierarchy matches dashboard conventions; not-found state visually distinct from error styling per REQ-067.
  - Iterative self-loop: screenshot → identify defect → patch `sx`/theme tokens → re-capture → repeat until polished; attach final capture matrix to the outcome.
- [ ] 4.3.SR **Semantic Review**: zero direct style props; no hardcoded colors/strings; `*Outlined` icons; no use of `FormEvent`; no `useLazyQuery`; local-state-only (no new Zustand store — server state lives in Apollo per plan §5.4); nav item is parent-group-only.
- [ ] 4.3.IV **Instruction Verification**: read `app/AGENTS.md` (page-auth wrapper rules), `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, and any `frontend.instructions.md` / `mobile-desktop.instructions.md`; confirm compliance.
- Outcome: `outcome/4.3-parent-discovery-page-outcome.md`.

---

## Phase 5: Integration & Differential Testing

### - [ ] 5.1 Full Test-Surface Execution & Coverage Evidence
- Run, in order, and capture raw outputs into the outcome:
  - Every new/edited test file individually via `bun run test/scripts/run-test.ts <path>` (enumerate: shared constants spec, mask spec, generation lock suite, repository spec, service spec, graphql integration spec, component specs — student card + parent page, SSR guard specs).
  - `bun test test/workflows` (full journey directory green).
  - `bun test --coverage` evidence for the four new backend/shared modules at **100% statement + branch** (REQ-070); attach the coverage table.
  - Adjacent-suite differential runs (no regressions): the existing auth/registration test suites (`RegistrationService` locks from DEV1-002 era) must still pass untouched — paste results.
- _Requirements: REQ-070, REQ-071, REQ-072, REQ-073, REQ-074, REQ-075, REQ-077_

### - [ ] 5.2 Differential & Discipline Verification Gates
- Execute and paste literal command + output into `outcome/5.2-differential-gates-outcome.md`:
  - **Zero schema drift:** `git diff backend/db/schema/** backend/db/migration/**` → EMPTY (REQ-045).
  - **Codegen diff discipline:** generated artifacts diff contains ONLY this ticket's additions (REQ-062).
  - **Immutability scan (REQ-013):** grep evidence that `handshakeCode` writes exist ONLY in the registration insert path.
  - **BOPLA scan (REQ-032):** grep evidence of zero `{ ...input }`/object-spread-to-persistence patterns in the ticket diff.
  - **No-LIKE scan (REQ-022/035):** grep evidence of zero LIKE/ILIKE/`sql`-template usage in new backend code; record the `escapeLikeWildcards` not-applicable affirmation.
  - **No-caching scan (REQ-044):** grep evidence no cache layer/pinged cache keys were introduced for lookup results (positive or negative).
  - **Baseline delta (REQ-076):** re-run `bun tsgo`, `bun run biome:check`, `bun run scripts/lint-service.ts --json --id final` — counts MUST equal the 0.1 baseline (zero NEW findings); paste side-by-side comparison table.
  - **Side-effect absence (REQ-023):** evidence (service test probes + grep) that lookups emit zero audit/notification rows.
- _Requirements: REQ-013, REQ-022, REQ-023, REQ-032, REQ-035, REQ-044, REQ-045, REQ-062, REQ-076_

---

## Phase 6: Post-Implementation Review Waves (Parallel)

> All four waves may run concurrently against the completed change set; each writes its own outcome; any blocking finding cycles the owning task back open before Phase 7.

### - [ ] 6.1 `review-types` Wave
- Verify: canonical-types discipline (REQ-003) — `HandshakeCodeLookupReturnType`/`HandshakeDiscoveryRowType` composition via `Pick` only; zero local types in Pothos files; zero service-layer `.types.ts`; readonly immutability; barrel coherence; `tsgo` clean vs baseline.
- Outcome: `outcome/6.1-review-types-outcome.md`.

### - [ ] 6.2 `review-backend` Wave
- Verify: normalize-then-validate ordering (REQ-020); governance-collapse equivalence of nonexistent-vs-governed (REQ-021/033); `tx` propagation (REQ-043); DomainError taxonomy + `extensions.code` matrix (REQ-050); log hygiene incl. D11 code-elision (REQ-052); silent happy path (REQ-053); 100% coverage evidence present; journey suite realism (real services, committed fixtures, tracked teardown, no `runInRollback`).
- Outcome: `outcome/6.2-review-backend-outcome.md`.

### - [ ] 6.3 `review-frontend` Wave
- Verify: MUI v9 `sx`-only discipline; `*Outlined` icons; theme-palette-only colors; `React.SubmitEvent` usage; skip-gate (no network on invalid input); no `useLazyQuery`; embedded `keyFields:false` registered + documents omit `id`; translation-driven everything (enum-property access); ERR rendering per `extensions.code`; RTL mirroring + LTR code atoms; both Agent-Browser self-loops evidenced with final screenshot matrices.
- Outcome: `outcome/6.3-review-frontend-outcome.md`.

### - [ ] 6.4 `pentester` Wave + Deferred-Items Gate
- Independent adversarial review: BOLA (zero-argument self-query; capability-by-code rationale audited against REQ-030 — confirm parent-role gate + minimal payload make the capability safe); BFLA `$all` scope correctness on BOTH queries incl. sibling-role cells (REQ-031); BOPLA closed inputs (REQ-032); oracle hygiene — network-level indistinguishability of {nonexistent, governed} and absence of timing/difference signals worth asserting (REQ-033); injection fuzz closure on `code` (REQ-035); rate-limit residual risk formally bounded to deferred item **D2** (REQ-034) — flagged posture must match the ledger, no scope creep.
- **Deferred-items gate:** `grep -c "❌\|⚠️" ai/plans/dev1-013-student-handshake-code-generation/deferred-items.md` MUST equal 0 EXCLUDING the three pre-seeded forward notes D1 (→DEV1-014), D2 (→DEV2-002), D3 (→DEV3-019); verify each forward note cites its owning ticket and non-blocking status (REQ-083).
- Outcome: `outcome/6.4-pentester-and-deferred-gate-outcome.md`.
- _Requirements: REQ-030, REQ-031, REQ-032, REQ-033, REQ-034, REQ-035, REQ-076, REQ-083_

---

## Phase 7: Knowledge Propagation & Documentation

### - [ ] 7.1 Canonical Doc — `docs/parents/handshake-code-discovery.md`
- Create following the standard structure (Why → Pattern → Rules → What NOT to Do → Rollout Summary → Related Documents), covering:
  - Code format + generation contract (link `docs/auth/user-registration.md` §2; collision model: 16⁸ ≈ 4.3B space, in-transaction bounded retry on `23505`, `ConflictError` on exhaustion — describe, never re-implement) (REQ-024).
  - Discovery payload minimalism ruling (REQ-015..019) + mask algorithm contract (deterministic, grapheme-aware, total function, empty-input placeholder).
  - Governance-exclusion collapse rule (`isDeleted`/`isBlocked`/active suspension ⇒ byte-identical to "never existed") (REQ-021).
  - Null-not-error not-found precedent (REQ-016, citing the DEV2-004 precedent).
  - **Binding forward contract for DEV1-014:** re-resolve the student by re-submitting the handshake code inside its own transaction; never trust a stored/transmitted id; re-check `parentId IS NULL` server-side (this ticket's `linkable` read is advisory).
  - Brute-force posture + D2 forward note (role gate, minimal payload, 32-bit-hex keyspace, future real limiter via DEV2-002) (REQ-034).
  - B.12 semantics of `linkable`; B.13 (per-child gating, never per-parent); B.14 explicitly out of scope here (no link requests exist); INV-P1 anchoring (discovery ≠ monitoring).
- _Requirements: REQ-024, REQ-080_
- [ ] 7.1.SR **Semantic Review**: structure checklist satisfied; every numeric/behavioral claim matches shipped code (no aspirational content); English-only domain doc per docs conventions.
- Outcome: `outcome/7.1-canonical-doc-outcome.md`.

### - [ ] 7.2 Cross-Links & AGENTS.md Propagation (rule-only one-liners)
- Append ONE-line cross-reference into `docs/auth/user-registration.md`'s handshake section pointing at the new canonical doc (no renumbering, no content edits).
- Append ONE-line cross-reference into `docs/workflows/04-parent-supervision-handshake.md` (related/implementation notes).
- `docs/specs/state-machine-invariants.md`: add a pointer line ONLY if one does not already exist (INV-P1..P4 binding; zero renumbering or content edits of existing invariants) (REQ-081).
- AGENTS.md one-liners (rule/pointer ONLY — no code, no plan meta):
  - `backend/services/AGENTS.md` — handshake discovery service entry + minimal-payload rule.
  - `backend/db/repo/AGENTS.md` — equality-lookup + prepared-statement-not-applicable note for this read pattern.
  - `frontend/graphql/AGENTS.md` — embedded-types list entry for `HandshakeCodeLookup` with `keyFields: false` (final polish if 4.1's interim entry needs it).
  - Root `AGENTS.md` — Important References pointer to `docs/parents/handshake-code-discovery.md`.
- _Requirements: REQ-081, REQ-082_
- [ ] 7.2.SR **Semantic Review**: every AGENTS addition is a single rule line with a doc pointer; no duplicated guidance between docs and AGENTS entries.
- Outcome: `outcome/7.2-knowledge-propagation-outcome.md`.

### - [ ] 7.3 Outcome Synthesis & Final Gate
- Write `ai/plans/dev1-013-student-handshake-code-generation/outcome/final-synthesis-outcome.md`:
  - Task ledger: every task id → status → outcome file link (completeness: every `[x]` must map to an existing outcome; the 0.3 plan-review outcome predates all implementation outcomes).
  - Baseline comparison table (0.1 vs final): `tsgo` / `biome:check` / lint-service — zero new findings asserted command-by-command (REQ-076).
  - Coverage table (REQ-070) + journey suite summary (REQ-J1..J5 mapping to test steps).
  - Deferred ledger final state: exactly D1/D2/D3 as non-blocking forward notes with owning tickets (DEV1-014, DEV2-002, DEV3-019) — `grep -c "❌\|⚠️"` = 0 excluding those three (REQ-083).
  - Forward-consumer notices to embed into DEV1-014/015 planning seeds: REQ-019 re-resolution-by-code contract, REQ-018 `linkable` advisory semantics, REQ-021 governance-collapse rule.
- Flip all remaining checkboxes ONLY after this gate passes.
- _Requirements: REQ-076, REQ-083_

---

## Requirement → Task Coverage Spot-Check (completeness assertion)

| Requirement cluster | Owning task(s) |
|---|---|
| REQ-001/004/083 (baseline, guards, gates) | 0.1, 0.2, 0.3, 5.2, 6.4, 7.3 |
| REQ-002/051 (i18n) | 1.4, 3.3, 4.2, 4.3 |
| REQ-003 (canonical types) | 1.3, 3.1, 6.1 |
| REQ-010..013/040/041/072 (locks) | 2.1, 5.2 |
| REQ-014/030 (self read, BOLA) | 2.3, 2.4, 3.1, 3.3, 4.2 |
| REQ-015..021/033/042..044 (discovery) | 2.2, 2.3, 2.4, 3.1, 3.3, 5.2 |
| REQ-020/022/035/050/052/053 (validation, errors, logging) | 1.1, 2.4, 3.3, 6.2/6.4 |
| REQ-023/025/045 (no side effects, seeds, zero drift) | 2.4, 2.M, 5.2 |
| REQ-024/034/080..082 (docs + posture) | 7.1, 7.2, 6.4 |
| REQ-031/050/060..063/074 (GraphQL) | 3.1, 3.2, 3.3, 4.1 |
| REQ-064..067/075 (frontend) | 4.2, 4.3 |
| REQ-070..076 (coverage, DB discipline, baseline) | 2.1–4.3 (.TE), 2.M, 5.1, 5.2, 7.3 |
| REQ-077 / REQ-J1..J5 (journey) | 2.2 (test-first), verified green at 2.4/2.M, Policed by 6.2 |
