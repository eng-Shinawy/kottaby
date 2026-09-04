# Parent Link Request Workflow — Canonical Reference

**Domain:** Parents / Student–parent linking (link-request workflow, 7-day expiry)
**Specs:** `docs/specs/functional-requirements.md` (§7 Parent Supervision), `docs/specs/state-machine-invariants.md` (INV-P1), `docs/workflows/04-parent-supervision-handshake.md` (§4.3/§4.4)
**Status:** Implemented and verified (DEV1-014)

This document is the single canonical reference for the parent→student link-request workflow: the `parent_link_requests` model and its exact state machine, the five-operation service surface, the guarded single-writer student link, expiry semantics (liveness + materialization), sibling-expiry choreography on confirmation, notification choreography, the error/oracle matrix, and the consumer contract for downstream tickets. All layers (schema, repositories, services, GraphQL, frontend) MUST conform to the contracts described here. Code blocks are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

The *discovery* half of the handshake (how a parent finds a student by code, and what the code discloses) is canonically documented in [`docs/parents/handshake-code-discovery.md`](./handshake-code-discovery.md) and is described here **by reference only**. This document owns the *binding* half: what happens from "send link request" to "link established".

---

## Why

INV-P1 (`docs/specs/state-machine-invariants.md`) rules the whole feature:

> *"A parent cannot monitor a student without the student's explicit confirmation of the link request."*

Discovery (previous doc) confers zero supervision capability. The link request workflow is where a student's *explicit confirmation* either happens or does not — so every design ruling here is a child-safety ruling first and a workflow ruling second:

- **The student decides.** Confirm/Reject are the student's and only the student's; a parent can create, cancel, and re-request, but can never flip a student's decision surface. The parent's outgoing list shows the student's name **masked forever** — the student's identity was already proven at discovery; after discovery the code-holder learns nothing more until the student confirms.
- **The link is written exactly once, by exactly one writer.** `students.parent_id` has ONE production writer — a guarded conditional UPDATE that folds the "still unlinked" precondition into the predicate — so two parents racing to confirm two requests for the same child produce exactly one link and one clean loser, never a ghost.
- **Nothing is trusted across time.** Every mutation re-proves the actor fresh, re-resolves the target by re-submitting the handshake code inside the transaction, and treats the 7-day deadline as a hard liveness boundary checked with strict inequality at the instant of the transition.

Two plan-level reconciliations are recorded here so future readers do not re-litigate them:

1. **REQ-022 ticket-prose reconciliation.** Early ticket prose implied a "pending" phase on the student row. The shipped truth: the pending phase lives **ONLY** in `parent_link_requests`; `students.parent_id` is written **ONLY** on confirmation. An unlinked student is simply `parent_id IS NULL` — there is no pending marker on the student row, ever.
2. **The `Unlinked` state is explicitly delegated.** Link revocation / unlinking is NOT part of this workflow — it is owned by a future ticket (deferred-item D3). This document defines the linked state as absorbing; it does not define the exit.

---

## Pattern

### 1. Model and state machine

Table `parent_link_requests` (physical name `ln`, defined in `backend/db/schema/parents/parent-link-requests.ts`):

- `parent_id`, `student_id` (both `NOT NULL`; FKs to `users`/`students`, `ON DELETE RESTRICT`), `status`, `created_at`, `expires_at` (`created_at + 7 days`, application-written at insert and stored verbatim — never default-computed), plus `responded_at` (nullable transition bookkeeping; set by respond-path materializations, NEVER by the sweep) and `reminder_sent_at` (nullable system marker; written ONCE by the expiry-reminder claim, R13 — user-facing flows never read or write it). The table stores NO handshake-code column — the code lives only on the request wire and is re-resolved per mutation (R4); schema: `backend/db/schema/parents/parent-link-requests.ts:28-53`.
- **Pair arbiter:** `uniqueIndex("parent_link_requests_pending_pair_unique")` on `(parent_id, student_id) WHERE status = 'pending'` (`backend/db/schema/parents/parent-link-requests.ts:50`). It is a partial unique **INDEX**, not a table constraint — PostgreSQL unique constraints cannot carry WHERE predicates; unique indexes can (deferred-item D4, resolved natively in Task 1.2, `outcome/1.2-schema-outcome.md` §3). At most ONE live pending request can exist per (parent, student) pair — enforced by the DB itself, race-proof (23505 arbiter).

