# Admin Session Governance — Canonical Reference

**Domain:** Admin / operator surface over the `session` entity (directory, detail, reschedule, cancel, teacher reassignment, live join observation)
**Status:** Implemented and verified
**Source of truth for:** the state-eligibility matrix for admin session mutations, the single-transaction mutation discipline, the governance audit-row shape, the three notification waves and their claim keys, the join-observation semantics, the admin i18n/roles posture, the rate-limit posture, and the boundary this surface shares with the session arbitration surface.

This document is the single canonical reference for the admin session-governance surface (`/admin/session-governance`, the `SessionAdminGovernanceService` namespace and its repository guards). All layers (types, repo, service, GraphQL, frontend, tests) MUST conform to the contracts described here. Downstream tickets that touch `session` writes outside the participant lifecycle MUST read this document together with `docs/sessions/session-lifecycle.md` — the lifecycle owns the participant transitions; this surface is the operator complement over the same rows.

---

## 1. Why

Admins need one browse plane over EVERY session row regardless of state or ownership, plus a small set of operator mutations that reshape a row (move its timing, kill it with a refund, swap its teacher) or observe it live. The surface exists because the participant lifecycle is ownership-scoped: a caller only ever sees and mutates rows they sit on. The admin surface deliberately breaks the ownership scoping — which makes its discipline non-negotiable: role-gated everywhere (scope gate + service re-assertion), oracle-safe (a denied or unknown target reveals nothing), race-proof (eligibility folded into the write statement), money-safe (a cancel releases the hold exactly once, in the same transaction), and fully audited (exactly one audit row per committed mutation, zero rows per denial).

## 2. State-eligibility matrix

Every mutation is ONE guarded single-statement `UPDATE … WHERE <row identity> AND <required pre-state> RETURNING *` (the guarded-transition pattern of `docs/sessions/session-lifecycle.md` §2.2, admin variant). Eligibility evaluation happens under the row lock inside the statement — the check-then-write window is zero by construction:

| Mutation | Eligible pre-states | Extra predicate | Writes |
|---|---|---|---|
| Reschedule | `scheduled` \| `started` | — | `started_at`, `ended_at`, `updated_at` (the confirmation deadline is never re-armed) |
| Cancel | `scheduled` \| `started` (the two pre-terminal live states) | — | `status=cancelled`, `fee_held=false`, `updated_at`; releases the hold through the shared same-lane refund primitive |
| Reassign teacher | `scheduled` only | `teacher_id <> candidate` (the different-teacher fold — a same-teacher call is a zero-row miss, not a no-op write) | `teacher_id`, `updated_at` |
| Join (observe) | `started` only | enforced by the INSERT's own `EXISTS` clause (§6) | ZERO session columns |

A disputed row is eligible for NOTHING on this surface — an open dispute belongs to the arbitration surface (§9), which is the only writer allowed to exit a disputed row into a terminal state. Terminal rows (`completed`, `cancelled`) are structurally unreachable: they appear in no guard predicate.

A zero-row miss is ambiguous (unknown id vs wrong state vs same-teacher), so the service classifies it with ONE cold probe read (`findTransitionProbe`) that runs only AFTER the guarded statement already matched zero rows and never feeds a write: probe `null` → the localized session-not-found denial (oracle-safe — the admin surface is role-gated, never participant-gated, so there is no foreign-caller arm to fold in); any other miss → the localized state-conflict denial. Never branch a write off the probe.

Reassignment certification: the candidate's `is_approved` is verified through `TeacherRepository.lockForCertificationCheck` — a `SELECT … FOR UPDATE` held across check → write in the SAME transaction (the FK asserts existence only; the lock is the actual write-time guarantee, the booking precedent).

## 3. Single-transaction discipline

Every mutation wraps ALL of its writes in ONE `withTransaction(outerTx, …)` block and hands that SAME transaction to every repository, refund, audit, and notification call — partial application is impossible. The fixed order inside the transaction body:

1. **Idempotency claim** (cancel only, when the caller supplied a key) — inserted savepoint-bracketed BEFORE any session write; a duplicate key resolves the replay branch; any other error surfaces untouched and rolls the whole mutation back, so a failed cancel never burns its key.
2. **Pre-write read** — captures the audit metadata (the "from" timing pair / outgoing teacher id) and classifies an unknown id; it never gates the write (the guarded statement is the atomic gate).
3. **Guarded UPDATE** — the eligibility fold of §2.
4. **Refund** (cancel) — the released hold is refunded through the ONE shared same-lane primitive verbatim: a row with no recorded lane refunds nothing; an unreadable lane fails closed and rolls the mutation back.
5. **Audit row** — exactly one, appended through the composition-only writer (§4).
6. **Claim pointer backfill** — the claim's session pointer is set in the same transaction (the replay arm backfills it too, so a committed claim always names the session it resolved against).
7. **Wave receipts** — the notification wave persists as UNPUBLISHED delivery receipts.

