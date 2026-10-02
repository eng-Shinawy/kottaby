# Implementation Tasks: Teacher Availability Toggle (Available/Unavailable)

> **Plan directory (verbatim):** `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle`
> **Specs of record:** `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/specs.md` (REQ-001..REQ-095) · `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/plan.md` (D1–D10)
> **Ticket (governing ruling):** Milestone 2 · Dev 2 · 3 SP · Decision Refs INV-A1, INV-A2, FR-4.1, FR-4.3 (`docs/planning/TICKETS.md:1253`). Ship ONE new backend service + ONE canonical type + ONE GraphQL query/mutation pair + ONE additive teacher-dashboard card. **ZERO Drizzle schema changes, ZERO new enums, ZERO migrations** (`teacher.is_online` already exists at `backend/db/schema/teachers/teacher.ts:28`). The student-facing "Available Teachers directory" (INV-A3) and the never-resurrect release gate (INV-A4) are OUT OF SCOPE — resolved-pointer deferred items (DEF-2, DEF-1).

---

## Non-Negotiable Execution Protocol

1. **Pre-Execution Knowledge Read:** Before executing ANY task, the agent MUST read ALL existing files in `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/outcome/` in lexical order. Prior outcomes are binding context — never contradict a ratified ruling without a ledger entry.
2. **Post-Edit Verification:** EVERY created/modified file MUST pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0) before its task checkbox flips. The script runs `tsgo → oxlint → biome:check → lint:type-aware → check:duplicates` progressively and auto-discovers the applicable `AGENTS.md` + `.agents/instructions/*.instructions.md` files for the target path.
3. **Test Execution:** ALL tests run via `bun run test/scripts/run-test.ts <test-path>` — NEVER raw `bun test` (raw `bun test` skips the `--env-file=.env.test` preload, breaking DB/GraphQL suites).
4. **Semantic Review:** Every implementation task includes an `.SR` self-review against the semantic checklist (atomicity, env-config, dead code, no cross-layer imports, enums as VALUE imports, canonical types only, deferred-item ledgering).
5. **Outcome Documentation:** Every task writes `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/outcome/<task-id>-outcome.md` BEFORE the next task begins.
6. **Checkbox Tracking:** `[ ]` → `[x]` only when ALL subtasks (`.QL`/`.TE`/`.SEC`/`.SR`/`.IV`) of that task are complete. No partial flips.
7. **Ledger Discipline:** Forward/incomplete-looking items are recorded ONLY as ✅ resolved-pointer entries in `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/deferred-items.md`; the final gate is `grep -cE '^\s*\|.*(❌|⚠️)' <deferred-items.md>` = 0 (row-scoped: the template's Status-Values legend lines contain the symbols; only ledger table rows count).

**Mandatory 5-stage subtask pipeline (strict order) for EVERY implementation task X.Y:** `X.Y.QL` (per-file sub-loop) → `X.Y.TE` (4-Tier test engineering) → `X.Y.SEC` (BOLA/BOPLA/BFLA/sanitization) → `X.Y.SR` (semantic review) → `X.Y.IV` (instruction verification). No skipping ahead: if tsgo fails, fix only tsgo before running oxlint/biome/lint/duplicates.

---

## Phase 0: Pre-Implementation Baseline

### 0.1 Record Error Baseline & Initialize Deferred-Items Ledger

- [ ] 0.1 [Record baseline + initialize ledger]
  - Run and capture counts into `/tmp/baseline-*.txt`:
    - `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt`
    - `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`
    - `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Initialize `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`, seeded with the plan's resolved-pointer entries: INV-A3 student directory (Dev3 pointer, DEF-2), INV-A4 never-resurrect release gating (sibling In-Session Locking ticket, DEF-1), 15-min inactivity auto-offline (`TICKETS.md:1298`, DEF-3), cooldown-lineage note (DEF-4), the optional `canSetAvailable` flag (DEF-5), and the gate-docstring FORBIDDEN-class drift (DEF-6).
  - Write `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/outcome/0-baseline-outcome.md` with the captured numbers (these are the REQ-075 comparator).
  - _Requirements: REQ-001_

### 0.2 Prerequisite & Dependency Verification (Anchored, Never Rebuilt)

- [ ] 0.2 [Verify every consumed artifact exists at its cited anchor — grep/Read, no edits]
  - **Repo write primitive (CONSUME, never modify):** `TeacherRepository.setOnline(id: number, online: boolean, tx: DBTransaction): Promise<TeacherSelectType | null>` at `backend/db/repo/teachers/teacher.repository.ts:437` — required-`tx` guarded `UPDATE teacher SET is_online, updated_at=now() WHERE id=$1 RETURNING *` (`:438-446`); returns `null` on zero rows; idempotent on same value. Its docstring (`:397-447`) states the SERVICE composes WHEN and that "the future availability-toggle work owns the never-resurrect gating" (feeds DEF-1).
  - **Certification-lock primitive (CONSUME):** `TeacherRepository.lockForCertificationCheck(teacherId: number, tx: DBTransaction): Promise<{ id: number; isApproved: boolean | null } | null>` at `backend/db/repo/teachers/teacher.repository.ts:217` — `SELECT id, is_approved … FOR UPDATE` via `.for("update")`; `null` ⇒ no teacher row (treat as not certified → INV-A1 denial); `isApproved === null` ⇒ treat as not certified.
  - **Read primitive (CONSUME):** `TeacherRepository.findById(id: number, tx?: DBQueryExecutor): Promise<TeacherSelectType | null>` at `backend/db/repo/teachers/teacher.repository.ts:172` (tx branch Drizzle, non-tx `queryDb` fast path `:178-192`).
  - **INV-A2 seam gate (CONSUME verbatim, no new gate):** `assertTeacherNotInActiveSession(teacherId: number, tx: DBTransaction, t?: ErrorsTranslations): Promise<void>` at `backend/services/classes/session-lifecycle.enforcement.ts:200-214` — probes `SessionRepository.listForTeacher(teacherId, { status: SessionStatus.Started }, 1, 0, tx)` (`backend/db/repo/classes/session.repository.ts:635-647`); throws `ConflictError("TEACHER_IN_ACTIVE_SESSION", t.teacherInActiveSession)` with ONE bounded `logger.logDomainError` and NO session id disclosed; re-exported via `backend/services/classes/index.ts:6`.
  - **Schema anchors (read-only):** `teacher.isOnline` at `backend/db/schema/teachers/teacher.ts:28` (`boolean("is_online").default(false)`, nullable); shared PK/FK to `users.id` cascade `:22-24`; `session.status` at `backend/db/schema/classes/session.ts:64`; `sessionStatus` enum values mirror `SessionStatus` (`backend/enum/scheduling/session-status.enum.ts:7-13`).
  - **Error/taxonomy anchors:** `ForbiddenError` → code `FORBIDDEN`/403 at `backend/lib/errors.ts:51-55`; `ConflictError` custom-code form at `:171-183`; `ERROR_CODE_HTTP_STATUS` (`backend/lib/errors/error-code-taxonomy.ts:41-51`) maps FORBIDDEN→403, CONFLICT→409, VALIDATION→422; custom SCREAMING codes normalize to `null` (so a custom code CANNOT yield 403 — 403 requires `ForbiddenError`). `logger.logDomainError(message: string, ctx?: DomainErrorContext)` at `backend/lib/logger.ts:92-101`; `withTransaction(outerTx, fn, config?)` at `backend/lib/db/with-transaction.ts:42` (NOT re-exported from `@/backend/db`).
  - **i18n anchors (reuse existing keys, do NOT invent):** `teacherNotCertified` (`shared/locale/types/errors/labels.ts:243`; en `shared/locale/en/errors/index.ts:108`), `teacherInActiveSession` (`labels.ts:247`; en `:110`), `teacherNotFound` (`labels.ts:249`). `getServerTranslations(locale)` from `@/shared/locale/server-graphql` (ONE arg) then `.errorsTranslations`.
  - **GraphQL anchors:** Pothos object pattern `gqlSchemaBuilder.objectRef<T>("Name")`; teacher-role scope `authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }` (`backend/graphql/mutation/classes/student-evaluation.mutation.ts:66-71`; `UserRole` from `@/backend/enum/users/user-role.enum`); mutation barrel `backend/graphql/mutation/index.ts:36-47` has NO `./teachers` entry (`backend/graphql/mutation/teachers/` does not exist — verified `ls`); query barrel `backend/graphql/query/teachers/index.ts` exists.
  - **Pre-existing related artifact (MUST NOT be confused/aliased):** `TeacherAvailabilitySnapshotContract` at `backend/types/contracts/teacher-availability.contract.types.ts:27` is the Dev3 MATCHING-input snapshot (`teacherId/isOnline/averageRating/subjects/requestPreference/country/languages`), consumed by the on-demand matcher — its conformance suite lives at `backend/types/contracts/contracts.conformance.test-d.ts`. The new `TeacherAvailabilityReturnType` is a DISTINCT toggle-operation projection; do NOT modify or reuse the contract for it (REQ-003 boundary).
  - **Test anchors:** existing `TeacherRepository.setOnline` coverage at `backend/db/test/repo/teachers/teacher.repository.test.ts:393+` (extend, do not duplicate); journey helpers `provisionCertifiedTeacherActor` (`test/workflows/helpers/actor-context.ts:105-116`) + `buildSessionJourneyCast` (`test/workflows/helpers/session-cast.ts:280`); `docs/testing/workflow-journey-tests.md` and `test/workflows/AGENTS.md` EXIST (verified — do not scaffold).
  - **Freeze/surface anchors:** Mutation-root exact `toEqual` pin at `backend/graphql/test/schema-surface.test.ts:1097-1125`; Query-root pin at `:972-1006`; default-deny authScopes coverage gate `frontend/graphql/test/gateway/allowlist-coverage.test.ts:135,142,158` (unscoped root set ≡ frozen six); frozen public-operations six at `backend/lib/gateway/public-operations.ts:36-46`.
  - IF any anchor is missing or drifted: record a ❌ ledger entry and BLOCK the dependent task — never inline-patch a foreign layer.
  - _Requirements: REQ-004, REQ-016, REQ-018_

### 0.3 Phase 1.5 Plan-Review Gate (BLOCKING)

- [ ] 0.3 [@plan-review — ZERO violations required before any implementation task begins]
  - Review the trio (`specs.md` + `plan.md` + this `tasks.md`) against root `AGENTS.md` + layer `AGENTS.md` + `.agents/instructions/*`.
  - The review MUST ratify: (a) the §Scope reconciliation — INV-A1/INV-A2 only; INV-A3/INV-A4 deferred with pointers (DEF-2, DEF-1); (b) the D3 error-class ruling — INV-A1 denial is `ForbiddenError` (FORBIDDEN/403), NOT the booking/rubric VALIDATION-class `TEACHER_NOT_CERTIFIED` toast; (c) the reuse ruling — `setOnline`/`lockForCertificationCheck`/`assertTeacherNotInActiveSession` are consumed verbatim with no new repo primitive.
  - Write `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/outcome/plan-review-R1.md`.
  - _Requirements: REQ-004_

---

## Phase 1: Types, Enums & i18n (NO Database Schema Work — Zero-Drift Ticket)

> No Drizzle schema task exists in this phase: `git diff backend/db/schema/** backend/db/migration/**` MUST remain EMPTY at completion. No `bun run db push` is invoked. `teacher.is_online` exists (`backend/db/schema/teachers/teacher.ts:28`); no enum is minted (D5, REQ-016).

### 1.1 Canonical Type — `TeacherAvailabilityReturnType`

- [ ] 1.1 [Add the ONE additive canonical type]
  - UPDATE `backend/types/teachers/teacher.types.ts` (today exports `TeacherSelectType` + `TeacherColdStartCertificationInput`) with EXACTLY one new export:
    `export interface TeacherAvailabilityReturnType { readonly id: number; readonly isOnline: boolean; readonly isApproved: boolean; }`
  - Field semantics: `id` = `TeacherSelectType["id"]`; `isOnline` = the durable toggle column value read/written under the same transaction; `isApproved` = the certification projection (coerced non-null — `null` treated as `false` at the service boundary, REQ-014). Design one interface only; NO parallel `inSession` flag (excludability is expressed via `isOnline === false` — same doctrine as `backend/types/contracts/teacher-availability.contract.types.ts:13-14`).
  - The existing barrel `backend/types/teachers/index.ts` ALREADY re-exports `./teacher.types` — verify, do NOT add a duplicate line.
  - Do NOT modify `TeacherAvailabilitySnapshotContract` (`backend/types/contracts/teacher-availability.contract.types.ts:27`) — it is the Dev3 matching snapshot, a distinct concern (REQ-003 boundary).
  - NO service-layer `.types.ts` file; NO local type declarations in service/repo/frontend layers.
  - Instructions: `.agents/instructions/backend.instructions.md`; `backend/types/AGENTS.md`.
  - _Requirements: REQ-003, REQ-013, REQ-016_
  - [ ] 1.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/types/teachers/teacher.types.ts --lifecycle duplicates` (exit 0) + same for `backend/types/teachers/index.ts`.
  - [ ] 1.1.TE **Test Engineering:** the canonical-type suite (`backend/types/teachers/evaluation-booking.types.static-assertions.test.ts` precedent) and `backend/types/contracts/contracts.conformance.test-d.ts` MUST stay green UNEDITED — run via `bun run test/scripts/run-test.ts backend/types/contracts`. Add ONE compile-level static assertion (in the teachers types test layer, mirroring the existing `static-assertions` idiom) pinning `TeacherAvailabilityReturnType` field names/types and that `id` is `number` (not `ID`-string).
  - [ ] 1.1.SEC **Security & Tenancy Audit:** the projection carries ONLY `id/isOnline/isApproved` — no email/phone/governance/rating fields may be added (BOPLA read-side hygiene pinned at type level).
  - [ ] 1.1.SR **Semantic Review:** single new canonical type; zero dead exports; zero cross-layer imports; `TeacherSelectType` is referenced only via indexed access or kept consistent with `backend/types/teachers/teacher.types.ts`; no schema drift.
  - [ ] 1.1.IV **Instruction Verification:** validate against `.agents/instructions/backend.instructions.md` + `backend/types/AGENTS.md`.

### 1.2 New `availability` Locale Namespace + Parity Suite (ONE Changeset)

- [ ] 1.2 [Create the teacher-facing availability namespace and register it everywhere]
  - CREATE `shared/locale/types/availability/labels.ts` with `export interface AvailabilityLabels { … }` declaring EXACTLY these 8 leaf-string keys: `cardTitle`, `toggleToAvailableCta`, `toggleToUnavailableCta`, `certificationRequiredHint`, `inSessionLockedHint`, `updateSuccess`, `updateGenericError`, `loadErrorNotice`. Mirror the doc style of `shared/locale/types/schedule/labels.ts` (per-key JSDoc, property-access-only note), plus `shared/locale/types/availability/index.ts` (`export * from "./labels";`).
  - CREATE `shared/locale/en/availability/labels.ts` (`export const availabilityEn: AvailabilityLabels = { … }`) + `shared/locale/en/availability/index.ts` (`export * from "./labels";`) and `shared/locale/ar/availability/labels.ts` (`availabilityAr`) + `shared/locale/ar/availability/index.ts` (`export * from "./labels";`) with concrete copy; the `ar` leaf MUST contain Arabic script for every key (parity-tested).
  - CREATE `shared/locale/namespaces/availability/availability.namespace.ts` mirroring `shared/locale/namespaces/applicant/applicant.namespace.ts`: `export const Availability = defineNamespace<AvailabilityLabels>("availability.availability", translations => translations.availabilityTranslations);` + `shared/locale/namespaces/availability/index.ts` (`export * from "./availability.namespace";`).
  - REGISTER: add `export * from "./availability";` to `shared/locale/namespaces/index.ts`; add the `Availability` import + object member to `shared/locale/namespaces/registry.ts`; add `availabilityTranslations: AvailabilityLabels;` to the `Translations` interface in `shared/locale/types/message.ts`; add the `availabilityTranslations: availabilityEn` / `availabilityAr` slice + import to `shared/locale/en/messages.ts` and `shared/locale/ar/messages.ts`.
  - Do NOT edit `shared/locale/types/index.ts` (it is a curated subset that does not list `applicant`/`auth` either — verified; the new types dir is imported directly by the namespace file).
  - CREATE `shared/locale/availability-namespace.parity.test.ts` mirroring `shared/locale/applicant-namespace.parity.test.ts`: pin the exact 8-key frozen set, en/ar key-set parity, no extra/missing keys, and Arabic-script presence for every `ar` leaf.
  - FORBIDDEN anywhere: `next-intl`, `getBackendTranslations`, `shared/messages/`, the `Translation` enum, a two-arg `getTranslations`.
  - Instructions: `shared/AGENTS.md`, `shared/locale/AGENTS.md`.
  - _Requirements: REQ-002, REQ-052_
  - [ ] 1.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts` on ALL eight locale files + the parity test (exit 0 each).
  - [ ] 1.2.TE **Test Engineering:** `bun run test/scripts/run-test.ts shared/locale/availability-namespace.parity.test.ts` green; `errors`-namespace parity suite stays green UNEDITED (existing error keys are reused, not extended).
  - [ ] 1.2.SEC **Security & Tenancy Audit:** no copy interpolates any identifier (no ids, names, or contacts) — static leaf strings only; the namespace reads no tenancy state.
  - [ ] 1.2.SR **Semantic Review:** id `"availability.availability"` follows the `<dir>.<stem>` convention; en/ar trees structurally identical; namespace is registered in the registry AND the `Translations` interface AND both messages slices (missing any one is a compile error).
  - [ ] 1.2.IV **Instruction Verification:** validate against `shared/AGENTS.md` namespace checklist + `shared/locale/AGENTS.md`.

### 1.3 Frontend Error-Link Map — `TEACHER_IN_ACTIVE_SESSION` Row

- [ ] 1.3 [Map the INV-A2 denial code to its existing localized key]
  - UPDATE `frontend/providers/apollo/error-link.map.ts`: add ONE row so `TEACHER_IN_ACTIVE_SESSION` (the custom CONFLICT-class 409 code emitted by the reused gate) surfaces as an inline conflict notice using the EXISTING `errors` key `teacherInActiveSession` (do NOT mint a key). Home it in a dedicated `AVAILABILITY_CONFLICT_NOTICE_ROWS` const + a `mapAvailabilityRow` resolver (mirroring the `RUBRIC_CONFLICT_NOTICE_ROWS` / `mapRubricEvaluationRow` idiom at `:371-414`), and add the code's dispatch line into `mapGraphQLErrorByCode` (`:460-469`). Extend the entry-point doc table (`:422-450`) with the new row.
  - DOCUMENT the INV-A1 posture in the same file's docblock (do NOT add a code row for it): the certification denial is `ForbiddenError` → generic `FORBIDDEN`/403, so it maps to the EXISTING generic `forbidden` toast (`mapPermissionRow`, `:219-235`). The card PRE-EMPTS it client-side from `isApproved` (task 4.2); the server 403 is the defense-in-depth backstop (documented hazard, REQ-030).
  - Do NOT modify `TEACHER_NOT_CERTIFIED: "teacherNotCertified"` (`:360`) — it belongs to the session-booking/rubric VALIDATION-class path, a different surface.
  - Instructions: `.agents/instructions/frontend.instructions.md`; `frontend/AGENTS.md`.
  - _Requirements: REQ-052, REQ-051, REQ-030_
  - [ ] 1.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts frontend/providers/apollo/error-link.map.ts --lifecycle duplicates` (exit 0).
  - [ ] 1.3.TE **Test Engineering:** extend the existing error-link map test file (locate it beside the map; if the map is exercised via `frontend/providers/apollo/*.test.ts`, add cases there) — assert `TEACHER_IN_ACTIVE_SESSION` → `{ kind: "notice", noticeKind: "conflict", messageKey: "teacherInActiveSession", tone: "error", retryable: false }` and that an unknown code still returns `null` (no behavior change for other codes).
  - [ ] 1.3.SEC **Security & Tenancy Audit:** the row renders a static localized key — never the server `message`; no identifier from the denial is surfaced (oracle-safety alignment with REQ-034).
  - [ ] 1.3.SR **Semantic Review:** row is additive and placed in canonical taxonomy order; `messageKey` is a leaf of `ErrorsLabels`; no dead resolver branch.
  - [ ] 1.3.IV **Instruction Verification:** validate against `.agents/instructions/frontend.instructions.md` + `frontend/AGENTS.md`.

---

## Phase 2: Repositories & Backend Services

> NO new repository is created: the toggle reuses `TeacherRepository.setOnline` (`:437`), `TeacherRepository.lockForCertificationCheck` (`:217`), `TeacherRepository.findById` (`:172`), and the `assertTeacherNotInActiveSession` gate (`backend/services/classes/session-lifecycle.enforcement.ts:200`). Phase 2 is the service-composition phase (D2).

### 2.1 NEW Service — `TeacherAvailabilityService`

- [ ] 2.1 [Implement `backend/services/teachers/teacher-availability.service.ts` + register the barrel]
  - CREATE `backend/services/teachers/teacher-availability.service.ts` with `export namespace TeacherAvailabilityService` exposing EXACTLY two methods:
    - `getAvailability(teacherId: number, locale: string): Promise<TeacherAvailabilityReturnType>`
    - `setAvailability(teacherId: number, isOnline: boolean, locale: string, tx?: DBTransaction): Promise<TeacherAvailabilityReturnType>`
  - `getAvailability` steps: `const t = getServerTranslations(locale).errorsTranslations;` (ONE arg) → shape-assert `teacherId` (`Number.isSafeInteger(teacherId) && teacherId > 0`, else `ValidationError(t.validation)` pre-DB) → `TeacherRepository.findById(teacherId)`; `null` ⇒ EXACTLY ONE `logger.logDomainError("Teacher not found for availability read", { code: "TEACHER_NOT_FOUND", entity: "teacher", entityId: teacherId, locale })` → `throw new NotFoundError("TEACHER", t.teacherNotFound)` → else return `{ id: row.id, isOnline: row.isOnline ?? false, isApproved: row.isApproved ?? false }` (null-coerced, D5).
  - `setAvailability` steps (ALL writes inside ONE `withTransaction(tx, async innerTx => …)` — `backend/lib/db/with-transaction.ts:42`; `outerTx` LAST):
    1. `const t = getServerTranslations(locale).errorsTranslations;`
    2. Pre-DB validation: `Number.isSafeInteger(teacherId) && teacherId > 0` AND `typeof isOnline === "boolean"` — else `ValidationError(t.validation)` with ZERO reads (REQ-050).
    3. `const locked = await TeacherRepository.lockForCertificationCheck(teacherId, innerTx);` — `null` ⇒ ONE bounded `logger.logDomainError` (`code: "TEACHER_NOT_FOUND"`) → `throw new NotFoundError("TEACHER", t.teacherNotFound)`.
    4. **Toggle-to-Available only (`isOnline === true`)** — ordered gates: (a) **INV-A1:** `if (locked.isApproved !== true)` ⇒ ONE bounded `logger.logDomainError("Teacher availability denied: not certified", { code: "FORBIDDEN", entity: "teacher", entityId: teacherId, locale })` → `throw new ForbiddenError(t.teacherNotCertified)` (code FORBIDDEN → HTTP 403 per `error-code-taxonomy.ts:44`; NOT the booking/rubric VALIDATION-class `TEACHER_NOT_CERTIFIED` toast — D3). (b) **INV-A2:** `await assertTeacherNotInActiveSession(teacherId, innerTx, t);` — reuses the existing gate verbatim (it logs + throws `ConflictError("TEACHER_IN_ACTIVE_SESSION")`; the service adds NO duplicate log) (D4).
    5. `const updated = await TeacherRepository.setOnline(teacherId, isOnline, innerTx);` — `null` ⇒ ONE bounded log (`code: "TEACHER_NOT_FOUND"`) → `NotFoundError` (honest zero-row guard).
    6. `return { id: updated.id, isOnline: updated.isOnline ?? false, isApproved: locked.isApproved ?? false };`
  - **Toggle-to-Unavailable (`isOnline === false`)** takes the SAME path minus step 4 — ALWAYS allowed (an uncertified teacher may go offline; the `setOnline` docstring at `:413` confirms) (REQ-012). Same-value writes are idempotent by construction (REQ-017).
  - Field-by-field projection only — NEVER spread a raw row into the return value (BOPLA, REQ-032). Happy path logs NOTHING; each denial logs EXACTLY ONCE with bounded context `{ code, entity, entityId, locale }` (REQ-033/REQ-053).
  - UPDATE `backend/services/teachers/index.ts` (exists, 5 entries) with `export * from "./teacher-availability.service";`. `backend/services/index.ts:17` already re-exports `./teachers` — verify, do NOT duplicate.
  - NO service-layer `.types.ts`; NO local type declarations (import `TeacherAvailabilityReturnType` from `@/backend/types/teachers/teacher.types`).
  - Instructions: `.agents/instructions/backend.instructions.md`; `backend/services/AGENTS.md`.
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-030, REQ-031, REQ-032, REQ-033, REQ-040, REQ-041, REQ-042, REQ-043, REQ-050, REQ-051, REQ-052, REQ-053_
  - [ ] 2.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts` on the service file + `backend/services/teachers/index.ts` (exit 0 each).
  - [ ] 2.1.TE **Test Engineering:** CREATE `backend/services/teachers/teacher-availability.service.test.ts` — `runInRollback` + `tx` propagated to every call, try/catch denial helper (NEVER `expect(...).rejects.toThrow()` inside `runInRollback`). 4-Tier:
    - **Tier 1 (branch/stmt):** `getAvailability` hit + miss (`TEACHER_NOT_FOUND`); `setAvailability` true on a certified teacher (happy, `isOnline=true`); true on an uncertified teacher (`FORBIDDEN`); true on a certified teacher with a `started` session (`TEACHER_IN_ACTIVE_SESSION`); false on a certified teacher (always allowed); false on an uncertified teacher (allowed).
    - **Tier 2 (boundary):** `teacherId` = `0`, `-1`, `1.5`, `NaN`, `2**53` (all `VALIDATION` pre-DB); `isOnline` non-boolean (cast) ⇒ `VALIDATION`; `isApproved = null` row ⇒ treated as not certified (INV-A1 deny); same-value re-toggle (`false`→`false`, `true`→`true`) returns the row with no drift; `locale="ar"` yields the Arabic denial copy.
    - **Tier 3 (chaos):** 25-way `Promise.allSettled` same-teacher toggle storm ⇒ deterministic final `is_online` + zero partial writes; forced inner failure ⇒ `teacher.is_online` unchanged (rollback of the whole `withTransaction`).
    - **Tier 4 (security):** hostile-id fuzz with a repo/read spy proving ZERO DB calls before a `VALIDATION` denial; every denial logs EXACTLY ONCE (log-spy count) and returns NO session id.
    - Run via `bun run test/scripts/run-test.ts backend/services/teachers/teacher-availability.service.test.ts`.
  - [ ] 2.1.SEC **Security & Tenancy Audit (BOLA/BOPLA/BFLA):** BOLA — the teacher id is a SERVER-DERIVED argument (`ctx.user.id` at the resolver), never a client-supplied target (REQ-031); BOPLA — the write is a single boolean pin via `setOnline` (no `{...input}` spread), the return is field-mapped (REQ-032); BFLA — role admission is enforced at the resolver scope, the service re-verifies certification (defense-in-depth, REQ-030); PII — only `{ code, entity, entityId, locale }` logged, no session id (REQ-033/REQ-034).
  - [ ] 2.1.SR **Semantic Review:** ONE `innerTx` threaded through the lock/read/write and the reused gate; INV-A1+INV-A2 gates run ONLY on the `true` path; no module-level mutable state; enums as VALUE imports; canonical types only; schema/migration diff empty.
  - [ ] 2.1.IV **Instruction Verification:** validate against `.agents/instructions/backend.instructions.md` + `backend/services/AGENTS.md` + the `setOnline` docstring (`backend/db/repo/teachers/teacher.repository.ts:398-447`).

### 2.2 Service Test Suite — Full 4-Tier Matrix & Coverage Hardening

- [ ] 2.2 [Complete and harden `teacher-availability.service.test.ts` to the full 4-tier standard]
  - Take the suite scaffolded in 2.1.TE and drive it to the complete matrix; every branch of `getAvailability` + `setAvailability` is exercised (REQ-070, REQ-071).
  - **Tier 1 (branch & statement):** enumerate the EXACT Cartesian matrix — `{getAvailability, setAvailability}` × `{found, not-found}` × `{certified, uncertified, isApproved=null}` × `{isOnline true, false}` × `{no session, started session}` — asserting the returned `TeacherAvailabilityReturnType` AND the persisted `teacher.is_online` re-read inside the same `tx`.
  - **Tier 2 (boundary):** null-coercion (`isOnline`/`isApproved` DB-null → `false`), hostile locale (`""`, unknown tag → default-locale copy), unicode-safe denial copy, and idempotency (repeat toggle returns identical projection, `updated_at` may advance but `is_online` is stable).
  - **Tier 3 (chaos/concurrency):** ≥20-way `Promise.allSettled` mixed-toggle storm on ONE teacher ⇒ no lost update, deterministic final value; inject a failure AFTER `setOnline` inside the same tx to prove the rollback leaves `is_online` unchanged and yields NO committed partial state.
  - **Tier 4 (security/abuse):** spy the read path to prove ZERO DB calls on a `VALIDATION` denial; prove an uncertified teacher can NEVER reach `setOnline(true)` (BFLA/INV-A1); prove a `started`-session teacher can NEVER reach `setOnline(true)` (INV-A2); assert every denial row carries the EXACT `code` and logs EXACTLY once.
  - Coverage target: 100% statement + branch on `teacher-availability.service.ts` (REQ-074).
  - Run via `bun run test/scripts/run-test.ts backend/services/teachers/teacher-availability.service.test.ts`.
  - Instructions: `.agents/instructions/tests.instructions.md` + `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-070, REQ-071, REQ-073, REQ-074, REQ-075_
  - [ ] 2.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/services/teachers/teacher-availability.service.test.ts --lifecycle duplicates` (exit 0).
  - [ ] 2.2.TE **Test Engineering:** the suite IS the Tier-1..4 artifact — `runInRollback` + `tx` everywhere; denial assertions via try/catch (never `.rejects.toThrow()`); fixtures for a certified teacher, an uncertified teacher, an `isApproved=null` teacher, and a `started` session created through the real `SessionLifecycleService.createSession`/`startSession` (`backend/services/classes/session-lifecycle.service.ts:196,249`) inside the same `runInRollback` tx.
  - [ ] 2.2.SEC **Security & Tenancy Audit:** adversarial cases are asserted, not simulated — no mock replaces the gate; the certification and in-session denials are proven against REAL rows/locks.
  - [ ] 2.2.SR **Semantic Review:** no `console.*`; no `runInRollback` deadlock pattern; fixtures via verified `entity-setup.ts` helpers where they exist, else direct Drizzle inserts inside the held tx; assertions on real row state (DB re-reads), not only on returned objects.
  - [ ] 2.2.IV **Instruction Verification:** validate against `test/AGENTS.md`-adjacent rules + `.agents/instructions/tests.instructions.md` + `backend/db/test/AGENTS.md`.
  - _Requirements: REQ-070, REQ-071, REQ-074_

### 2.M Mid-Point Review Gate

- [ ] 2.M [Halt and self-audit BEFORE any GraphQL/frontend phase]
  - Re-run: the service suite (`bun run test/scripts/run-test.ts backend/services/teachers/teacher-availability.service.test.ts`), the `errors`-namespace parity suite, and `shared/locale/availability-namespace.parity.test.ts`.
  - Verify REQ-016 invariants ALREADY hold: `git diff backend/db/schema/** backend/db/migration/**` EMPTY; `backend/lib/gateway/public-operations.ts` byte-unchanged (frozen six).
  - Verify reuse-not-rebuild: `git diff backend/db/repo/** backend/services/classes/session-lifecycle.enforcement.ts` EMPTY (consumption only).
  - Audit every REQ-010..REQ-053 line against the implemented service; record findings (or a clean bill) in `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/outcome/2M-midpoint-review-outcome.md`.
  - Any blocking gap → new ❌ ledger entry + fix before proceeding; forward-looking gaps → ✅ resolved-pointer entries.
  - _Requirements: REQ-040, REQ-041, REQ-043, REQ-053, REQ-075 (partial)_

---

## Phase 3: GraphQL Resolvers & API Handlers

### 3.1 Pothos Object + Query + Mutation + Wiring

- [ ] 3.1 [Register the `TeacherAvailabilityState` object, the `myTeacherAvailability` query, and the `setTeacherAvailability` mutation]
  - CREATE `backend/graphql/pothos/teachers/teacher-availability.pothos.ts` (mirroring `backend/graphql/pothos/teachers/applicant.pothos.ts`): `export const TeacherAvailabilityStatePothosObject = gqlSchemaBuilder.objectRef<TeacherAvailabilityReturnType>("TeacherAvailabilityState").implement({ fields: t => ({ id: t.exposeInt("id"), isOnline: t.exposeBoolean("isOnline"), isApproved: t.exposeBoolean("isApproved") }) });` — backed EXCLUSIVELY by the canonical `TeacherAvailabilityReturnType` (`@/backend/types/teachers/teacher.types`), NO local type, NO business logic. Teachers-domain objects register TRANSITIVELY via their resolvers (the `backend/graphql/pothos/index.ts` barrel carries only billing/classes/notifications — verified), so NO edit to `pothos/index.ts` is expected.
  - CREATE `backend/graphql/query/teachers/teacher-availability.query.ts` registering `myTeacherAvailability`: `gqlSchemaBuilder.queryField("myTeacherAvailability", t => t.field({ type: TeacherAvailabilityStatePothosObject, authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }, resolve: async (_r, _a, ctx) => { if (!ctx.user) throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized); return TeacherAvailabilityService.getAvailability(ctx.user.id, ctx.locale); } }))`. Add `import "./teacher-availability.query";` to `backend/graphql/query/teachers/index.ts` (side-effect barrel, alphabetically placed).
  - CREATE `backend/graphql/mutation/teachers/teacher-availability.mutation.ts` registering `setTeacherAvailability`: `gqlSchemaBuilder.mutationField("setTeacherAvailability", t => t.field({ type: TeacherAvailabilityStatePothosObject, args: { isOnline: t.arg.boolean({ required: true }) }, authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }, resolve: async (_r, args, ctx) => { if (!ctx.user) throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized); return TeacherAvailabilityService.setAvailability(ctx.user.id, args.isOnline, ctx.locale); } }))` — the ONLY client-owned value is the boolean; identity is `ctx.user.id` (BOLA, REQ-031); NO input type is needed (single scalar arg — REQ-061 object-only).
  - CREATE `backend/graphql/mutation/teachers/index.ts` side-effect barrel (`import "./teacher-availability.mutation";`) and add `import "./teachers";` to `backend/graphql/mutation/index.ts` (`:36-47`); update that barrel's docblock with ONE line describing the new entry.
  - Resolvers are THIN DELEGATION ONLY — no try/catch, no business logic; DomainErrors propagate uncaught with `extensions.code` intact (403 FORBIDDEN / 409 TEACHER_IN_ACTIVE_SESSION / 404 TEACHER_NOT_FOUND / 422 VALIDATION).
  - `UnauthorizedError` imported from `@/backend/lib/errors`; `UserRole` from `@/backend/enum/users/user-role.enum` (VALUE import).
  - Instructions: `.agents/instructions/backend.instructions.md`; `backend/graphql/AGENTS.md`, `backend/graphql/mutation/AGENTS.md`, `backend/graphql/query/AGENTS.md`, `backend/graphql/pothos/AGENTS.md`.
  - _Requirements: REQ-060, REQ-061, REQ-030, REQ-031, REQ-032_
  - [ ] 3.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts` on the pothos object, the query file, the query barrel, the mutation file, both mutation barrels (exit 0 each).
  - [ ] 3.1.TE **Test Engineering:** schema-shape assertions land in 3.2/3.3; here assert the resolver delegation shape by inspection + the scope block (a Tier-4 case in the integration suite proves student/admin callers are denied with FORBIDDEN and anonymous with UNAUTHORIZED).
  - [ ] 3.1.SEC **Security & Tenancy Audit:** `authScopes` is the explicit `$all { authenticated: true, role: [UserRole.Teacher] }` conjunction (bare map is WRONG in this engine — ANY semantics; see `student-evaluation.mutation.ts:15-25`); identity derived from `ctx.user.id` ONLY (no id arg); the boolean is the only client input (BOPLA).
  - [ ] 3.1.SR **Semantic Review:** no local types in Pothos files; single canonical object per entity; no dead code; resolver has no `console.*` and no repo/service-internal branching.
  - [ ] 3.1.IV **Instruction Verification:** validate against `backend/graphql/AGENTS.md` + sub-layer `AGENTS.md` + `.agents/instructions/backend.instructions.md`.

### 3.2 SDL/Codegen Regeneration + Schema-Surface & SDL Test Inventories

- [ ] 3.2 [Regenerate artifacts and update every root-inventory inventory]
  - Run `bun run generate:gqlSchema && bun codegen`. Regenerated artifacts MUST be committed in the SAME change set (gateway Rule 8.5): `frontend/graphql/generated/schema.graphql` (adds `myTeacherAvailability` to the Query root, `setTeacherAvailability` to the Mutation root, and the `TeacherAvailabilityState` object) + the generated TS types under `frontend/graphql/generated/`.
  - UPDATE `backend/graphql/test/schema-surface.test.ts`: add `const TEACHER_AVAILABILITY_QUERY_FIELDS = ["myTeacherAvailability"] as const;` and include it in the Query-root addition list (`:972-1006`); add `const TEACHER_AVAILABILITY_MUTATION_FIELDS = ["setTeacherAvailability"] as const;` and include it in the Mutation-root exact `toEqual` list (`:1097-1125`). Both lists are `.toSorted()`-compared — order of the spread does not matter, membership does.
  - UPDATE `backend/graphql/test/sdl-static-assertions.test.ts`: add `"myTeacherAvailability"` to `FROZEN_QUERY_FIELDS` (`:232`) and `"setTeacherAvailability"` to `FROZEN_MUTATION_FIELDS` (`:140`); bump the two count-bearing test titles (Query `65-op` → `66-op`, Mutation `52-op` → `53-op`) so the titles stay truthful.
  - VERIFY (no edit expected): `frontend/graphql/test/gateway/allowlist-coverage.test.ts` — both new root fields declare `authScopes`, so the unscoped set stays the frozen two queries + four auth mutations; `backend/lib/gateway/public-operations.ts:36-46` stays the frozen six (byte-unchanged — record the `git diff` proof).
  - Run, MUST be green: `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts`, `...sdl-static-assertions.test.ts`, `frontend/graphql/test/gateway/allowlist-coverage.test.ts`, `backend/lib/gateway/public-operations.test.ts`, plus the artifact↔builder byte-identity proof inside `schema-surface.test.ts`.
  - Instructions: `.agents/instructions/backend.instructions.md`; `backend/graphql/AGENTS.md`.
  - _Requirements: REQ-060, REQ-062, REQ-016_
  - [ ] 3.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts` on both edited test files + the regenerated SDL/types (exit 0 each; generated files must be lint-clean per the repo's generated-file config).
  - [ ] 3.2.TE **Test Engineering:** the updated inventories ARE the artifact-tier assertions; additionally assert `TeacherAvailabilityState` exposes EXACTLY `id: Int!`, `isOnline: Boolean!`, `isApproved: Boolean!` and NO extra field (BOPLA shape pin), and that neither new root name appears in `PUBLIC_OPERATION_NAMES`.
  - [ ] 3.2.SEC **Security & Tenancy Audit:** confirm the built schema shows the `$all` scope block snapshot on both new fields (the `authScopesSnapshot` helper precedent at `schema-surface.test.ts:861-874`); confirm the SDL text exposes no id-taking arguments (no BOLA surface).
  - [ ] 3.2.SR **Semantic Review:** codegen output is regenerated (never hand-edited); committed artifact matches the builder byte-for-byte; no unrelated schema drift in the diff.
  - [ ] 3.2.IV **Instruction Verification:** validate against `backend/graphql/AGENTS.md` + gateway Rule 8.5 (artifacts committed with registrations).

### 3.3 GraphQL Integration Tests

- [ ] 3.3 [Author the API-interaction suite]
  - CREATE `backend/graphql/test/teacher-availability.integration.test.ts` following the `setupTestServerLifecycle()` + `testClient` harness (`test/helpers`) — NO raw `fetch`, NO new harness.
  - Cases:
    - Authenticated TEACHER query `myTeacherAvailability` → `{ id, isOnline, isApproved }` reflecting the fixture row.
    - Teacher mutation `setTeacherAvailability(isOnline: false)` → `isOnline:false` on the wire AND persisted (re-read via a second query); repeat with `true` on a certified teacher.
    - **Denials:** uncertified teacher → `extensions.code === "FORBIDDEN"` (HTTP-equivalent 403); certified teacher with a `started` session → `extensions.code === "TEACHER_IN_ACTIVE_SESSION"` AND the response carries NO session id (oracle-safety, REQ-034); unknown teacher id (row absent) → `TEACHER_NOT_FOUND`.
    - **BFLA:** STUDENT and ADMIN callers → `FORBIDDEN`; anonymous caller → `UNAUTHORIZED`.
    - **BOPLA:** the schema rejects any argument other than `isOnline` (assert against `getIntrospection`/the field arg list); there is no way to target a different teacher id.
  - Run via `bun run test/scripts/run-test.ts backend/graphql/test/teacher-availability.integration.test.ts`.
  - Instructions: `.agents/instructions/tests.instructions.md` + `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-060, REQ-030, REQ-031, REQ-034, REQ-070_
  - [ ] 3.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/graphql/test/teacher-availability.integration.test.ts --lifecycle duplicates` (exit 0).
  - [ ] 3.3.TE **Test Engineering:** 4-tier at the wire boundary — cover the happy pair, the full denial matrix, boundary booleans, and an unauthenticated probe; use `testClient` auth as a real role token (never monkey-patch scopes).
  - [ ] 3.3.SEC **Security & Tenancy Audit:** the denial matrix IS the BFLA/BOLA proof; assert error `extensions.code` values exactly and assert the absence of any leaked identifier in denial payloads.
  - [ ] 3.3.SR **Semantic Review:** no direct backend service import from a frontend test path; harness usage matches the sibling GraphQL suites; no `console.*`.
  - [ ] 3.3.IV **Instruction Verification:** validate against `.agents/instructions/tests.instructions.md` + `backend/graphql/AGENTS.md`.

---

## Phase 4: Frontend

### 4.1 Apollo Documents + Barrel

- [ ] 4.1 [Create the typed documents for the query and mutation]
  - CREATE `frontend/graphql/sharedDocuments/teachers/teacher-availability.documents.ts` with EXACTLY two `TypedDocumentNode` exports (mirroring `frontend/graphql/sharedDocuments/teachers/applicant.documents.ts:1-36`):
    - `myTeacherAvailabilityQueryDocument: TypedDocumentNode<MyTeacherAvailabilityQuery>` — `query MyTeacherAvailability { myTeacherAvailability { id isOnline isApproved } }` (zero-arg; identity server-derived).
    - `setTeacherAvailabilityMutationDocument: TypedDocumentNode<SetTeacherAvailabilityMutation, SetTeacherAvailabilityMutationVariables>` — `mutation SetTeacherAvailability($isOnline: Boolean!) { setTeacherAvailability(isOnline: $isOnline) { id isOnline isApproved } }`.
  - Both selections MUST include `id` (Apollo cache normalization — `sharedDocuments/AGENTS.md` "id Field Requirement"). Generated types come from `@/frontend/graphql/generated/gql/graphql` (do not hand-write types).
  - UPDATE `frontend/graphql/sharedDocuments/teachers/index.ts` (exists, 4 entries) with `export * from "./teacher-availability.documents";`.
  - Import `gql`/`TypedDocumentNode` from `"@apollo/client"`; hooks (in 4.2) from `"@apollo/client/react"`.
  - Instructions: `.agents/instructions/frontend.instructions.md`; `frontend/graphql/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md`.
  - _Requirements: REQ-063, REQ-060_
  - [ ] 4.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts` on the documents file + the barrel (exit 0 each).
  - [ ] 4.1.TE **Test Engineering:** CREATE `frontend/graphql/sharedDocuments/teachers/teacher-availability.documents.test.ts` (mirroring `evaluation-rubric.documents.test.ts`): assert both documents parse, the operation names are `MyTeacherAvailability`/`SetTeacherAvailability`, the variable type is `Boolean!`, and both selections carry `id`. The repo-wide `frontend/graphql/sharedDocuments/documents.contract.test.ts` MUST stay green UNEDITED.
  - [ ] 4.1.SEC **Security & Tenancy Audit:** no client-supplied id in any variable; the only variable is the boolean; no field beyond `id/isOnline/isApproved` selected.
  - [ ] 4.1.SR **Semantic Review:** no `useLazyQuery`; documents are zero-side-effect constants; naming convention `…QueryDocument`/`…MutationDocument`.
  - [ ] 4.1.IV **Instruction Verification:** validate against `frontend/graphql/AGENTS.md` + `sharedDocuments/AGENTS.md` + `.agents/instructions/frontend.instructions.md`.

### 4.2 `TeacherAvailabilityCard` + Mount in the Teacher Dashboard

- [ ] 4.2 [Build the card and mount it — NO new route, NO new nav item (D7)]
  - CREATE `frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx`: a zero-prop CLIENT component (`"use client"`) using stateful `useQuery(myTeacherAvailabilityQueryDocument)` + `useMutation(setTeacherAvailabilityMutationDocument)` from `"@apollo/client/react`, copy via `useAppTranslation(Availability)` (property access only) + `Errors` for the denial keys.
    - Render: title (`cardTitle`); a status chip driven by `isOnline` (`availableLabel`/`unavailableLabel` + `availableStatusHint`/`unavailableStatusHint`); a toggle button (`toggleToAvailableCta`/`toggleToUnavailableCta`).
    - **Client pre-emption (INV-A1 UX):** when `isApproved === false`, the "Available" toggle is DISABLED and `certificationRequiredHint` renders (the server 403 FORBIDDEN remains the defense-in-depth backstop).
    - On mutation error, render the mapped copy (`updateGenericError` for unmapped; the error-link map handles `TEACHER_IN_ACTIVE_SESSION` → `teacherInActiveSession` toast from `include: "all"`; background refresh so a successful toggle re-reads the query cache).
  - ADD `export * from "./TeacherAvailabilityCard";` to `frontend/views/teachers/dashboard/index.ts` (exists, 2 entries).
  - UPDATE `frontend/views/dashboard/home/RoleDashboardPage.tsx:72-78` teacher slot to render `<TeacherAvailabilityCard />` as a sibling of `<ApplicantStatusCard />` + `<TeacherUpNextCard />` (order: availability card FIRST, then applicant status, then up-next) — additive only, NO new route/nav.
  - MUI v9 discipline: style props via `sx` only; NO hardcoded colors (theme callbacks / `on<Color>` siblings); RTL-safe layout.
  - Do NOT touch `frontend/views/dashboard/nav/navItems.ts` — no nav entry is added (D7).
  - Instructions: `.agents/instructions/frontend.instructions.md`; `frontend/views/AGENTS.md`, `frontend/AGENTS.md`.
  - _Requirements: REQ-063, REQ-030, REQ-052_
  - [ ] 4.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts` on the card, the teachers-dashboard barrel, and `RoleDashboardPage.tsx` (exit 0 each).
  - [ ] 4.2.TE **Test Engineering:** CREATE a Storybook story `frontend/stories/teachers/TeacherAvailabilityCard.stories.tsx` (mirroring the `frontend/stories/teachers/` precedent) with states: available / unavailable / uncertified (toggle disabled) / loading; assert the card renders each branch via a mock Apollo provider (Storybook is the repo's component tier). Also add the card to `frontend/stories/pages/TeacherDashboard.stories.tsx`'s composition.
  - [ ] 4.2.SEC **Security & Tenancy Audit:** the card renders NO server `message` verbatim; no id interpolation in copy; the disabled-state is a UI affordance only (never a security boundary — the service re-verifies).
  - [ ] 4.2.SR **Semantic Review:** zero hardcoded colors; `useQuery`/`useMutation` hooks imported from `@apollo/client/react`; zero new nav/route; zero `console.*`; RTL-safe.
  - [ ] 4.2.IV **Instruction Verification:** validate against `frontend/views/AGENTS.md` + `frontend/AGENTS.md` + `.agents/instructions/frontend.instructions.md`.

### 4.3 Frontend Integration Tests

- [ ] 4.3 [Drive the new surface end-to-end from the client tier]
  - CREATE `frontend/graphql/test/teachers/teacher-availability.test.ts` (mirroring `frontend/graphql/test/teachers/applicant-profile.test.ts`): authenticate as a certified teacher via `testClient`, run `myTeacherAvailability` → assert the projection; run `setTeacherAvailability(false)` → assert the wire result AND re-read via the query; assert the denial codes (`FORBIDDEN` for uncertified, `TEACHER_IN_ACTIVE_SESSION` for a started session, `TEACHER_NOT_FOUND` for a missing row) and the BFLA matrix (student/admin → FORBIDDEN, anonymous → UNAUTHORIZED).
  - Re-run the documents contract test (`frontend/graphql/sharedDocuments/teachers/teacher-availability.documents.test.ts`) and the repo-wide `frontend/graphql/sharedDocuments/documents.contract.test.ts` in the same pass.
  - Run via `bun run test/scripts/run-test.ts frontend/graphql/test/teachers/teacher-availability.test.ts`.
  - Instructions: `frontend/graphql/test/AGENTS.md` + `.agents/instructions/tests.instructions.md`.
  - _Requirements: REQ-063, REQ-070, REQ-030, REQ-031, REQ-034_
  - [ ] 4.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts frontend/graphql/test/teachers/teacher-availability.test.ts --lifecycle duplicates` (exit 0).
  - [ ] 4.3.TE **Test Engineering:** real role tokens (no monkey-patched permissions); cover happy, denial, boundary (toggle toggled twice), and anonymous probe tiers.
  - [ ] 4.3.SEC **Security & Tenancy Audit:** assert exact `extensions.code` values and the absence of leaked identifiers in denial payloads (oracle-safety).
  - [ ] 4.3.SR **Semantic Review:** no backend service direct-import (API-driving integration only); harness matches sibling frontend GraphQL suites.
  - [ ] 4.3.IV **Instruction Verification:** validate against `frontend/graphql/test/AGENTS.md` + `.agents/instructions/tests.instructions.md`.

---

## Phase 5: Integration & Differential Testing

### 5.1 Workflow Journey Test — `teacher-availability.journey.test.ts`

- [ ] 5.1 [Author the cross-actor journey (TEST-FIRST: write it against the FINAL service signatures from task 2.1 and confirm it fails RED before the service body lands; finalize GREEN here)]
  - CREATE `test/workflows/teachers/teacher-availability.journey.test.ts` — ONE file for the INV-A1 + INV-A2 cross-actor flow. Actors: certified teacher **T**, uncertified teacher **U** (a `teacher` row PRESENT with `isApproved=false`, created via `createTestTeacherRow` at `backend/db/test/entity-setup.ts:550`), student **S** (to drive a real session), observer teacher **V**. The INV-A1 assertion MUST use this present-but-uncertified row — NEVER an absent id (an absent id is the 404 probe in step 7).
  - Harness: committed fixtures in ONE `beforeAll` committing `db.transaction` via `provisionCertifiedTeacherActor` (`test/workflows/helpers/actor-context.ts:105-116`) + `buildSessionJourneyCast` (`test/workflows/helpers/session-cast.ts:280`) + `TrackedFixtures`; hard-delete in `afterAll` in FK-safe order (session → teacher → users) with `verifyAllAbsent` zero-residue re-probes. NO `runInRollback` around service calls (services spawn their own transactions).
  - Express each requirement step as `actor → action → expected shared-state change`, calling REAL services (NO GraphQL, NO monkey-patched permissions):
    1. `TeacherAvailabilityService.getAvailability(T.userId, "en")` → `{ id: T.userId, isOnline: false, isApproved: true }`.
    2. `setAvailability(T.userId, true, "en")` → `isOnline: true`; DB re-read confirms `teacher.is_online = true` (INV-A1 happy path, FR-4.1).
    3. `setAvailability(T.userId, false, "en")` → `isOnline: false`; always allowed (REQ-012).
    4. Denial probe A (INV-A1): `setAvailability(U.userId, true, "en")` → `FORBIDDEN` (403), `teacher.is_online` stays `false` for U (REQ-093), where U is the explicit `isApproved=false` row from the fixtures.
    5. Denial probe B: create + `SessionLifecycleService.startSession(T.userId, sessionId, "en")` (a `started` session ⇒ INV-S6 lock drives `teacher.is_online = false`) → `setAvailability(T.userId, true, "en")` throws `TEACHER_IN_ACTIVE_SESSION` (409) with NO session id in the error (INV-A2, REQ-093/REQ-034); `teacher.is_online` stays `false`.
    6. Isolation invariance: V's `teacher.is_online` is UNCHANGED by every T/U step (BOLA invariance, REQ-031).
    7. Denial probe C (NOT-FOUND): `setAvailability(<absent-id>, true, "en")` → `TEACHER_NOT_FOUND` (404); hostile ids (`0`, `-1`, `NaN`) → `VALIDATION` pre-DB with ZERO writes.
  - Run (expected RED before 2.1; GREEN after): `bun run test/scripts/run-test.ts test/workflows/teachers/teacher-availability.journey.test.ts`.
  - Instructions: `.agents/instructions/tests.instructions.md`, `test/workflows/AGENTS.md`, `docs/testing/workflow-journey-tests.md`.
  - _Requirements: REQ-072, REQ-073, REQ-090, REQ-091, REQ-092, REQ-093, REQ-094, REQ-095, REQ-011, REQ-012, REQ-014, REQ-015_
  - [ ] 5.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts test/workflows/teachers/teacher-availability.journey.test.ts --lifecycle duplicates` (exit 0).
  - [ ] 5.1.TE **Test Engineering:** the journey IS the cross-actor tier — assert shared-state transitions after every actor step, cross-actor (observer) invariance, both denial paths, and the order of gates (cert before session); map each REQ-090..093 clause 1:1 to assertive `it` blocks.
  - [ ] 5.1.SEC **Security & Tenancy Audit:** observer invariance (V untouched) is the honest BOLA proof; the INV-A2 denial payload carries NO session id (oracle-safety).
  - [ ] 5.1.SR **Semantic Review:** zero `runInRollback`; zero `console.*`; fixtures committed-and-tracked; assertions on REAL row state (DB re-reads), never on returned objects alone.
  - [ ] 5.1.IV **Instruction Verification:** validate against `test/workflows/AGENTS.md` + `.agents/instructions/tests.instructions.md` + `docs/testing/workflow-journey-tests.md`.

### 5.2 `setOnline` Repository Coverage Extension

- [ ] 5.2 [Extend the existing repo suite — never duplicate it]
  - EXTEND the existing `describe("TeacherRepository.setOnline …")` block in `backend/db/test/repo/teachers/teacher.repository.test.ts:393+` (do NOT create a new file): add cases for same-value idempotency (`false`→`false`, `true`→`true` returns the row with stable `is_online`), zero-row `null` (unknown id), nullable-column coercion (a row forced `is_online = NULL` → `setOnline(true)` writes cleanly), and `updated_at` advancement. All inside `runInRollback` with `tx` propagated.
  - Run via `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/teacher.repository.test.ts`.
  - Instructions: `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`, `backend/db/test/AGENTS.md`.
  - _Requirements: REQ-070, REQ-074, REQ-043_
  - [ ] 5.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/db/test/repo/teachers/teacher.repository.test.ts --lifecycle duplicates` (exit 0).
  - [ ] 5.2.TE **Test Engineering:** 100% statement/branch retained on the touched repo file; boundary (null column), chaos (concurrent same-row updates within the tx), security (parameterized id only).
  - [ ] 5.2.SEC **Security & Tenancy Audit:** confirm the write remains a single parameterized `UPDATE … WHERE id = $1` with no LIKE/scan surface; `id` is server-derived at every caller.
  - [ ] 5.2.SR **Semantic Review:** `tx` required and propagated; no `db`-handle mixing; no dead branches.
  - [ ] 5.2.IV **Instruction Verification:** validate against `backend/db/test/AGENTS.md` + `.agents/instructions/tests.instructions.md`.

### 5.3 Security Probes & Cross-Surface Locks

- [ ] 5.3 [Adversarial + grep-lock verification across the whole change set]
  - **Grep-locks (must hold):** no `is_online` / `setOnline` write outside `teacher.repository.ts` + `teacher-availability.service.ts`; no `TEACHER_NOT_CERTIFIED` emitted by the availability path (INV-A1 uses `FORBIDDEN` — D3); no `session` id token in any availability error/log; no `console.*` in any touched file; `next-intl` / `shared/messages/` / `getBackendTranslations` / `Translation.` absent.
  - **Schema locks:** `git diff backend/db/schema/** backend/db/migration/**` EMPTY; `git diff backend/lib/gateway/public-operations.ts` EMPTY.
  - **BOPLA spread-scan:** confirm no `...input` / `...row` spread into `setOnline` or the return projection (REQ-032).
  - **Oracle probe:** drive the INV-A2 denial and confirm the serialized error text contains no session identifier (REQ-034).
  - Record the probe transcript in `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/outcome/5.3-security-probes-outcome.md`.
  - _Requirements: REQ-030, REQ-031, REQ-032, REQ-033, REQ-034, REQ-016, REQ-043_
  - [ ] 5.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts` over EVERY file created/modified in this ticket (exit 0 each).
  - [ ] 5.3.TE **Test Engineering:** convert each probe into a permanent assertion where feasible (grep-locks live as test assertions in `backend/graphql/test/` or the journey); no probe remains manual-only.
  - [ ] 5.3.SEC **Security & Tenancy Audit:** BOLA (server-derived id), BOPLA (boolean-only, field-mapped), BFLA (role scope + service certification), PII/oracle (bounded logs, no session id) — each evidenced.
  - [ ] 5.3.SR **Semantic Review:** confirm the "one bounded log per denial, silence on success" rule holds across the service + reused gate.
  - [ ] 5.3.IV **Instruction Verification:** validate against root `AGENTS.md` + `.agents/instructions/*`.

---

## Phase 6: Post-Implementation Review Waves

> Waves run in parallel where possible; every finding is fixed in-flight or recorded as a ✅ resolved-pointer ledger entry.

- [ ] 6.1 [review-types wave] — Audit canonical-type discipline: `TeacherAvailabilityReturnType` is the ONLY additive type; `TeacherAvailabilitySnapshotContract` (`backend/types/contracts/teacher-availability.contract.types.ts:27`) is UNCHANGED and not aliased; no local types in service/repo/resolvers/frontend; enum VALUE imports at runtime; contracts conformance suite green UNEDITED. Outcome: `outcome/6.1-review-types-outcome.md`. _Requirements: REQ-002, REQ-003_
- [ ] 6.2 [review-backend wave] — Audit: single writer via `TeacherRepository.setOnline` only; ONE `withTransaction` composing lock + gate + write; gate ORDER (INV-A1 before INV-A2 on the `true` path; neither on the `false` path); error taxonomy (`FORBIDDEN`/`TEACHER_IN_ACTIVE_SESSION`/`TEACHER_NOT_FOUND`/`VALIDATION`); ONE-log-per-denial + silence on success; no module-level mutable state. Outcome: `outcome/6.2-review-backend-outcome.md`. _Requirements: REQ-010..REQ-018, REQ-040..REQ-053_
- [ ] 6.3 [review-graphql-frontend wave] — Audit: both root fields declare the `$all` teacher scope; identity from `ctx.user.id` only; SDL/codegen artifacts committed with the registrations (gateway Rule 8.5); schema-surface + sdl-static-assertions inventories updated; allowlist-coverage + public-operations untouched; the card adds no route/nav; MUI v9 `sx`-only, no hardcoded colors, RTL-safe; error copy via namespaces (never server `message`). Outcome: `outcome/6.3-review-graphql-frontend-outcome.md`. _Requirements: REQ-060..REQ-063, REQ-030, REQ-031_
- [ ] 6.4 [pentester wave] — Adversarial audit: confirm the INV-A1 generic-`FORBIDDEN` decision cannot be abused (no info leak beyond certification state); attempt BOLA/recipient smuggling scenarios mentally against the `ctx.user.id` derivation; BOPLA spread-scan; hostile-id pre-DB rejection; confirm denial payloads carry no session id; document the INV-A4 never-resurrect hazard honestly. Outcome: `outcome/6.4-pentester-outcome.md`. _Requirements: REQ-030..REQ-034, REQ-042_
- [ ] 6.5 [ledger & hygiene wave] — `find . -name "*.orig" -o -name "*.rej" -o -name "*.bak"` EMPTY under the ticket's touched paths; every outcome file present for tasks 0.1→6.4; ledger re-grep = 0 ❌/⚠️. Outcome: `outcome/6.5-ledger-hygiene-outcome.md`. _Requirements: REQ-075, REQ-082_

---

## Phase 7: Knowledge Propagation & Documentation

- [ ] 7.1 [Canonical documentation]
  - CREATE `docs/teachers/teacher-availability.md` (the `docs/teachers/` dir exists — verified) with the mandated structure: **Why** → **Pattern** (the toggle operation table: query `myTeacherAvailability` → `getAvailability`; mutation `setTeacherAvailability(isOnline: Boolean!)` → `setAvailability`; the ordered gate pipeline INV-A1 → INV-A2 → `setOnline`) → **Rules** (service composes WHEN; the repo primitive is an unconditional guarded write; certify-before-session gate order; `ForbiddenError` = 403 for INV-A1 vs `ConflictError` = 409 for INV-A2; server-derived actor id; one bounded log per denial) → **What NOT to Do** (never write `is_online` outside `setOnline`; never trust a client-supplied teacher id; never spread input into the write; never disclose a session id; never add a custom code expecting HTTP 403) → **Rollout Summary** (created/modified file table) → **Forward Consumption Contract** (INV-A3 directory & INV-A4 release-gate pointers) → **Related Documents** (`docs/specs/state-machine-invariants.md` INV-A1..A4; `docs/sessions/session-lifecycle.md`).
  - UPDATE `docs/specs/state-machine-invariants.md` ONLY with a ONE-LINE shipped-pointer on INV-A1/INV-A2 (NO structural edit) noting the toggle writes through `TeacherAvailabilityService`; `INV-A3`/`INV-A4` remain owned by their tickets.
  - Write `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/outcome/7.1-outcome.md`.
  - _Requirements: REQ-080, REQ-081_
- [ ] 7.2 [Docs-only propagation & skill reference]
  - NO `AGENTS.md` and NO `.agents/instructions/*.md` file is edited (hand-curated; REQ-083). The canonical doc `docs/teachers/teacher-availability.md` (task 7.1) IS the knowledge home — do not duplicate its rules into any AGENTS.md.
  - Add a one-line shipped-pointer to `docs/specs/state-machine-invariants.md` (INV-A1/INV-A2) and, if it adds clarity, to `docs/sessions/session-lifecycle.md:169-171` / `:81` (NO structural edit).
  - If `.agents/skills/` already states that skills get sections, add a reference line there only; otherwise leave `.agents/skills/` untouched. Do NOT edit any `AGENTS.md` or `.agents/instructions/*.md` file.
  - Write `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/outcome/7.2-outcome.md` recording the no-AGENTS-edit posture.
  - _Requirements: REQ-081, REQ-083_
- [ ] 7.3 [Outcome synthesis & ticket closeout]
  - Synthesize `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/outcome/FINAL-outcome.md`: a REQ-001→REQ-095 disposition table (met / deferred-as-resolved-pointer), the zero-drift evidence bundle (schema/migration diff empty, codegen artifact↔builder identity, freeze-suite greens), the baseline-vs-final lint/type numbers, and links to every task outcome.
  - Final gate re-verification: all checkboxes `[x]`; ledger `grep -cE '^\s*\|.*(❌|⚠️)' <deferred-items.md>` = 0; schema/migration diff empty; `backend/lib/gateway/public-operations.ts` byte-unchanged.
  - _Requirements: REQ-075, REQ-082, REQ-083_

---

## Domain-to-Docs Mapping

| Plan Domain | Canonical Doc Target | Owner Task |
|---|---|---|
| Teacher availability toggle (service + GraphQL + frontend) | `docs/teachers/teacher-availability.md` | 7.1 |
| State-machine invariants (INV-A1/INV-A2 shipped-pointer) | `docs/specs/state-machine-invariants.md` (one-line pointer) | 7.1 |
| Session lifecycle (INV-S6 lock/release cross-reference) | `docs/sessions/session-lifecycle.md` (unchanged; linked) | 7.1 |
| i18n namespace registration | `shared/AGENTS.md` (unchanged; pattern cited) | 1.2 |
| GraphQL schema/codegen artifact discipline | `backend/graphql/AGENTS.md` (Rule 8.5 cited) | 3.2 |

## Layer-to-Instructions Mapping

| Touched Layer / Path | AGENTS.md files | .agents/instructions files |
|---|---|---|
| Root | `/home/ahmed/Projects/kottaby_kottaby/AGENTS.md` | — |
| `backend/types/teachers/**` | `backend/types/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| `backend/services/teachers/**` | `backend/services/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| `backend/graphql/**` (pothos/query/mutation) | `backend/graphql/AGENTS.md`, `backend/graphql/pothos/AGENTS.md`, `backend/graphql/query/AGENTS.md`, `backend/graphql/mutation/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| `backend/db/test/repo/teachers/**` | `backend/db/test/AGENTS.md`, `backend/db/repo/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md`, `tests.instructions.md` |
| `shared/locale/**` | `shared/AGENTS.md`, `shared/locale/AGENTS.md` | (none) |
| `frontend/graphql/sharedDocuments/teachers/**` | `frontend/graphql/sharedDocuments/AGENTS.md`, `frontend/graphql/AGENTS.md`, `frontend/AGENTS.md` | `frontend.instructions.md` |
| `frontend/graphql/test/teachers/**` | `frontend/graphql/test/AGENTS.md`, `frontend/graphql/AGENTS.md`, `frontend/AGENTS.md` | `frontend.instructions.md`, `tests.instructions.md` |
| `frontend/views/teachers/dashboard/**`, `frontend/views/dashboard/home/**` | `frontend/views/AGENTS.md`, `frontend/AGENTS.md` | `frontend.instructions.md` |
| `frontend/providers/apollo/**` | `frontend/AGENTS.md` | `frontend.instructions.md` |
| `test/workflows/teachers/**` | `test/workflows/AGENTS.md` | `tests.instructions.md` |

> `scripts/health/sub-loop.ts` auto-discovers and prints the exact applicable `AGENTS.md` + `.agents/instructions` set for each target path — the X.Y.IV subtask reads and validates against the printed set.

## Requirement Coverage Index (task → locked REQ IDs)

| Task | Primary REQ IDs |
|---|---|
| 0.1 | REQ-001 |
| 0.2 | REQ-004, REQ-016, REQ-018 |
| 0.3 | REQ-004 |
| 1.1 | REQ-003, REQ-013, REQ-016 |
| 1.2 | REQ-002, REQ-052 |
| 1.3 | REQ-051, REQ-052, REQ-030 |
| 2.1 | REQ-010..REQ-018, REQ-030..REQ-033, REQ-040..REQ-043, REQ-050..REQ-053 |
| 2.2 | REQ-070, REQ-071, REQ-074, REQ-075 |
| 2.M | REQ-040, REQ-041, REQ-043, REQ-053, REQ-075 |
| 3.1 | REQ-030, REQ-031, REQ-032, REQ-060, REQ-061 |
| 3.2 | REQ-016, REQ-060, REQ-062 |
| 3.3 | REQ-030, REQ-031, REQ-034, REQ-060, REQ-070 |
| 4.1 | REQ-060, REQ-063 |
| 4.2 | REQ-030, REQ-052, REQ-063 |
| 4.3 | REQ-030, REQ-031, REQ-034, REQ-063, REQ-070 |
| 5.1 | REQ-011, REQ-012, REQ-014, REQ-015, REQ-072, REQ-073, REQ-090..REQ-095 |
| 5.1 (test-runner discipline) | REQ-073 |
| 5.1 (J-AV-5) | REQ-094 |
| 5.1 (J-AV-6) | REQ-095 |
| 5.2 | REQ-043, REQ-070, REQ-074 |
| 5.3 | REQ-016, REQ-030..REQ-034, REQ-043 |
| 6.1..6.5 | REQ-002, REQ-003, REQ-010..REQ-018, REQ-030..REQ-034, REQ-040..REQ-063, REQ-075, REQ-082 |
| 7.1 | REQ-080, REQ-081 |
| 7.2 | REQ-081, REQ-083 |
| 7.3 | REQ-075, REQ-082, REQ-083 |

## Deferred Items (resolved-pointer seed for `deferred-items.md`)

| Item | Pointer | Rationale |
|---|---|---|
| INV-A3 — appearance in the student-facing Available Teachers directory (DEF-2) | `docs/planning/TICKETS.md:1457` (On-Demand Matching, Dev3) + `:1509` (Teacher Directory Browse, Dev3) | The directory/read side is Dev3; this ticket writes the flag only (DEF-2). |
| INV-A4 — never-resurrect release gating on session conclusion (DEF-1) | `docs/planning/TICKETS.md:1338` (In-Session Locking, Blocked By this ticket) | Requires the session-lifecycle release transaction + a persisted prior-online marker that does not exist (`releaseTeacherInSessionLock` unconditionally sets `is_online=true` — `session-lifecycle.transitions.ts:249-250`) (DEF-1). |
| 15-min inactivity auto-offline (DEF-3) | `docs/planning/TICKETS.md:1298` (Blocked By this ticket) | Separate ticket; needs a heartbeat/`users.last_active_at` sweep (`backend/db/schema/users/users.ts:37`). |
| Cooldown lineage "Blocked By" (DEF-4) | `docs/planning/TICKETS.md:818` | Scheduling/lineage only — the cooldown machinery never writes `teacher.is_online` (DEF-4). |
| Optional `canSetAvailable` derived flag deferred (DEF-5) | This plan's `TeacherAvailabilityService` — intentionally NOT built | The minimal `TeacherAvailabilityReturnType { id; isOnline; isApproved }` is the pinned surface; eligibility is surfaced via the localized denial (DEF-5). |
| Gate docstring "FORBIDDEN-class" vs `ConflictError`/409 (DEF-6) | session-lifecycle enforcement owner (`session-lifecycle.enforcement.ts:186-188` vs `:212`) | Foreign-file doc drift; the CODE/409 is authoritative (D4) (DEF-6). |