Status vocabulary — `LinkStatus` enum, registered ONCE in enum-object form (`backend/enum/shared/link-status.enum.ts:8-11`):

```text
pending ──confirm──▶ confirmed        (terminal; link materialized)
pending ──reject───▶ rejected        (terminal; parent cancel FOLDS here too — no distinct `cancelled` value, D2)
pending ──lapse────▶ expired         (terminal; lazy materialization, see §5)
```

- `rejected` is the fold for BOTH student rejection and parent cancellation (`cancelLinkRequest` writes the row to `rejected` silently — REQ-018; no notification, no publish). A distinct `cancelled` vocabulary was considered and forwarded (D2).
- `expired` has NO dedicated write path in this ticket: it materializes lazily at write paths (§5) and renders computationally on reads. The cron sweep that bulk-materializes lapsed pendings is a forward-pointer (D1).

### 2. Service surface (five operations)

`backend/services/parents/parent-link-request.service.ts` — the business-logic hub. Every mutation is STRICTLY ordered (REQ-011): normalize+validate input PRE-DB → fresh actor re-check (defense-in-depth, REQ-031: fresh `UserRepository.findById`; missing/non-positive id → `UnauthorizedError`; role mismatch → `ForbiddenError`; governed → `ForbiddenError` with identical constant copy — no branch disclosure) → ONE `withTransaction` unit → realtime publish ONLY after own-commit.

| Operation | Actor | Transaction unit (all-or-nothing) | Post-commit |
|---|---|---|---|
| `requestLink` (parent) | parent | code re-validation, target discovery by code re-submission, governance collapse, already-linked / already-pending conflicts (23505 backstop), insert with stored `expiresAt`, recipient-locale copy, in-tx emit | publish receipts |
| `respondToLinkRequest` (student) | student | guarded claim (pending + not expired + owned by this student), accept branch: `linkParentIfUnlinked` write + sibling-pending expiry; reject branch: claim only; parent notified in parent's persisted locale, in-tx | publish receipts |
| `cancelLinkRequest` (parent) | parent | guarded claim (pending + owned by this parent) → fold to `rejected` | **SILENT** — zero notifications, zero publishes (REQ-018) |
| `listMyOutgoing` (parent) | parent | none (read) | — |
| `listMyIncoming` (student) | student | none (read) | — |

