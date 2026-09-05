# Account Governance — Suspend / Block / Soft-Delete Lifecycle

> Domain architecture guide for the four-state governance lifecycle on `users` (active / suspended / blocked / soft-deleted) and the admin mutations that transition between states.

**Domain:** Admin / Identity-and-governance core (Workflow 05 §5 — "Suspend / Block / Unblock / Unsuspend" governance surface)
**Specs:** `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md` (§6 Student Account Lifecycle, INV-U1..U5), `docs/specs/open-decisions-and-gaps.md` (A.7 governance on `users`)
**Status:** Implemented and verified (DEV3-017)

This document is the single canonical reference for the suspend/block governance surface shipped by DEV3-017. It rides on top of the DEV3-016 substrate (`AdminUserRepository` + `AdminUserManagementService` + `AuditService`) and forks ZERO new writers, ZERO new guards beyond the strict active-actor variant, and ZERO new audit-action vocabulary. All layers (types, predicate, repo, service, auth boundary, GraphQL, frontend, tests) MUST conform to the contracts described here. Code blocks are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

---

## Why

The platform's user lifecycle distinguishes four governance states on `users`. Hard-deletes are forbidden (INV-U4): historical data (sessions, reports, financial transactions) MUST be preserved. **Soft-delete** (`is_deleted=true` + `deleted_at=now`) is the destructive end-state; **suspend** and **block** are the transient governance windows that can be reversed.

| State | Column signal | Reversible? | Owner |
|---|---|---|---|
| active | `is_deleted=false` ∧ `suspended=false` ∧ `is_blocked=false` | — | default |
| suspended | `suspended=true` ∧ active window (`suspendedAt` + `suspendedPeriodDays` strictly after `now`) | yes — by lapse or unsuspend | DEV3-017 |
| blocked | `is_blocked=true` | yes — by unblock | DEV3-017 |
| soft-deleted | `is_deleted=true` ∧ `deleted_at=now` | yes — by reactivate (DEV3-016) | DEV3-016 + DEV3-017 inherits |

Workflow 05 §5 owns the suspend / block / unsuspend / unblock lifecycle as the admin governance surface; DEV3-016 owns the soft-delete / reactivate surface; DEV3-017 ships the suspend/block governance windows ON TOP of the DEV3-016 substrate (same `AdminUserRepository` + `AdminUserManagementService` + `AuditService` substrate; zero new writers/guards forked).

The three load-bearing requirements:

1. **No TOCTOU on governance writes.** A SELECT-then-UPDATE between the actor check and the row mutation is a race window; the guarded single-statement UPDATE with the WHERE-clause guard is the atomicity guarantee.
2. **Lapse = READ-ONLY on the auth path.** A lapsed suspension MUST restore access with zero writes — the auth boundary is pure READ, never a mutation. The predicate is the contract, not a state transition.
3. **Zero audit-action vocabulary drift.** Block/unblock DO NOT mint a new `AuditActionType` member (REQ-045 zero schema drift). The Suspend/Reactivate mapping carries block/unblock semantics through `details.changedFields`.

---

## Pattern

### 1. Guarded single-statement transitions + zero-row classifier + ONE in-tx audit row

Every governance mutation follows this exact pipeline (mirrors the `setDeletedOnce` precedent shipped by DEV3-016):

1. **Pre-transaction strict actor guard** — `assertActiveActorAdmin(actorId, locale)` runs BEFORE the transaction opens (when no outerTx). The strict guard checks the actor is an active admin AND not in any denial state (deleted / blocked / actively-suspended), in deterministic order: `isDeleted → isBlocked → isSuspensionActive`.
2. **id + periodDays validation** — positive-int id re-assertion; `periodDays` validated as integer `1..3650` on the suspend direction ONLY (unsuspend ignores `periodDays` entirely — silent NULL would mint a corrupt permanent lockout).
3. **`withTransaction` single boundary** — the entire write pipeline runs inside ONE transaction. `tx` is propagated to EVERY inner call.
4. **Self-protection BEFORE any write** — `id === actorId` check throws `USER_SELF_SUSPENSION_FORBIDDEN` / `USER_SELF_BLOCK_FORBIDDEN` BEFORE the guarded repo call.
5. **Guarded single-statement UPDATE** — `AdminUserRepository.setSuspendedOnce` / `setBlockedOnce` issues a single `UPDATE ... WHERE <NULL-safe axis guard + not-deleted guard> ... RETURNING SAFE_USER_SELECT`. The WHERE clause is the atomicity guarantee (no SELECT-then-UPDATE TOCTOU). Returns the updated row OR `null` on guard rejection.
6. **Zero-row classifier** — when the guarded UPDATE returns `null`, `AdminUserRepository.findGovernanceState(id, tx)` probes the 5-column governance state to disambiguate:
   - `null` (row missing) → `NotFoundError("USER", "USER_NOT_FOUND")`
   - `isDeleted === true` → `ConflictError("USER_ALREADY_DELETED")`
   - axis already-ON (`target=true`, `axis=true`) → `ConflictError("USER_ALREADY_SUSPENDED" / "USER_ALREADY_BLOCKED")`
   - axis not-ON (`target=false`, `axis=false`) → `ConflictError("USER_NOT_SUSPENDED" / "USER_NOT_BLOCKED")`
