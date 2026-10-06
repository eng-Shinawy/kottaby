# Teacher Availability Toggle — Canonical Reference

**Domain:** Teachers / Manual availability toggle (Available ↔ Unavailable)
**Specs:** `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md` (INV-A1..A4)
**Sibling docs:** `docs/sessions/session-lifecycle.md` (the in-session lock/release writer — INV-S6, INV-A2 seam), `docs/teachers/applicant-lifecycle.md` (the certification surface whose result backs INV-A1), `docs/teachers/verification-plan-purchase.md` (the path that arms certification)
**Status:** Implemented and verified

This document is the canonical reference for the teacher-owned availability toggle: the manual `Available ↔ Unavailable` write that makes `teacher.is_online` truthful on the manual side. The two-state directory appearance (INV-A3) remains sibling-ticket work (§6.1); the never-resurrect release gating (INV-A4) has since SHIPPED — §6.2 keeps the hazard narrative this doc previously recorded and marks the fix. All layers (repository, service, GraphQL, locale, frontend, tests) MUST conform to the contracts described here. Code blocks are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

---

## 1. Why

`teacher.is_online` is the platform's excludability signal — the one column that decides whether a teacher's row is candidate for matching. Two writers compete for it:

| Writer | Trigger | Direction |
|---|---|---|
| The session lifecycle (INV-S6 lock/release) | A session enters `started` / exits `started` | Locks to `false` on enter (capturing the pre-lock intent into the `was_online_before_lock` marker); restores the marker's value on the last `started`-exit |
| The manual toggle (this surface) | The teacher taps the dashboard card | Either direction, gated |

Before this surface shipped, the manual side had NO writer. The teacher dashboard could not flip `is_online`, so the column was driven exclusively by session lifecycle transitions — a teacher who finished a session and stayed online could not turn the flag off, and an uncertified teacher had no way to assert "I am not available" themselves. The toggle closes that gap.

The toggle's business reason, then, is **manual truthfulness on the `is_online` flag**: the teacher themselves is empowered to assert "I am available" (subject to certification + in-session gates) or "I am unavailable" (always allowed), and the column stops being a side-effect of session state alone. Two state-machine invariants land on this surface:

- **INV-A1** — only certified teachers (`is_approved = true`) can set Available. Enforced as a 403 `FORBIDDEN` here (NOT the booking/rubric `TEACHER_NOT_CERTIFIED` VALIDATION-class toast — a separate, conflicting taxonomy entry used elsewhere for a different operation).
- **INV-A2** — a teacher inside a `started` session is already offline (the lifecycle lock set the flag at session start); the toggle refuses to override the lock with a 409 `TEACHER_IN_ACTIVE_SESSION` conflict.

The Unavailable direction (`isOnline === false`) skips BOTH gates. An uncertified teacher may still go offline (INV-A1 is directional); a teacher inside a session is already offline by the lifecycle lock, so a re-assert of Unavailable is a no-op idempotent write (INV-A2 is directional).

---

## 2. Pattern

The toggle exposes exactly two GraphQL operations, each delegating to one service method, each method composing the gate pipeline before the guarded repo write (direction-guarded on Available — §3.1).

### 2.1 The toggle operation table