The caller owns the boundary-schema validation, the admin gate, the transaction composition, and the publish: receipts are published strictly AFTER the caller's own commit (**publish-after-commit** — nothing is ever pushed for a rolled-back emit).

The cancel is idempotent through the same claim-table mechanism the booking flow uses: a replayed cancel returns the already-cancelled row with no duplicate audit row, no second refund, and no wave. A claim spent by a DIFFERENT caller is the oracle-safe not-found denial; a claim spent on a DIFFERENT session is the state conflict.

## 4. Audit shape

| Field | Value |
|---|---|
| `actionType` | `Override` (the shared audit vocabulary) |
| `entityType` | `"session"` (short lowercase label) |
| `entityId` | the target session's id |
| `actorId` | the verified admin's id — from the server-resolved context, NEVER from input |
| `details` | JSON string, ≤ 2000 chars serialized (see below) |

- **Exactly one row per committed mutation.** The four mutations ride the composition-only audit writer (`AuditService.createAuditLog`) inside the mutation transaction; the join writes its audit row through its atomic eligibility-fold INSERT instead (§6) — same guarantee, same table. Denial paths append ZERO audit rows.
- **Append-only.** Rows are INSERTed only; the writer never UPDATEs or DELETEs, and the table's immutability trigger enforces it at the DB layer as defense in depth. The audit row shares the transaction's fate — a rolled-back mutation leaves no trail.
- **Details envelope.** The cancel row's `details` is `{"action":"cancel","reason":…}` (a 31-char envelope around the only caller-supplied member); reschedule/reassign carry field NAMES + timing/teacher-id metadata. The `details` column is `varchar(2000)` and the writer defensively truncates at that ceiling — a truncation that would shear the closing quotes and corrupt the JSON. The admin surface therefore guarantees the envelope ALWAYS fits by construction at its input boundary: the optional cancel reason is length-capped (330 chars — the ceiling under a conservative 6× JSON-escape divisor) AND control-character-free (Unicode Cc rejected — the only characters JSON.stringify can expand to a 6-char escape, so their rejection bounds the escape multiplier at 2×). The worst schema-legal reason (330 backslashes) serializes to 31 + 660 = 691 chars; downstream trimming can only shrink it further. The writer's truncation is a never-in-practice backstop on this path.
- **Content hygiene.** Details carry field NAMES + metadata only — never contact-PII, never credentials. A whitespace-only reason collapses to `reason: null` (trimmed downstream of the boundary).

## 5. Notification waves

Three wave ids, registered with the session-request notification engine's wave machinery:

| Wave id | Recipients | Trigger |
|---|---|---|
| `sessionGovernance.rescheduled` | student + teacher | committed reschedule |
| `sessionGovernance.cancelled` | student + teacher | committed cancel (one-shot) |
| `sessionGovernance.teacherReassigned` | student + outgoing teacher + incoming teacher | committed reassignment |

- **Receipts, not pushes.** The wave persists UNPUBLISHED delivery receipts inside the mutation transaction; publication happens strictly after the caller's commit (§3).
- **Occurrence-discriminated claim keys.** The one-shot cancel wave claims `session:<sessionId>:<waveKind>`; the two RECURRING kinds (rescheduled, teacherReassigned) fold the emit-time row occurrence into the key — `session:<sessionId>:<waveKind>:<updatedAt ISO>` — where the stamp is the guarded mutation's own write, read back on the caller's transaction at wave time. A second reschedule (or re-reassignment) of the same session therefore claims a FRESH key inside the claim TTL instead of deduping against the prior occurrence's still-live claim.
- **Per-recipient locale.** The engine stores copy verbatim and never translates, so title/body are composed in the RECIPIENT's persisted locale (platform default as fallback) by the wave module, and that same locale is handed to the engine.

## 6. Join semantics

The admin join is an OBSERVATION, not an access grant: it records that an admin watched a live session, and it changes nothing about the session itself. Full meeting-bridge integration (actually entering the meeting) is a recorded forward item — no meeting-URL column exists on the row.

- **The eligibility fold.** ONE `INSERT … SELECT … WHERE EXISTS (SELECT 1 FROM session WHERE id = target AND status = 'started')` selects the audit row's constant columns FROM the target row gated by row identity + the `started` state, so the audit row materializes only while the session is still joinable IN THE SAME STATEMENT — the check-then-insert window is zero by construction, and the primary-key selection matches at most one row (the exactly-one-row guarantee rides the same clause).
- **Zero writes to session columns.** The post-fold read exists purely to return the canonical response payload.
- **Denials.** A zero-row miss (row vanished or left the live state) is classified by the ONE cold probe read (§2) — localized not-found or state conflict, zero audit rows.

## 7. i18n & roles