7. **ONE in-tx audit row** — via the existing `buildAuditContract` + `AuditService.createAuditLog(input, tx)`. ZERO PII in `details` (field names + metadata only — never contact-PII, never credentials, never `passwordHash`).
8. **Post-write composition** — `getUserDetail(id, locale, actorId, tx)` re-composes the `AdminUserDetail` response for the GraphQL field return. Apollo merges via the id-first `AdminUserDetailFields` fragment — the detail page re-renders WITHOUT a refetch.

Authoritative implementation: `AdminUserManagementService.setUserSuspended` / `setUserBlocked` (`backend/services/admin/user-management.service.ts`).

### 2. Audit-vocabulary mapping for block/unblock

Block/unblock DO NOT introduce a new `AuditActionType` member (REQ-045 zero schema drift). Instead they reuse the existing Suspend / Reactivate members with `details.changedFields` carrying the disambiguation:

| Mutation | `AuditActionType` | `details.changedFields` | `details.blocked` |
|---|---|---|---|
| suspend | `Suspend` | `["suspended","suspendedAt","suspendedPeriodDays"]` | — |
| unsuspend | `Reactivate` | `["suspended","suspendedAt","suspendedPeriodDays"]` | — |
| block | `Suspend` | `["isBlocked","blockedAt"]` | `true` |
| unblock | `Reactivate` | `["isBlocked","blockedAt"]` | `false` |

DEV3-020's audit browser distinguishes via `details.changedFields`. Vocabulary widening (dedicated block/unblock members) is forward-pointer D6 — owned by a future governed schema decision. NEVER widen `audit_action_type` ad-hoc.

### 3. Shared predicate + auth consumers

`backend/lib/auth/suspension-window.ts#isSuspensionActive(state, now)` is the single source of truth for suspension-window evaluation. Three consumers:

- `assertUserActive` in `backend/services/auth/auth.service.ts` (login + `refreshToken`) — denial copy via `t.accountBlocked` (wire-shape constancy, REQ-018).
- `getServerUserContext` in `backend/lib/auth/server-auth.ts` (SSR).
- `isGovernanceExcludedFromDiscovery` in `backend/services/students/student-handshake.helpers.ts` (refactored to consume the shared predicate — behavior-preserving).

The predicate is **fail-closed**: corrupt window data (null `suspendedAt`, null/0/negative `suspendedPeriodDays` on a flagged suspension) is treated as an indefinite suspension rather than a lapse. An expiry landing EXACTLY on `now` has LAPSED (STRICT `>` — inclusive lower-bound, exclusive upper-bound on the window).

Window end = `suspendedAt + suspendedPeriodDays × 24h` (86,400,000 ms per day), evaluated against ONE captured `now` per invocation.

---

## Rules

1. **Suspend window rules**: `periodDays` is mandatory on the ON direction, validated `1..3650` (caps under-entry and absurd windows). The unsuspend direction IGNORES `periodDays` (never validated, never forwarded) — a silent NULL would mint a corrupt permanent lockout.
2. **Self-protection**: `id === actorId` check throws `USER_SELF_SUSPENSION_FORBIDDEN` / `USER_SELF_BLOCK_FORBIDDEN` BEFORE any write. No admin can self-suspend or self-block.
3. **Uniform `USER_ALREADY_DELETED` deleted-target rule**: any governance mutation on a soft-deleted user throws `USER_ALREADY_DELETED` (never `USER_NOT_FOUND` — the row exists; it is just deleted). The classifier disambiguates honestly via `findGovernanceState`.
4. **Axis independence**: suspend/block are orthogonal axes. A user can be both suspended AND blocked simultaneously; transitions on one axis do not touch the other.
5. **Lapse = READ-ONLY on the auth path**: a LAPSED suspension restores access with ZERO writes. The predicate is pure READ — no UPDATE fires on the auth boundary. REQ-019 zero-write proof: columns byte-identical before/after a lapsed-suspension login.
6. **Strict active-actor guard on governance mutations**: `assertActiveActorAdmin` (the strict variant) runs on `setUserSuspended` / `setUserBlocked` ONLY. DEV3-016's existing mutations (create / update / delete / reactivate) keep the relaxed `assertActorAdmin` guard (REQ-031 — their existing suites are the byte-equivalence net). Backporting the strict guard onto DEV3-016 is forward-pointer D4.

---

## What NOT to Do