| GraphQL operation | Service method | Direction | Gate pipeline (ordered) | Repo primitive |
|---|---|---|---|---|
| `myTeacherAvailability: TeacherAvailabilityState!` (zero-arg, teacher-role-gated) | `TeacherAvailabilityService.getAvailability(ctx.user.id, ctx.locale)` | Read | Pre-DB shape guard → `TeacherRepository.findById` → field-by-field projection | `TeacherRepository.findById` (read-only) |
| `setTeacherAvailability(isOnline: Boolean!): TeacherAvailabilityState!` (one arg, teacher-role-gated) | `TeacherAvailabilityService.setAvailability(ctx.user.id, args.isOnline, ctx.locale)` | Write — Available (`true`) | Pre-DB shape guard → `lockForCertificationCheck` → **INV-A1** (cert gate) → **INV-A2** (in-session gate) → `setAvailabilityIntent` | `TeacherRepository.setAvailabilityIntent` (direction-guarded guarded `UPDATE … RETURNING` — zero rows while a `started` session exists ⇒ the service's 409 backstop; the race itself is serialized by the `lockForCertificationCheck` FOR UPDATE row lock — §3.1) |
| `setTeacherAvailability(isOnline: Boolean!): TeacherAvailabilityState!` (one arg, teacher-role-gated) | `TeacherAvailabilityService.setAvailability(ctx.user.id, args.isOnline, ctx.locale)` | Write — Unavailable (`false`) | Pre-DB shape guard → `lockForCertificationCheck` → `setAvailabilityIntent` (NO cert gate; NO in-session gate) | `TeacherRepository.setAvailabilityIntent` (same primitive — the third writer of the availability trio) |

The object type returned by both operations is `TeacherAvailabilityState { id: Int!, isOnline: Boolean!, isApproved: Boolean! }` — a closed three-field whitelist backed by `TeacherAvailabilityReturnType` (`backend/types/teachers/teacher.types.ts`).

### 2.2 The ordered gate pipeline (Available direction)

```
mutation setTeacherAvailability(isOnline: true)
  │
  ├── 0. authScopes: $all { authenticated: true, role: [UserRole.Teacher] }
  │      (anonymous → 401 UNAUTHORIZED; authenticated non-teacher → 403 FORBIDDEN)
  │
  ├── 1. ctx.user.id derivation (BOLA — NO client-supplied id argument)
  │
  ├── 2. TeacherAvailabilityService.setAvailability(teacherId, isOnline=true, locale, tx?)
  │      │
  │      ├── 2a. Pre-DB shape guard: Number.isSafeInteger(teacherId) && teacherId > 0
  │      │        else ValidationError (code VALIDATION, HTTP 422) — ZERO DB reads
  │      │
  │      ├── 2b. withTransaction(tx, async innerTx => …)  ← joins caller's outer tx via SAVEPOINT
  │      │      │
  │      │      ├── 2c. TeacherRepository.lockForCertificationCheck(teacherId, innerTx)
  │      │      │        (row-level FOR UPDATE lock; null → NotFoundError 404)
  │      │      │
  │      │      ├── 2d. INV-A1: if (locked.isApproved !== true)
  │      │      │        → ForbiddenError (code FORBIDDEN, HTTP 403)
  │      │      │        → ONE bounded log { code, entity, entityId, locale }
  │      │      │
  │      │      ├── 2e. INV-A2: assertTeacherNotInActiveSession(teacherId, innerTx, t)
  │      │      │        (reused seam — backend/services/classes/session-lifecycle.enforcement.ts)
  │      │      │        → ConflictError (code TEACHER_IN_ACTIVE_SESSION, HTTP 409)
  │      │      │        → ONE bounded log (OWNED by the seam; the service adds NO duplicate log)
  │      │      │
  │      │      └── 2f. TeacherRepository.setAvailabilityIntent(teacherId, true, innerTx)
  │      │                (direction-guarded guarded UPDATE … RETURNING — zero rows while
  │      │                 a `started` session exists: the 409 backstop — defense-in-depth
  │      │                 behind 2c's FOR UPDATE row lock, not an independent race-closer)
  │      │                (null → NotFoundError 404 — honest zero-row guard)
  │      │
  │      └── 2g. return { id, isOnline, isApproved }  (field-by-field projection, NO spread)
```

The Available direction takes the full pipeline. The Unavailable direction (`isOnline === false`) skips steps 2d and 2e — both gates are directional. Same-value writes (e.g. `true → true`) are idempotent by construction: the guarded `UPDATE … RETURNING` writes the same value, the row is returned, and the projection reflects the post-write snapshot.

### 2.3 The two-writer serialization

The session lifecycle writers (INV-S6 lock composed into `startSession` — `session-lifecycle.service.ts:282` via `TeacherRepository.acquireInSessionLock`; release at `releaseTeacherInSessionLock`, `session-lifecycle.transitions.ts:265`) and the manual toggle writer (this surface) all touch `teacher.is_online` — three repo primitives, one column. They NEVER cross. The toggle composes its `lockForCertificationCheck` (`FOR UPDATE`) inside the same `withTransaction` as the gate read and the write, so a session-lifecycle transition that holds the row lock blocks the toggle's lock attempt until the lifecycle's transaction commits — and vice versa. The in-session gate (INV-A2) is the second layer of defense: even if a toggle reads the row before the lifecycle locks it, the gate's `assertTeacherNotInActiveSession` re-checks the session table inside the held lock and refuses the Available direction with a 409.

---

## 3. Rules

### 3.1 The service composes WHEN to call the write; the repo primitive is a direction-guarded, marker-aware guarded write

`TeacherRepository.setAvailabilityIntent(id, online, tx)` (`backend/db/repo/teachers/teacher.repository.ts:752`) is ONE guarded `UPDATE teachers SET is_online = $online, was_online_before_lock = CASE WHEN … END, updated_at = now() WHERE id = $id AND ($online = false OR NOT EXISTS (… started …)) RETURNING …` write. It performs NO certification lookups and does not log — but it is not a bare boolean flip: the SET clause keeps the in-session lock marker coherent (while a lock is held the marker is OVERWRITTEN with the new intent — a mid-session Unavailable converges the restore-truth so a concluding session can never resurrect the teacher; with no lock held the marker stays `NULL`), and the WHERE clause carries the direction guard — on the Available direction it matches zero rows whenever a `started` session exists, which the service maps to the same `TEACHER_IN_ACTIVE_SESSION` 409 the seam gate raises (`backend/services/teachers/teacher-availability.service.ts:258` for the intent write, `:259-283` for the zero-row → 409 mapping — ConflictError at `:277`).

The direction guard is a defense-in-depth predicate, NOT the mechanism that closes the toggle-vs-start race. That serialization is the `lockForCertificationCheck` FOR UPDATE teacher-row lock (`backend/services/teachers/teacher-availability.service.ts:215`): the service takes it at the head of the pipeline and holds it across the whole toggle transaction, so a concurrent session-start's acquire waits on the row lock while the INV-A2 gate re-checks the session table inside it. The guard's zero-row → conflict mapping is the backstop behind that lock (this service is the intent write's sole caller) — never an independent race-closer.

`TeacherAvailabilityService.setAvailability` is the composition seam that decides WHETHER the write fires:

- The pre-DB shape guard runs first — a malformed id never reaches SQL.
- `lockForCertificationCheck` takes the row lock and returns the row's `isApproved` flag — the certification gate reads the locked value (no TOCTOU window between the read and the write).
- INV-A1 and INV-A2 run on the Available direction only — the gates fire AFTER the lock and BEFORE the write, inside the same transaction.
- The Unavailable direction skips both gates and goes straight to `setAvailabilityIntent`.

The service is the ONLY writer on the manual path. The repo primitive exists to be composed — never call `setAvailabilityIntent` without the service, and never re-implement the gate pipeline inside another service. The column's other two writers are the session lifecycle's `acquireInSessionLock` / `releaseInSessionLock` (`docs/sessions/session-lifecycle.md` §2.3).

### 3.2 Certify-before-session gate order

On the Available direction, INV-A1 (certification) runs BEFORE INV-A2 (in-session). This is load-bearing: a non-certified teacher who also happens to be in a `started` session sees the certification denial (`FORBIDDEN` / 403), NOT the in-session conflict (`TEACHER_IN_ACTIVE_SESSION` / 409). The certification state is the more fundamental blocker — a teacher who has not completed evaluation cannot be Available regardless of their session state.

The Unavailable direction skips both gates. INV-A1 is directional ("only certified teachers can set Available" says nothing about Unavailable); INV-A2 is directional (a teacher in a session is already offline, so re-asserting Unavailable is a no-op idempotent write that the lifecycle's lock permits).

### 3.3 Error code discipline — 403 vs 409 vs the booking taxonomy

| Denial | HTTP | `extensions.code` | Localization key | Source |
|---|---|---|---|---|
| Certification gate (INV-A1) | 403 | `FORBIDDEN` | `errors.teacherNotCertified` | `TeacherAvailabilityService` |
| In-session gate (INV-A2) | 409 | `TEACHER_IN_ACTIVE_SESSION` | `errors.teacherInActiveSession` | `assertTeacherNotInActiveSession` seam (reused) |
| Teacher row missing (post-lock, post-write zero-row guard) | 404 | `TEACHER_NOT_FOUND` | `errors.teacherNotFound` | `TeacherAvailabilityService` |
| Malformed input (pre-DB shape guard) | 422 | `VALIDATION` | `errors.validation` | `TeacherAvailabilityService` |

The certification denial uses the **generic `FORBIDDEN`** code (the 403 taxonomy entry used across the platform for permission denials). It does NOT use the `TEACHER_NOT_CERTIFIED` VALIDATION-class code that appears in the booking/rubric surfaces — those are a different operation's denial taxonomy, and reusing the booking toast for the manual toggle would surface a misleading copy. The `errors.teacherNotCertified` localization key resolves to copy that says the teacher cannot set Available because certification has not been completed — distinct from the booking flow's "this evaluation session cannot be booked because the teacher is not certified."

The in-session denial uses `TEACHER_IN_ACTIVE_SESSION` (409 conflict, not 403 forbidden — the teacher is NOT forbidden from toggling, they are in a transient state where the Available direction conflicts with the lifecycle's lock). The 409 is the contract: a 403 would imply a permission gap that "completing certification" or "being granted a role" could close, but the only way to close a 409 is for the session to leave the `started` state. The frontend's `error-link.map.ts` carries a dedicated `mapAvailabilityRow` that surfaces this 409 as the inline `inSessionLockedHint` notice (NOT a generic permission toast).

### 3.4 Server-derived actor id (BOLA)

The actor id is derived server-side from the verified access token (`ctx.user.id`), never from a client-supplied argument. Both the query (`myTeacherAvailability`) and the mutation (`setTeacherAvailability`) take ZERO id arguments — the GraphQL field signatures carry NO `teacherId` parameter:

```graphql
query { myTeacherAvailability: TeacherAvailabilityState! }
mutation { setTeacherAvailability(isOnline: Boolean!): TeacherAvailabilityState! }
```

The resolver (`backend/graphql/query/teachers/teacher-availability.query.ts` and `backend/graphql/mutation/teachers/teacher-availability.mutation.ts`) is a thin delegation layer: it narrows `ctx.user` to non-null (the `authScopes` conjunction guarantees a verified user), then calls `TeacherAvailabilityService.getAvailability(ctx.user.id, ctx.locale)` or `TeacherAvailabilityService.setAvailability(ctx.user.id, args.isOnline, ctx.locale)`. The service receives the id as a parameter — but the parameter is the server-derived value, not a client-controlled input. A malicious client CANNOT supply a foreign teacher id through the GraphQL surface; there is no field for it.

### 3.5 One bounded log per denial; zero on the happy path

The happy path emits NOTHING — no log line on a successful toggle. Each service-owned denial (certification gate, not-found, post-write zero-row guard) emits exactly ONE bounded `logger.logDomainError(message, ctx)` call carrying the four-key context `{ code, entity, entityId, locale }` ONLY:

- `code` — the `extensions.code` string (e.g. `"FORBIDDEN"`, `"TEACHER_NOT_FOUND"`).
- `entity` — the domain entity string (`"teacher"`).
- `entityId` — the teacher's numeric id (the server-derived `ctx.user.id`).
- `locale` — the active request locale (for cross-correlation with the localized denial copy).

The log context NEVER includes the submitted payload (the boolean), NEVER the teacher's name/email/phone, NEVER the session id, NEVER the raw error message. The reused in-session gate (`assertTeacherNotInActiveSession`) owns its OWN bounded log call — the service consumes the gate verbatim and adds NO duplicate log for the gate's denial. This is the "one bounded log per denial" rule: each denial has exactly one log owner, and the owner is the layer that owns the denial's decision.

### 3.6 The closed three-field projection (BOPLA)

The mutation's input surface is a single non-nullable `Boolean!` argument — no input type, no spread, no row passthrough. The query's input surface is zero arguments. The return projection is the strict three-field whitelist:

```ts
interface TeacherAvailabilityReturnType {
  readonly id: number;
  readonly isOnline: boolean;
  readonly isApproved: boolean;
}
```

No PII (no name, email, phone), no governance fields (no `suspended`, `is_blocked`), no rating, no subjects, no timestamps. The nullable DB columns (`is_online`, `is_approved`) are coerced to total booleans at the service boundary — a stored `null` reads as `false` for both flags. The projection is built field-by-field via the module-private `toAvailabilityReturnType` helper (NEVER a spread of the raw row), so adding a new column to the `teacher` table cannot leak into the projection without an explicit code change here.

### 3.7 Transaction composition — caller's outer tx is joined, never bypassed

`setAvailability(teacherId, isOnline, locale, tx?)` accepts an optional `DBTransaction` as the LAST parameter. Inside the method, `withTransaction(tx, async innerTx => …)` joins the caller's outer transaction via a SAVEPOINT when `tx` is provided, or starts a new top-level transaction when `tx` is `undefined`. The global `db` handle is NEVER touched inside the write path — every read (`lockForCertificationCheck`), every gate (`assertTeacherNotInActiveSession`), and every write (`setAvailabilityIntent`) takes the `innerTx` argument. This is the single-writer composition discipline: the service composes WHEN to flip, and the composition is transactional.

### 3.8 Role scope — the `$all` conjunction (BFLA)

Both root fields declare `authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }`. The explicit `$all` conjunction is load-bearing: a plain `{ authenticated: true, role: [...] }` map combines its keys with ANY semantics (Pothos scope-auth's `defaultStrategy: "any"`), so ANY authenticated caller would pass through the first satisfied scope and non-teachers would be granted access. The `$all` forces BOTH scope legs to evaluate: anonymous callers hit the `authenticated` scope's `UnauthorizedError` throw (401); authenticated non-teachers fail the `role` scope into the canonical localized `ForbiddenError` (403). The 401/403 split is pinned end-to-end on this surface.

---

## 4. What NOT to Do

### 4.1 Never write `is_online` outside the availability writer trio

The repo exposes exactly FOUR single-statement writers for the column — `acquireInSessionLock`, `releaseInSessionLock`, `setAvailabilityIntent`, and `sweepInactiveOnlineOnce` (all in `backend/db/repo/teachers/teacher.repository.ts` — `:460` / `:558` / `:685` / `:774`) — and every writer on the column composes through one of them. A service that "knows better" and writes `is_online` through `db.update(…)` directly bypasses the guarded `UPDATE … RETURNING` shape, the zero-row guard, and the `updated_at` stamping convention. (The retired `TeacherRepository.setOnline` primitive this section previously named — one unconditional guarded write shared by every writer — was split into the marker-gated lock trio when the in-session lock shipped, and joined by the sweep's batch primitive when the 15-minute inactivity auto-offline shipped; it no longer exists.)

### 4.2 Never trust a client-supplied teacher id

The mutation's ONLY variable is `$isOnline: Boolean!`. There is NO `$teacherId` variable, NO `id` argument on either root field. A future feature that "needs to set availability for another teacher" (e.g. an admin override surface) must NOT add a `teacherId` argument to this mutation — it must mint a separate, admin-role-gated operation with its OWN BOLA review. The server-derived `ctx.user.id` is the contract; widening it is a BOLA regression.

### 4.3 Never spread input into the write

`TeacherRepository.setAvailabilityIntent(teacherId, isOnline, tx)` takes a bare boolean — never an input object, never a `{...input}` spread. A "convenience" overload that accepts a row-shaped object and spreads it into the `UPDATE` would let a hostile client smuggle arbitrary column writes (`is_approved`, `average_rating`, `subjects`) through the same mutation. The boolean is the WHOLE write surface; the projection is built member-by-member via the `toAvailabilityReturnType` helper, never a spread of the raw row.

### 4.4 Never disclose a session id

The in-session gate denial (`TEACHER_IN_ACTIVE_SESSION` / 409) carries NO session id in its log context, NO session id in its error message, NO session id in its GraphQL error extensions. The bounded log context is `{ code, entity, entityId, locale }` — the `entityId` is the TEACHER's id (the server-derived actor), never the session's id. A denial that leaked "you are in session #12345" would be an oracle: a hostile client could probe "is teacher X in a session right now?" by toggling Available and reading the denial. The gate's contract is "yes/no, no identifier."

### 4.5 Never add a custom error code expecting HTTP 403

The certification gate denial uses the platform's generic `FORBIDDEN` code (HTTP 403). It does NOT mint a `TEACHER_NOT_CERTIFIED_FOR_AVAILABILITY` or similar custom code — the frontend's error-link map dispatches `FORBIDDEN` to the generic permission toast (`mapPermissionRow`), and the inline `certificationRequiredHint` panel is driven by the query's `isApproved === false` field (the CLIENT pre-empt), NOT by the mutation's denial code. A custom 403 code would force the error-link map to carry a dedicated row for one operation's denial — the generic `FORBIDDEN` is the platform-wide 403 taxonomy entry, and the manual toggle reuses it verbatim. The only operation-specific code on this surface is `TEACHER_IN_ACTIVE_SESSION` (409), because that denial is operation-specific (a transient state conflict, not a permission gap).

### 4.6 Never re-implement the in-session gate

`assertTeacherNotInActiveSession` (the reused seam at `backend/services/classes/session-lifecycle.enforcement.ts`) is the platform's canonical "is this teacher in a started session?" check. It owns its OWN bounded log, its OWN error code (`TEACHER_IN_ACTIVE_SESSION`), and its OWN 409 mapping. The toggle service consumes it verbatim — it does NOT re-implement the session-state lookup, does NOT add a duplicate log, does NOT wrap the throw. A future "optimization" that inlines the session check inside the toggle service would duplicate the log ownership and break the "one bounded log per denial" rule.

### 4.7 Never treat the client-side disabled-state as a security boundary

The dashboard card disables the "Available" toggle when `isApproved === false` (the `certificationRequiredHint` panel renders). This is a UX pre-empt, NOT a security boundary — a stale client, a race, or a hostile client that bypasses the disabled-state still hits the server-side 403 `FORBIDDEN` + the generic permission toast. The disabled-state is the visual cue that the teacher has not completed certification; the security boundary is the server-side certification gate (INV-A1) inside `TeacherAvailabilityService.setAvailability`. Never replace the server gate with a client check.

---

## 5. Rollout Summary

The toggle shipped across the full stack in one additive changeset — zero schema/migration drift, zero gateway drift, zero locale-key drift on the reused `errors` namespace. The new `availability` locale namespace is the only minted locale surface.

### 5.1 Backend — service, types, repo tests

| Status | Path | Purpose |
|---|---|---|
| NEW | `backend/services/teachers/teacher-availability.service.ts` | The canonical service — `TeacherAvailabilityService` namespace with `getAvailability` + `setAvailability`; composes the gate pipeline. |
| NEW | `backend/services/teachers/teacher-availability.service.test.ts` | 4-Tier test suite (branch/boundary/chaos/security; 33 pass + 1 pglite-only skip). |
| MODIFIED (additive) | `backend/services/teachers/index.ts` | +1 barrel export for the new service. |
| MODIFIED (additive) | `backend/types/teachers/teacher.types.ts` | +`TeacherAvailabilityReturnType` interface (the canonical three-field projection). |
| NEW | `backend/types/teachers/teacher-availability.types.static-assertions.test.ts` | Static-assertion suite pinning the canonical type shape. |
| MODIFIED (additive) | `backend/db/test/repo/teachers/teacher.repository.test.ts` | +5 availability-writer coverage cases (timestamp advancement, idempotency, null coercion, chaos, parameterized-id source pin) — authored against the then-`setOnline` primitive, since retired; the suite now covers the four-writer map (acquire / release / intent / inactivity sweep). |

### 5.2 Backend — GraphQL resolvers + schema inventories

| Status | Path | Purpose |
|---|---|---|
| NEW | `backend/graphql/pothos/teachers/teacher-availability.pothos.ts` | `TeacherAvailabilityStatePothosObject` — the object type backed by `TeacherAvailabilityReturnType`. |
| NEW | `backend/graphql/query/teachers/teacher-availability.query.ts` | `myTeacherAvailability` query field — zero-arg, teacher-role-gated, identity from `ctx.user.id`. |
| NEW | `backend/graphql/mutation/teachers/teacher-availability.mutation.ts` | `setTeacherAvailability(isOnline: Boolean!)` mutation field — one-arg, teacher-role-gated. |
| NEW | `backend/graphql/mutation/teachers/index.ts` | Teachers-domain mutation sub-barrel. |
| MODIFIED (additive) | `backend/graphql/query/teachers/index.ts` | +1 side-effect import for the query. |
| MODIFIED (additive) | `backend/graphql/mutation/index.ts` | +1 side-effect import for the teachers mutation sub-barrel. |
| NEW | `backend/graphql/test/teacher-availability.integration.test.ts` | Wire-tier integration suite (denial matrix, BFLA, BOLA, BOPLA). |
| MODIFIED (additive) | `backend/graphql/test/schema-surface.test.ts` | +3 consts + the object-shape pin for the new schema surface. |
| MODIFIED (additive) | `backend/graphql/test/sdl-static-assertions.test.ts` | +1 entry each in `FROZEN_QUERY_FIELDS` / `FROZEN_MUTATION_FIELDS` (67→68 / 56→57). |

### 5.3 Frontend — documents, card, dashboard mount

| Status | Path | Purpose |
|---|---|---|
| NEW | `frontend/graphql/sharedDocuments/teachers/teacher-availability.documents.ts` | Two `TypedDocumentNode` exports (`myTeacherAvailabilityQueryDocument` + `setTeacherAvailabilityMutationDocument`). |
| NEW | `frontend/graphql/sharedDocuments/teachers/teacher-availability.documents.test.ts` | 10-test document-shape contract suite. |
| MODIFIED (additive) | `frontend/graphql/sharedDocuments/teachers/index.ts` | +1 barrel export. |
| REGENERATED | `frontend/graphql/generated/schema.graphql` | +3 SDL surface elements (query root, mutation root, object type). |
| REGENERATED | `frontend/graphql/generated/gql/graphql.ts` | +codegenerated types (`MyTeacherAvailabilityQuery`, `SetTeacherAvailabilityMutation`, etc.). |
| NEW | `frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx` | Zero-prop `"use client"` card — the dashboard surface. |
| NEW | `frontend/views/teachers/dashboard/TeacherAvailabilityShell.tsx` | Shell + chrome primitives (skeleton, load-error frame, status chip, settled card frame). |
| NEW | `frontend/views/teachers/dashboard/useTeacherAvailabilityToggle.ts` | Toggle write-path hook (mutation + outcome lanes). |
| MODIFIED (additive) | `frontend/views/teachers/dashboard/index.ts` | +1 barrel export for the card. |
| MODIFIED (additive) | `frontend/views/dashboard/home/RoleDashboardPage.tsx` | `<TeacherAvailabilityCard />` mounted FIRST in the teacher slot. |
| NEW | `frontend/stories/teachers/TeacherAvailabilityCard.stories.tsx` | 8-story Storybook matrix (4 spec-required + 4 value-add). |
| MODIFIED (additive) | `frontend/stories/pages/TeacherDashboard.stories.tsx` | Card added to the page-level composition. |
| NEW | `frontend/graphql/test/teachers/teacher-availability.test.ts` | Client-tier wire-boundary integration suite (18 cases). |
| MODIFIED (additive) | `frontend/providers/apollo/error-link.map.ts` | +`mapAvailabilityRow` (the `TEACHER_IN_ACTIVE_SESSION` → inline notice row). |
| MODIFIED (additive) | `frontend/providers/apollo/error-link.map.test.ts` | +coverage for the new row. |

### 5.4 Shared — locale namespace

| Status | Path | Purpose |
|---|---|---|
| NEW | `shared/locale/namespaces/availability/availability.namespace.ts` | The frozen 8-key `availability` namespace schema. |
| NEW | `shared/locale/namespaces/availability/index.ts` | Namespace barrel. |
| MODIFIED (additive) | `shared/locale/namespaces/index.ts`, `shared/locale/namespaces/registry.ts` | Namespace registration. |
| NEW | `shared/locale/en/availability/{index.ts,labels.ts}`, `shared/locale/ar/availability/{index.ts,labels.ts}` | EN + AR implementations of the 8 frozen keys. |
| MODIFIED (additive) | `shared/locale/en/messages.ts`, `shared/locale/ar/messages.ts` | Locale-message aggregation. |
| NEW | `shared/locale/types/availability/{index.ts,labels.ts}` | Compile-time type surface. |
| MODIFIED (additive) | `shared/locale/types/message.ts` | Message-type union. |
| NEW | `shared/locale/availability-namespace.parity.test.ts` | EN↔AR parity suite (34 pass). |

### 5.5 Workflow journey + canonical doc

| Status | Path | Purpose |
|---|---|---|
| NEW | `test/workflows/teachers/teacher-availability.journey.test.ts` | Cross-actor journey (7-step; happy path + INV-A1 denial + INV-A2 denial + BOLA observer invariance + hostile-id rejection). |
| NEW | `docs/teachers/teacher-availability.md` | This document. |
| MODIFIED (one-line pointer) | `docs/specs/state-machine-invariants.md` | One-line shipped-pointer on INV-A1/INV-A2 noting the toggle writes through `TeacherAvailabilityService`. |

### 5.6 Byte-unchanged (frozen) surfaces

- `backend/db/schema/**` and `backend/db/migration/**` — `teacher.is_online` column already exists; no schema or migration drift.
- `backend/lib/gateway/public-operations.ts` — the frozen-six anonymous-access allowlist; neither toggle operation is added (both are teacher-role-gated).
- `backend/services/classes/session-lifecycle.enforcement.ts` — the INV-A2 seam gate is consumed verbatim, never modified.
- `backend/services/classes/session-lifecycle.transitions.ts` — the INV-S6 lock/release writer is consumed verbatim (frozen at this changeset's ship time; the marker-gated release rework has since modified the release body — see §6.2).
- `frontend/views/dashboard/nav/navItems.ts` — no new route, no new nav entry (the card is a dashboard surface addition).
- `shared/locale/en/errors/*`, `shared/locale/ar/errors/*`, `shared/locale/types/errors/*` — the three reused `errors` keys (`teacherNotCertified`, `teacherInActiveSession`, `teacherNotFound`) are byte-identical; zero new `errors`-namespace key minted.

---

## 6. Forward Consumption Contract

Two state-machine invariants land on `teacher.is_online` beyond this surface's gates. INV-A3 (directory appearance) remains sibling-ticket work and is recorded below as a resolved-pointer deferral; INV-A4 (never-resurrect release gating) has since SHIPPED — §6.2 keeps the original hazard narrative and records the fix. The toggle makes `is_online` truthful on the manual side; the directory appearance consumes that truthfulness downstream.

### 6.1 INV-A3 — directory appearance / hiding

**Invariant:** A teacher in In-Session state is hidden from the Available Teachers directory for all other students.

**Status:** NOT enforced here — no student-facing Available Teachers directory exists in the tree at this milestone. This surface makes `is_online` truthful (INV-A1 + INV-A2 guarantee the flag reflects certification + session state); the directory filter that CONSUMES the flag is Dev 3 work.

**Owner tickets:**
- On-Demand Matching Algorithm (Filter/Sort Pipeline) — the matching layer that filters/sorts candidate teachers by `is_online`.
- Teacher Directory Browse & Filter API — the directory read surface.

**Forward contract:** when the directory ships, it MUST filter on `teacher.is_online = true` AND exclude any teacher whose row is locked by an active `started` session (the INV-A2 seam's `assertTeacherNotInActiveSession` is the canonical "is this teacher in a session?" oracle — the directory should reuse it, NOT re-implement a session-state lookup). The toggle's `is_online` flag is the necessary-but-not-sufficient signal: a teacher may be `is_online = true` AND in a `started` session if a race between the toggle and the lifecycle lock leaves the flag stale for a sub-second window. The directory's filter MUST compose `is_online = true` with the session-state check; it MUST NOT rely on `is_online` alone.

### 6.2 INV-A4 — never-resurrect release gating

**Invariant:** Upon session conclusion, the teacher's status returns to Available only if they are still active (app open).

**Status:** RESOLVED — the marker-gated release SHIPPED with the In-Session Locking changeset (the `was_online_before_lock` marker + the gated `releaseInSessionLock`). The historical narrative below is retained verbatim as the record of the hazard; the shipped fix follows it.

**Owner ticket:** In-Session Locking (Hide from Directory) — owned the release transaction; the fix is shipped.

**The hazard (historical — as this doc previously recorded it, pre-fix):** `releaseTeacherInSessionLock` (`backend/services/classes/session-lifecycle.transitions.ts:249-250`) calls `TeacherRepository.setOnline(teacherId, true, tx)` UNCONDITIONALLY on session exit — it restores `is_online = true` regardless of whether the teacher was Available before the session started. There is no persisted prior-online marker on the `teacher` table (the columns at `backend/db/schema/teachers/teacher.ts` carry `isOnline` only — no `wasOnlineBeforeLock`-style field), so the release path has no value to restore.

**Consequence (historical):** a teacher who toggled to Unavailable, then accepted a session, then had the session conclude, is resurrected to Available by the release path — contradicting their manual choice. This is the INV-A4 hazard.

**The shipped fix (load-bearing):** the persisted prior-online marker exists exactly as the forward contract below specified — the nullable `teacher.was_online_before_lock` column (`backend/db/schema/teachers/teacher.ts:36`). `TeacherRepository.acquireInSessionLock` captures it atomically at session start (`was_online_before_lock = COALESCE(marker, is_online)`, `is_online = false` — `backend/db/repo/teachers/teacher.repository.ts:527`), and `TeacherRepository.releaseInSessionLock` restores it on session exit (`is_online = was_online_before_lock`, marker cleared — `backend/db/repo/teachers/teacher.repository.ts:625`), gated by `marker IS NOT NULL AND NOT EXISTS (started session)`: the restore happens ONCE on the LAST `started`-exit (a concurrent second exit resolves `active_sessions_remain` and defers), a marker-less release resolves `no_lock_held` (a benign no-op that writes nothing — the cold-path classification read: `backend/db/repo/teachers/teacher.repository.ts:667`), and both marker values restore truthfully — `true` returns the teacher to Available, `false` keeps them Unavailable (never resurrected). The release OPENS with a `FOR UPDATE` serialization preamble on the teacher row (`backend/db/repo/teachers/teacher.repository.ts:638`), taken BEFORE the last-exit probe: concurrent releases of the same teacher serialize on that row lock, and the later release re-evaluates the last-started-exit guard under the lock against the fresh post-wait state — closing the double-defer strand (each exit classifying `active_sessions_remain` from its own pre-lock snapshot would strand the lock: marker set, zero `started` sessions). The preamble writes nothing: a classified no-op still leaves `is_online`, the marker and `updated_at` untouched. The release is composed on ALL FOUR terminal exits of a `started` session — teacher complete, participant cancel, arbitration resolve, and the admin-governance cancel (`backend/services/classes/session-admin-governance.helpers.ts:387`). Full release semantics: [`docs/sessions/session-lifecycle.md`](../sessions/session-lifecycle.md) §2.3.

**Forward contract (FULFILLED):** the sibling ticket has added the persisted prior-online marker (`was_online_before_lock` on `teacher`) and amended `releaseTeacherInSessionLock` to restore the marker's value instead of unconditionally setting `true`. The fix lives inside the release transaction — this surface does NOT patch it from the toggle path. The toggle's contract stands: "I set the flag truthfully at the moment of the write; I do not own what happens to the flag inside another writer's transaction."

### 6.3 15-minute inactivity auto-offline (shipped)

**Status:** SHIPPED — this section documents the implemented surface, NOT a forward contract. Unlike the two deferrals above, nothing here is owned by a sibling ticket.

**Behavior:** the sweep is the fourth writer on `teacher.is_online` (beside the lock capture, the marker-gated release, and the manual toggle): it flips online → offline when a teacher's recorded activity ages past the inactivity threshold. It closes the gap the manual toggle cannot close — a teacher whose client simply disappears (backgrounded tab, closed app, dropped connection) never taps Unavailable, and without the sweep the flag would read `true` indefinitely.

**Owner surface (all implemented):**

| Concern | Shipped implementation |
|---|---|
| Sweep service | `TeacherInactivityService.sweepInactiveTeachers(outerTx?)` — `backend/services/teachers/teacher-inactivity.service.ts` (ONE transaction, ONE captured `now`, the cutoff derived once from it, an honest `{ offlined }` return, and exactly ONE completion log line strictly after the transaction resolves — a rolled-back pass reports nothing) |
| Repo primitive | `TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx)` — `backend/db/repo/teachers/teacher.repository.ts` (LOCK-THEN-RECHECK: the candidate victims are pinned `FOR UPDATE`, then ONE guarded batch `UPDATE … RETURNING` re-runs the same predicates scoped to the pinned ids under the fresh snapshot — a confirmation stamp that commits while the locks are acquired spares the row; victim selection is predicate-only — no row-identity or client-supplied parameters; transaction REQUIRED) |
| Trigger | `GET /api/cron/sweep-inactive-teachers` — `app/api/cron/sweep-inactive-teachers/route.ts`, riding the shared `createCronSweepEndpoint` envelope (`backend/lib/gateway/cron-endpoint.ts`) and registered in `backend/lib/gateway/route-inventory.ts` |

**Threshold:** `TEACHER_INACTIVITY_TIMEOUT_MINUTES` (default 15) — resolved through the cached environment snapshot's typed getter `getTeacherInactivityTimeoutMinutes()` (`backend/lib/env.ts`; the resolved decision is recorded in `docs/specs/open-decisions-and-gaps.md` §B.15). A malformed, zero, or negative value falls back to the default and never throws — a bad operator value can neither disable the sweep nor hyper-accelerate it.

**Trigger cadence:** scheduling is EXTERNAL by doctrine — the repo ships no scheduler, no cron worker, and no `vercel.json`. Ops arms the route per the cron runbook pattern (`docs/billing/subscription-validity-window-expiry.md` §6: `CRON_EXECUTION_MODE=external` + `CRON_EXTERNAL_ENABLED=true`, kill switch = the latter; a missing or wrong bearer ⇒ 401, a disarmed mode ⇒ bare 404) and fires `GET` with `Authorization: Bearer ${CRON_SECRET}` at a cadence of **≤ 5 minutes**. The success payload is the honest count only — `{ offlined }` (identities never cross the cron boundary); an immediate replay returns `{ offlined: 0 }` because the guarded predicate is idempotent; a thrown failure is masked through the shared error envelope.

**Boundary semantics** (pinned at the repo, service, and journey test tiers):

- **Strict `<`:** activity exactly threshold-old is NOT swept — one second older is. A teacher inside the window survives every pass.
- **NULL ⇒ expired:** a NULL `last_active_at` (`backend/db/schema/users/users.ts:44` — the column is nullable by design) counts as expired: an online teacher with no recorded activity cannot be verified as recently active and IS swept.
- **In-session exemption:** `NOT EXISTS (started session)` — a teacher holding a `started` session is structurally never auto-offlined, even in the sub-second window where the lifecycle's own lock write has not yet landed. The session lock takes priority, unconditionally.
- **Confirmation owns the final state (lock-then-recheck):** the sweep pins its candidate victims `FOR UPDATE` first and re-runs the full predicate set — scoped to the pinned ids — under the fresh snapshot its UPDATE statement captures. A manual availability confirmation that commits while the pass is already mid-flight is therefore always honored: its stamp is either already visible to the re-check (the row is spared) or the confirmation is still blocked behind the sweep's lock and re-asserts Available on top of the flip. A single-statement UPDATE cannot promise this — PostgreSQL's EvalPlanQual re-check evaluates its cross-table EXISTS probes against the ORIGINAL statement snapshot, so a stamp committed during a lock wait would stay invisible.

**The activity model (heartbeat-as-API-call ruling):** "recent activity" is defined server-side and has three sources — authenticated GraphQL requests (the per-request stamp in the GraphQL context factory, `backend/graphql/gqlContextFactory.ts`, throttled through `UserRepository.updateLastActiveAtIfStale` so a request storm writes at most once per minute), explicit-intent stamps (the manual toggle writes a fresh `last_active_at` in the SAME transaction as `setAvailabilityIntent`, so a just-toggled teacher can never be swept by the same pass — and the sweep's lock-then-recheck keeps that guarantee even when a pass is already mid-flight behind the toggle's row lock), and login (a fire-and-forget bump). The client heartbeat is deliberately an ordinary authenticated API call, NOT a socket keepalive: the argless `recordMyActivity` mutation (`backend/graphql/mutation/user.mutation.ts` → `AuthService.recordMyActivity`) fires every 5 minutes while the document is visible via `useTeacherPresenceHeartbeat` (`frontend/hooks/presence/use-teacher-presence-heartbeat.ts`; exported cadence `TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS = 5 * 60_000`), mounted once for teachers in `DashboardLayout` (`frontend/views/dashboard/layout/DashboardLayout.tsx`). The 5-minute cadence is half the default threshold, so one missed beat is tolerated before the sweep can act. The WebSocket sidecar is untouched: it stays push-only and carries zero presence state (`docs/notifications/realtime-engine.md` — "never reuse the WS sidecar for presence").

**Self-heal interplay with the marker-gated release (§6.2):** the shipped `releaseTeacherInSessionLock` does NOT restore `is_online = true` unconditionally — it restores the availability intent captured at lock acquisition (`was_online_before_lock`) exactly once, on the last terminal exit, so a teacher who was offline before the session stays offline after it (the never-resurrect seed closes the unconditional-resurrect hazard INV-A4 at the source). The sweep still bounds residual staleness: an online teacher whose recorded activity ages past the threshold is re-offlined by the next pass, so `is_online` is accurate within threshold + cadence.

---

## 7. Related Documents

- **State-machine invariants** — `docs/specs/state-machine-invariants.md` §3 (Teacher Availability Lifecycle), INV-A1..A4. INV-A1 and INV-A2 are enforced by this surface (the toggle writes through `TeacherAvailabilityService`); INV-A4 (never-resurrect release gating) has shipped — the marker-gated release (see §6.2); INV-A3 (directory appearance) remains owned by its sibling tickets (see §6).
- **Session lifecycle** — `docs/sessions/session-lifecycle.md` — the INV-S6 lock/release writer (the OTHER writer on `teacher.is_online`); the `assertTeacherNotInActiveSession` seam consumed by this surface's INV-A2 gate is documented there as the canonical "is this teacher in a started session?" oracle.
- **Applicant lifecycle** — `docs/teachers/applicant-lifecycle.md` — the certification surface whose result (`teacher.is_approved`) backs INV-A1; the toggle READS `isApproved` but never writes it.
- **Verification plan purchase** — `docs/teachers/verification-plan-purchase.md` — the path that arms certification (the gate the toggle's INV-A1 reads).
- **Applicant cooldown** — `docs/teachers/applicant-cooldown.md` — the two-source-split precedent (cooldown vs account governance) that this surface's "two-writer split" (manual toggle vs session lifecycle) mirrors: two disjoint concerns, two disjoint writers, two disjoint owners, one shared column with row-level lock serialization.