- **Capability-by-code (R5 re-submission).** `requestLink` NEVER accepts a student id. The student is re-resolved inside the transaction by re-submitting the handshake code (`findDiscoveryByHandshakeCode`, single parameterized equality — never LIKE). The code is the capability across steps; the student id never crosses the wire (handshake-code-discovery.md R5, §"Do not resolve the link flow by a stored/transmitted student id").
- **REQ-040 letter divergence (recorded per D9a):** on all three own-commit mutation paths the fresh actor re-check runs BEFORE `withTransaction` opens, not inside it. The re-check still precedes every write (REQ-031 honored); there is no atomicity or governance consequence — the transaction's own guarded claims re-prove row ownership. Recorded here so the divergence from REQ-040's letter is explicit, not accidental.
- **Read purity (REQ-015).** The two list operations are self-scoped reads with a RELAXED actor re-check (identity + role; governance state must not hide an actor's own request history). They perform ZERO writes: a stored `pending` row whose `expiresAt <= now` surfaces as `LinkStatus.Expired` computationally (render-time mapping, service docstring `backend/services/parents/parent-link-request.service.ts:29`).

### 3. Single-writer link (INV-P1 proof)

`StudentRepository.linkParentIfUnlinked` (`backend/db/repo/students/student.repository.ts:314`) is the ONLY production writer of a non-null `students.parent_id`. (The one recorded exception lives OUTSIDE the handshake flow: Admin direct student onboarding may set `students.parent_id` directly during onboarding — workflow 04's recorded Admin-override decision. No link-request write bypasses `linkParentIfUnlinked`.) It is a guarded conditional UPDATE — the "still unlinked" precondition is folded into the predicate with `RETURNING`, not read-then-check-then-write — so a zero-row result means "lost the race", and the service THROWS, rolling back the whole confirm transaction (ghost confirmations are impossible; `backend/services/parents/parent-link-request.service.ts:266`).

Proof anchors:

- Scan lock: `backend/services/parents/parent-link.static-locks.test.ts` (single-writer scan + no-LIKE + no-audit + no-console + single-notifications-writer locks; INV-P1 framing at `:7-16`).
- Concurrency: chaos cells "two-parent confirm race" (`parent-link-request.chaos.test.ts:535`) and "linkParentIfUnlinked single-writer" (`:723`) — exactly ONE winner, the loser commits NOTHING.

### 4. Confirmation choreography (sibling expiry)

On confirm, besides the link write, ALL of the student's OTHER pending requests (from any parent) are materialized to `expired` in the same transaction — the child chose; the remaining offers die with the decision. On **reject**, siblings are NOT touched: a "no" to parent A is not a "no" to parent B — children choose parents, and each pending pair keeps its own 7-day liveness.

Deterministic boundary: a respond arriving at the instant `expiresAt == now` deterministically materializes EXPIRED (strict `>` liveness — chaos cell `:607`).

### 5. Expiry semantics

- **Liveness:** strict `expiresAt > now` — a request is live iff `expiresAt` is strictly in the future. The boundary instant belongs to expiry.
- **Lazy materialization at write paths.** Every write-path claim (`respond`, `cancel`) and the expiry race arms (`markExpiredIfPending`) converge to EXACTLY ONE terminal state per row (chaos cells `:654`, `:693`). A lapsed row that was never touched keeps `status = 'pending'` in storage while every read renders it `Expired`.
- **The sweep PRIMITIVE is shipped; the trigger is not.** `ParentLinkRequestRepository.markAllExpiredIfPending(now, tx)` + `ParentLinkRequestService.sweepExpiredRequests()` (repo `:339`, service `:408`) bulk-materialize every lapsed live pending in ONE guarded statement — idempotent by predicate, actor-less by design, silent (REQ-018/REQ-024), and delta-tested against table-wide residue. A sweep run LIFTS the silent-expiry re-request lockout (the pair's `findPendingByPair` answer collapses; a fresh `requestLink` succeeds — pinned by the service suite's unlock test). The cron STREAM that schedules it (ticker/queue/heartbeat — the phantom pre-seed infrastructure documented in `backend/services/AGENTS.md` §Cron Service) remains the D1 future ticket; until it lands, sweeps are invoked by ops on demand via `scripts/ops/sweep-expired-link-requests.ts` (`bun run ops:sweep-link-requests`).
- **Silent expiry (decision + forward-pointer).** Expiry itself emits NO notification and writes NO audit row (REQ-024 — zero `audit_logs` for all five ops across all branches). The PRE-expiry reminder is the one sanctioned parent-bound heads-up (R13); nothing is ever emitted AT or AFTER the expiry instant. The cron stream that would schedule both primitives remains deferred-item D1 (future cron-stream ticket).
- **The expiry-reminder PRIMITIVE is shipped; its scheduler is not.** `ParentLinkRequestReminderRepository.claimPendingForExpiryReminder(now, horizon, tx)` + `ParentLinkRequestService.sendExpiryReminders({ horizonHours, outerTx, options })` claim every live pending whose expiry falls in `(now, now + horizon]` (default horizon 24h, hard cap 168) and send the REQUESTING parent ONE localized reminder — the claim sets `reminder_sent_at` in the SAME guarded statement (the claim IS the dedupe; row locks + the `IS NULL` conjunct serialize claimers), the emissions join the claim's transaction (all-or-nothing), the copy interpolates the student's MASKED name (R9) in the parent's persisted locale, and the run is otherwise silent (no audit, no student-side notification, no realtime publish — inbox rows surface on the next load/badge poll). Ops path: `scripts/ops/remind-expiring-link-requests.ts` (`bun run ops:remind-link-requests [--horizon-hours <n>]`); lapsed rows are NEVER the reminder's business — run the sweep for those.
- **D9b tradeoff (recorded per deferred-items D9):** a re-request after a silently lapsed (unmaterialized) pending row answers `ConflictError PARENT_LINK_ALREADY_PENDING` (liveness-free `findPendingByPair` pre-check; the partial unique would 23505 into the same mapping) while the outgoing list renders the row `Expired`, and the UI hides Cancel on both sides for such rows. The sanctioned cancel→EXPIRED→re-submit choreography is therefore UI-unreachable until D1's cron sweep owns materialization. The CURRENT contract is pinned honestly by the 11th chaos cell "re-request after silent expiry" (`parent-link-request.chaos.test.ts:802`) — the test pins the lockout, it does not bless it.

### 6. Notification choreography (REQ-023)

All notifications flow through the `NotificationEngine` — the ONLY writer of `notifications` rows (`backend/services/AGENTS.md` single-writer rule):

| Event | Recipient | Copy locale | Timing |
|---|---|---|---|
| request created | student | **recipient's persisted locale**, composed in-tx | emit in-tx, publish after own-commit |
| confirm / reject | parent | parent's persisted locale | emit in-tx, publish after own-commit |
| cancel | — | — | SILENT (REQ-018) |
| expiry reminder (pre-expiry) | parent (requester) | parent's persisted locale | claim-based dedupe (`reminder_sent_at`), emit in-tx, NO publish |
| expiry | — | — | SILENT (nothing at or after the instant; R13) |

Payload contract: `relatedEntityType="parent_link_request"` + `relatedEntityId` = the request row id (`backend/services/parents/parent-link-request.service.ts:296`), emitted via the engine's `emitForUser`/publish-receipts contracts — publish-after-commit discipline (engine-local receipts render in the bell inbox; verified live in D8 browser QA, `outcome/4.2-4.3-frontend-views-outcome.md` + deferred-item D8 row).

### 7. Error / oracle matrix (the four channels)

Denials never disclose which of {target missing, governed, already-linked, already-pending} applies beyond the sanctioned domain outcomes a code-holder may learn:

| Channel | Behavior |
|---|---|
| Discovery miss | `null` body — byte-identical for miss vs governed target; zero error-log entries (null-collapse, not an error) |
| requestLink conflicts | `ConflictError PARENT_LINK_TARGET_ALREADY_LINKED` / `PARENT_LINK_ALREADY_PENDING` — sanctioned domain outcomes for a code-holder (the 23505 arbiter maps into the same conflict shape; raw Postgres codes never leak) |
| Foreign/unknown ids | constant `NOT_FOUND` shape (no existence oracle on ids) |
| Logs | bounded `logDomainError` bags — one per denial, forbidden fields absent (REQ-035), happy-path silence (REQ-054) |

Wire-level proof: `backend/graphql/test/parent-link.wire.test.ts` (1267 ln — 401/403/validation/byte-shape matrix, smuggle probes fail pre-resolver); pentester walk: `outcome/6.4-pentester-outcome.md` (0 critical/high).

### 8. Consumer contract (forward-pointers)

- **DEV1-016 (parent monitoring portal):** reads ONLY `students.parent_id`. It must NEVER query `parent_link_requests` for authorization — the link table is history, the student row is the grant.
- **DEV1-017 (session-completion notifications):** resolves parents through `students.parent_id` — same grant rule.
- **D1 (cron sweep + reminder scheduler):** BOTH system primitives are shipped and tested — the sweep (`markAllExpiredIfPending` + `sweepExpiredRequests`, ops: `bun run ops:sweep-link-requests`) and the expiry reminder (`claimPendingForExpiryReminder` + `sendExpiryReminders`, ops: `bun run ops:remind-link-requests [--horizon-hours <n>]`). The cron stream/trigger is the future cron-stream ticket — it registers BOTH primitives as job handlers (sweep cadence + reminder cadence) and unlocks the silent-expiry UX choreography (§5, D9b) on a schedule instead of on-demand.
- **D2 (cancelled vocabulary):** if product later wants a distinct `cancelled` chip, it is a vocabulary migration ON TOP of this state machine — `rejected` remains the fold until then.
- **D3 (unlink):** the exit from `confirmed` is a future ticket; this workflow mints no `Unlinked` state.

---

## Rules

1. **R1 — State machine is exact.** `pending → confirmed | rejected | expired`; cancel folds into `rejected`; NO other transitions, NO `cancelled` value, NO `Unlinked` state (D3 owns the exit). Test anchor: chaos suite terminal-state cells (`backend/services/parents/parent-link-request.chaos.test.ts:316-802`); enum `backend/enum/shared/link-status.enum.ts:8-11`.
2. **R2 — Single writer.** `students.parent_id` is written ONLY by `StudentRepository.linkParentIfUnlinked` (`backend/db/repo/students/student.repository.ts:314`); zero-row ⇒ throw ⇒ whole-tx rollback. Scan lock: `parent-link.static-locks.test.ts`.
3. **R3 — Pair arbiter.** At most one live pending per (parent, student) pair — partial unique index `parent_link_requests_pending_pair_unique` (`backend/db/schema/parents/parent-link-requests.ts:50`); the 23505 path maps to `PARENT_LINK_ALREADY_PENDING`, never a raw Postgres code. Race proof: chaos cell `:316`.
4. **R4 — Capability-by-code.** `requestLink` accepts a handshake code, never a student id; the target is re-resolved inside the transaction. Anchor: `backend/services/parents/parent-link-request.service.ts` (requestLink pipeline, header docstring); R5 contract in `docs/parents/handshake-code-discovery.md`.
5. **R5 — Fresh actor re-check on every mutation** (identity + role + governance; identical constant copy on governed denials), ordered BEFORE the transaction opens (D9a records the REQ-040 letter divergence; REQ-031 precedence preserved). Anchor: service module-private re-check used by all five ops; `outcome/6.2-review-backend-outcome.md` F1.
6. **R6 — Expiry is strict-`>`, lazily materialized, and silent.** Reads never write (REQ-015); the boundary instant is expired; zero notifications/audit on expiry (REQ-024). The bulk sweep primitive (`markAllExpiredIfPending`, repo `:339`) is the D1 unit of work — table-wide, idempotent, actor-less, silent. Anchors: chaos cells `:607/:654/:693`; render-time mapping at `backend/services/parents/parent-link-request.service.ts:29`.
7. **R7 — Sibling pendings expire on confirm only.** Reject does not touch siblings. Anchor: respond branch in the service; chaos cell `:535` (exactly one link winner + remaining pendings expired).
8. **R8 — Notifications:** engine-only writes, recipient-locale copy, `relatedEntityType="parent_link_request"`, publish-after-commit; cancel and expiry emit NOTHING. Anchors: `backend/services/AGENTS.md` (single-writer rule); `backend/services/parents/parent-link-request.service.ts:296`; REQ-018/REQ-023.
9. **R9 — Masked forever (parent side).** The parent's outgoing list renders the student's name via `maskFullName` (`shared/lib/mask-full-name.ts:53`) in ALL states — confirmed included (plan §4.4 visibility matrix: "MASKED student name (never full)"). The student's incoming list shows the parent's FULL name (sanctioned — the confirmation decision needs identity).
10. **R10 — Zero audit rows** for any of the five ops on any branch (REQ-024 — this workflow is out of the admin-audit surface by design). Scan lock: `parent-link.static-locks.test.ts` (no-audit).
11. **R11 — i18n.** Every user-facing copy (chips, toasts, denials, notifications) resolves through the `parentLink` translation namespace (`useAppTranslation(ParentLink)` frontend, `ctx.t`/`getServerTranslations` backend) — no hardcoded strings anywhere in the surface. Parity: 1.1 suites GREEN (`outcome/1.1-i18n-outcome.md`).
12. **R12 — Frontend query discipline.** `useQuery`-only reads, id-first `TypedDocumentNode` documents, `roleDashboardPath` for wrong-role redirects (never bare `/dashboard`). Anchors: `frontend/views/students/link-requests/**`, `frontend/views/parent/handshake/**`; component suites `test/ui/components/students/StudentLinkRequestsContainer.test.tsx`, `test/ui/components/parent/OutgoingLinkRequestsSection.test.tsx`; live browser proof D8 (`outcome/4.2-4.3-frontend-views-outcome.md`).
13. **R13 — The expiry reminder chases the REQUESTER, once, before the instant.** The reminder primitive sends the requesting parent ONE localized reminder per pending request whose expiry is inside the claim window (`expires_at > now AND expires_at <= now + horizon`; the strict-`>` liveness side means lapsed rows are the SWEEP's business, never the reminder's). Dedupe IS the claim: `reminder_sent_at` is set by the same guarded statement (`backend/db/repo/parents/parent-link-request-reminder.repository.ts`), so re-runs and concurrent triggers can never double-remind. Copy interpolates the student's MASKED name (R9 extends to server-composed notification copy) in the parent's persisted locale. Nothing is emitted AT or AFTER expiry, nothing to the student, zero audit rows. Anchor: `ParentLinkRequestService.sendExpiryReminders` (service `:462`); repo + service suite tiers (repo `:771`, service `:1261`).

---

## What NOT to Do

- **Do NOT write `students.parent_id` from anywhere except `linkParentIfUnlinked`** — not from resolvers, not from other services, not from future "convenience" paths. (Sole recorded exception: the Admin direct-onboarding override, which lives outside the handshake flow — see §3.) The scan lock fails the suite on a second writer.
- **Do NOT accept a student id in any parent-facing link mutation.** The code is the capability; an id parameter reintroduces the enumeration oracle discovery closed.
- **Do NOT materialize expiry on reads.** A "helpful" read-time UPDATE breaks read purity (REQ-015) and turns the list surface into a write surface (governance + audit implications). Materialization belongs to write paths now, the cron sweep later (D1).
- **Do NOT notify on cancel or on/after expiry.** Silence is contractual (REQ-018, REQ-024). A "courtesy" notification leaks the child's decision timeline to the parent. The ONE sanctioned exception is the pre-expiry reminder (R13) — claim-deduped, requester-only, masked-name; anything beyond that shape needs a ticket.
- **Do NOT add a `cancelled` enum value or an `Unlinked` state** without a ticket that owns D2/D3 — folding and delegation are recorded decisions, not accidents.
- **Do NOT reveal the student's full name to the parent on any outgoing row state** (including confirmed), and do not reveal request history across pairs — both lists are strictly self-scoped.
- **Do NOT treat `linkable: true` discovery results as a reservation** — discovery is advisory at its isolation level; the transaction re-proves everything (handshake-code-discovery.md R5).
- **Do NOT log request codes, pair ids, or denial branches beyond the bounded bag** (REQ-035/REQ-054) — the log surface is an oracle channel.

---

## Rollout

- **Shipped in this ticket (DEV1-014):** schema + partial unique arbiter (Task 1.2), enums/types/constants (1.3/1.4), i18n namespaces (1.1), repository layer (2.2), service layer (2.3), GraphQL surface (3.1–3.3), frontend wiring + views (4.1–4.4), journey/wire/chaos/static-lock suites (5.1–5.4), four review waves (6.1–6.4) + ledger gate (6.5), live browser QA (D8), the D1 sweep primitive (repo bulk `markAllExpiredIfPending` + service `sweepExpiredRequests` + 6 delta-tested tiers), the bidi-isolation polish (D8 note a), and the on-demand ops sweep trigger (`scripts/ops/sweep-expired-link-requests.ts`, `bun run ops:sweep-link-requests` — post-plan round, 2026-09-02).
- **Shipped post-plan (2026-09-02, reminder round):** the D1 expiry-reminder slice — `reminder_sent_at` column (schema), `ParentLinkRequestReminderRepository` (`claimPendingForExpiryReminder` + `listStudentFullNamesByIds`), `ParentLinkRequestService.sendExpiryReminders` (R13 semantics), `eventParentLinkExpiringTitle/Body` i18n (en/ar/types + parity inventory 32→34 slots), the ops trigger (`scripts/ops/remind-expiring-link-requests.ts`, `bun run ops:remind-link-requests`), 7 new delta-tested tiers (repo 38, service 35), and the parent outgoing empty-state icon parity (`OutgoingEmptyState` — same 72/36 tinted-circle composition as the student side). PLUS the test-env isolation fix: `backend/lib/env.ts` `applyDbEnvOverride` now overrides only missing/placeholder (`file:`/`libsql:`) URLs so `--env-file=.env.test` pins hold (previously EVERY test process was silently retargeted at the dev DB — the admin directory suite's residue sensitivity exposed it); runners additionally pin `DATABASE_URL` explicitly; the test DB is now seeded (`bun --no-env-file run scripts/dbActions/cli-entry.ts --env-file=.env.test seed`).
- **Verification stack (all GREEN at HEAD `8cb466e`):** journey `test/workflows/parents/parent-link-request.journey.test.ts`; chaos 11 cells `backend/services/parents/parent-link-request.chaos.test.ts`; wire matrix `backend/graphql/test/parent-link.wire.test.ts`; static locks `backend/services/parents/parent-link.static-locks.test.ts`; repo suite `backend/db/test/repo/students/student.repository.test.ts`; UI suites `test/ui/components/{students/StudentLinkRequestsContainer,parent/OutgoingLinkRequestsSection}.test.tsx`.
- **Next tickets (owners):** D1 cron sweep (cron-stream ticket) → unlocks the silent-expiry re-request choreography; D2 cancelled vocabulary (product ticket); D3 unlink (revoke ticket); DEV1-016 / DEV1-017 consumers (§8 contract).

---

## Related

- [`docs/parents/handshake-code-discovery.md`](./handshake-code-discovery.md) — the discovery half: code format, minimal payload, masking, `linkable` semantics, R5 binding contract.
- [`docs/auth/user-registration.md`](../auth/user-registration.md) — handshake-code generation contract (§2, by reference).
- [`docs/workflows/04-parent-supervision-handshake.md`](../workflows/04-parent-supervision-handshake.md) — the governing workflow (§4.2 discovery, §4.3 request/confirm, §4.4 visibility).
- [`docs/specs/state-machine-invariants.md`](../specs/state-machine-invariants.md) — INV-P1 (and the sibling INV family).
- [`docs/notifications/realtime-engine.md`](../notifications/realtime-engine.md) — the notification engine contracts (single writer, publish-after-commit).
- Plan artifacts: `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/` (plan.md, tasks.md, deferred-items.md ledger, outcome/).