1. **Never SELECT-then-UPDATE governance**: TOCTOU hole. Use the guarded single-statement `UPDATE ... WHERE ... RETURNING` pattern; the WHERE clause IS the atomicity guarantee.
2. **Never hard-delete**: INV-U4. The `inv-u4-grep-lock.test.ts` suite pins the source-code scan; the `schema-surface.test.ts` exact-match assertion pins the schema surface. Any future `hardDelete*` or `deleteUser`-class Mutation field would fail both locks.
3. **Never extend a suspension in place**: there is no `extendSuspension` mutation. Use the audited `unsuspend` + `re-suspend` pair (with a new `periodDays`). This preserves the audit trail's transition semantics.
4. **Never write on the auth path**: `assertUserActive` + `getServerUserContext` are pure READ. REQ-019 zero-write proof lives in the journey step 8 + the committed-fixture auth-consumption block.
5. **Never fork the predicate**: `isSuspensionActive` is the single source. Do not duplicate the window math; do not introduce a "stricter" variant. The fail-closed bias is the contract.
6. **Never widen `audit_action_type` outside a governed schema decision**: D6 is forward-owned by a future governed schema decision. Use the existing Suspend/Reactivate mapping with honest `details.changedFields` until then.

---

## Rollout Summary (DEV3-017)

### Mutations registered

- `adminSetUserSuspended(id: Int!, suspended: Boolean!, periodDays: Int): AdminUserDetail!`
- `adminSetUserBlocked(id: Int!, blocked: Boolean!): AdminUserDetail!`

### Files

- **Types:** `backend/types/admin/admin-user.types.ts` (`GovernanceProbeRowType` added)
- **Predicate:** `backend/lib/auth/suspension-window.ts` (NEW; pure function + branch-matrix test)
- **Repo:** `backend/db/repo/admin/admin-user.repository.ts` (extended: `setSuspendedOnce` + `setBlockedOnce` + `findGovernanceState`)
- **Service:** `backend/services/admin/user-management.service.ts` (extended: `setUserSuspended` + `setUserBlocked`; `setUserDeleted` byte-untouched per REQ-020)
- **Auth boundary:** `backend/services/auth/auth.service.ts` (`assertUserActive` widened to consume `isSuspensionActive`) + `backend/lib/auth/server-auth.ts` (`getServerUserContext` swapped to consume `isSuspensionActive`)
- **Handshake:** `backend/services/students/student-handshake.helpers.ts` (refactored to consume `isSuspensionActive` — behavior-preserving)
- **Guard:** `backend/services/admin/admin-guards.helpers.ts` (NEW; `assertActorAdmin` relaxed + `assertActiveActorAdmin` strict variant)
- **GraphQL:** `backend/graphql/mutation/admin/admin-governance.mutation.ts` (NEW; thin resolvers with `authScopes.$all`)
- **Locale:** `shared/locale/types/errors/labels.ts` + `en/errors` + `ar/errors` (7 new keys: `userAlreadySuspended` etc.); `shared/locale/types/adminUsers/index.ts` + `en/adminUsers` + `ar/adminUsers` (`governanceActions` group: 20 slots)
- **Frontend:** `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts` (2 new mutation documents, fragment reuse); `frontend/views/admin/users/detail/GovernanceActionsSection.tsx` (NEW; 4 state-gated actions + Suspend dialog + conflict Alert)
- **Tests:** journey (`test/workflows/admin/account-governance.journey.test.ts`), service (`user-governance.service.test.ts` + `user-governance.chaos.test.ts`), repo (`admin-user-governance.repository.test.ts`), wire-tier (`admin-governance.matrix.test.ts`), schema-surface (`schema-surface.test.ts` + `sdl-static-assertions.test.ts` reconciled + extended), lock (`inv-u4-grep-lock.test.ts`)

### Baseline reconciliation

- `schema-surface.test.ts` + `sdl-static-assertions.test.ts`: RECONCILED to mirror the live 23-op Mutation root (was 7-op stale baseline — pre-existing DEV3-016 inventory drift). Documented one-time reconciliation — NOT a silent baseline flip.

---

## Related Documents

- `docs/admin/user-management.md` — DEV3-016 substrate + §6 scope-split row (DEV3-017 = shipped)
- `docs/auth/jwt-authentication-service.md` §5.3/§5.7 — window predicate now exists at `backend/lib/auth/suspension-window.ts`; consumed by login / refresh / SSR; session-creation gating remains the owning consumer (forward pointer)
- `docs/parents/handshake-code-discovery.md` — window math extracted to the shared predicate (its R3 table stays the semantic source)
- `docs/workflows/05-admin-governance-override.md` §5 — Workflow 05 §5 cross-actor lifecycle ownership
- `docs/specs/state-machine-invariants.md` §6 — INV-U1..U5 (referenced by binding only; not edited)
- `docs/specs/open-decisions-and-gaps.md` — A.7 governance on `users` (referenced by binding only; not edited)