- **Compile-time i18n.** The surface uses the repo's compile-time TypeScript locale system (`shared/locale/`): the UI tree reads the `adminSessionGovernance` namespace (en/ar bundles, AR RTL-safe), denials resolve through the errors namespace (`getServerTranslations`), and no user-facing string is hardcoded in service, schema, or view code.
- **Admin-only surface.** Two walls: every resolver carries the identical `authScopes` `$all { authenticated: true, role: [admin] }` conjunction, and every service method re-asserts the governance-clean admin gate (`assertAdminGovernanceClean`) as its first statement — the DB user row is the authority, never a still-valid token, so a deleted/blocked/suspended admin (or an unresolvable actor id) fails closed before any read or write. The gate performs zero writes.
- **Byte-identical denial split.** Anonymous → `UNAUTHORIZED`; authenticated non-admin → `FORBIDDEN` — the same split, byte for byte, as the reference arbitration operation, resolved before any resolver body work. All denials localize through the shared error contract and write zero audit rows.
- **BOPLA.** Inputs are closed whitelists (unknown keys stripped at the boundary schema; resolvers map field-by-field, never a spread); `needsAttention` is a server-derived badge flag for styling — it never grants, denies, or narrows authorization.

## 8. Rate-limit posture

The platform-wide GraphQL rate-limit wrapper (per-IP Redis sliding-window limiter, `backend/lib/ratelimit.ts`) covers the surface at the transport layer; it fails open in the test transport. There is deliberately NO bespoke admin-mutation limiter — a tighter per-admin quota is a recorded forward item on the platform hardening stream (the plan ledger's rate-limit row). Cost is otherwise bounded by construction: the directory's page size is capped (1..50, default 25), the offset is ceiling-bounded against the honest filtered total, and every mutation is O(1) statements inside one transaction. Missing supporting indexes for the filter/order columns are a recorded forward item (schema/index stream).

## 9. The arbitration boundary

Two admin roads over the same rows stay strictly independent:

- **This surface** sees EVERY row (the browse plane) but can mutate none of the disputed ones — the guard predicates make a disputed row structurally unreachable.
- **The arbitration surface** (`resolveSessionDispute` is its reference operation, `docs/workflows/05-admin-governance-override.md` the workflow source) is the ONLY writer allowed to exit a disputed row into a terminal state.

Both enforce the SAME governance-clean admin gate and therefore the same byte-identical denial split. Never widen this surface's predicates to "helpfully" touch a disputed row; never add a second write path for a transition.

The arbitration surface's single-write-path ruling now covers **both dispute generations**: a disputed row's escrow class (`fee_held`) selects the legal outcome vocabulary on the same `resolveSessionDispute` entry — held rows (`fee_held = true`) resolve through `Cancel | Complete` (the pre-completion semantics, byte-stable, owned by the session lifecycle), consumed rows (`fee_held = false`) through `Refund | PartialRefund | Uphold` with their financial reversal. Cross-family submissions are rejected with `disputeResolutionMismatch` before any write, and every arbitration write re-asserts the row's escrow class inside its own transaction — the classification discipline of §2 generalizes unchanged. The canonical reference for the arbitration side of this boundary is `docs/sessions/dispute-arbitration.md`.

## 10. Testing posture

- **Four tiers** at the repo/service/GraphQL-wire layers: Tier 1 (shape + schema contracts, SDL pins, codegen-sync), Tier 2 (boundaries — page windows, reason cap, charset rejection, idempotency key shape), Tier 3 (chaos on committed fixtures through the production transaction path — concurrent cancel vs completion, retry-doubles, interrupted mutations rolling back to pre-state), Tier 4 (security — non-admin role matrices, byte-identical 401/403, zero-write denials, oracle-safety).
- **Cross-actor journeys** on the REAL database (fixtures committed in `beforeAll`, deleted in `afterAll` — no rollback wrappers at journey level): admin discovery → cancel with refund propagation (student observes the terminal state + localized wave), reassign with the certification gate (observer-perspective asserts on student + both teachers), join audit-delta (exactly one row on `started`, zero otherwise), and the role-denial matrix over every operation.
- **UI component suites** (Happy DOM + mocked Apollo): directory render, badge matrix, dialog open/confirm/error paths, eligibility-gated actions, locale/RTL rendering.
- **E2E.** A hermetic Playwright smoke (filter → cancel → audit-visible) is authored and runs in CI against a real Postgres server; in the PGlite-provider sandbox the server-test runner skips the warm-server spawn (single-connection engine, no second server), so local execution of that one suite is a documented deferral — the component + wire + journey layers carry the equivalent coverage locally.

## 11. Forward items

Genuinely-deferred work is tracked in this ticket's plan ledger (`ai/plans/milestone_3_parent_portal_admin_governance/admin-session-governance/deferred-items.md`), all forward-owned and none blocking this surface's contract:

- Bespoke rate limit for admin mutations (platform hardening stream).
- Real-time admin dashboards over governance surfaces (analytics family).
- Meeting-bridge integration for admin join — full join access vs today's observation-only semantics (depends on the meeting-services ticket).
- Idempotency claim uniqueness scoped per actor (shared platform mechanism, inherited from booking).
- Directory filter/order indexes (schema/index stream; the page ceiling bounds offset cost meanwhile).
