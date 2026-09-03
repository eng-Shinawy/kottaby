# DEV3-005 — Session Dispute States (disputed transition surface + admin arbitration + cancel-reason persistence)

**Plan directory:** `ai/plans/sprint_1/dev3-005-session-dispute-states/`
**Created:** `2026-08-31` (cron round r3, owner instruction: "advancing DEV3-005 (session dispute states)")
**Baseline ticket:** `dev3-004-session-creation-lifecycle-scheduled-sta` (all 27 tasks complete, branch `feat/dev3-004-session-creation-lifecycle-scheduled-sta`)

---

## Boundary and authority

- DEV3-004 specs pinned the `disputed` pg-enum value WITHOUT a transition surface (B.18) and recorded the forward item **D5**: "INV-S6 / INV-S7 / INV-S8 enforcement + the `disputed` transition surface" → DEV3-005 / DEV2-013 / DEV3-022.
- This ticket (per the owner's cron instruction of 2026-08-31) implements the **`disputed` transition surface + minimal admin arbitration** — the part of D5 that needs no external dependencies.
- INV-S6/S7/S8 **enforcement** (in-session availability lock, report/homework gating) stays owned by its original tickets (they depend on DEV3-006/007/DEV2-011..013 which do not exist yet). This ticket does NOT touch them.
- DEV3-004's resolver contract explicitly earmarked reason persistence for DEV3-005 ("the optional `reason` is pass-through only — DEV3-005 owns persistence"); this ticket claims that hook (`cancel_reason` column).
- The traceability note of DEV3-004 binds every consumer: "DEV3-005 … SHALL extend these guarded primitives without duplicating them; … All SHALL cite this spec's REQ ranges in their own traceability matrices."

## Invariant compatibility (binding)

- **INV-S1/S2 (terminal guards) remain structural:** `completed` and `cancelled` accept NO outgoing transition. Disputes open ONLY from `scheduled` or `started`. Post-completion disputes are out of scope (they would require amending INV-S1 — future ticket, see deferred F2).
- **`disputed` is NOT terminal:** every disputed session is resolvable by an admin to exactly one terminal state (`cancelled` or `completed`). The state machine gains edges: `scheduled|started → disputed → cancelled|completed`.
- **INV-W4/INV-S3 (zero financial writes by non-arbitration paths):** the ONLY paths allowed to touch hold money in this ticket are the two arbitration outcomes, and both must reuse DEV3-004's shipped hold primitives inside the arbitration transaction:
  - `CANCEL` outcome → the same-lane refund primitive used by `cancelSession` (refund to `held_balance_lane` provenance).
  - `COMPLETE` outcome → the same hold-consumption write used by `completeSession` (`fee_held=false`), WITHOUT any wallet credit (wallet credit stays DEV3-012 — D2).
- Oracle-safety preserved: foreign ids are indistinguishable from nonexistent ones for non-privileged callers (`SESSION_NOT_FOUND`); admin surfaces may distinguish existence (admin is trusted).

---

## Requirements

### R-101 — Dispute data columns (schema)
WHEN the plan's schema task executes THEN the `session` table SHALL gain nullable columns `cancel_reason` (varchar(500)), `dispute_reason` (varchar(500)), `disputed_at` (timestamptz), `resolution_note` (varchar(500)), `resolved_at` (timestamptz). No actor-id columns ship in this ticket (the opening/resolving actor is derivable from role + context; audit enrichment is deferred F1). The push-only migration flow (scripts/dbActions push) SHALL be used against BOTH the dev and test databases. Acceptance: `information_schema.columns` shows the five columns on both DBs; `bun run tsgo` 0; `$inferSelect` type regenerates through the repo barrel.

### R-102 — openSessionDispute mutation (participant)
`openSessionDispute(id: ID!, reason: String!): Session!`
WHEN a session participant (the row's student user or the teacher user — the same participant predicate family as `cancelSession`) invokes it with a non-empty reason (trimmed ≤ 500 chars) and the session is in `scheduled` or `started` THEN the system SHALL execute ONE guarded transactional UPDATE `SET status='disputed', dispute_reason=?, disputed_at=now()` with the predicate `id=? AND (student_id=me OR teacher_id=me) AND status IN ('scheduled','started') RETURNING *`. Zero rows SHALL be classified by the cold probe chain: nonexistent/foreign → `SESSION_NOT_FOUND`; wrong state → `SESSION_INVALID_TRANSITION`; malformed id → `VALIDATION` pre-DB (REQ-054 shape guard). Empty/oversized reason → `VALIDATION` pre-DB.

### R-103 — openSessionDispute authorization shape
The mutation SHALL be registered `{ authenticated: true }` (no role gate, mirroring `cancelSession` REQ-032/REQ-017): the participant predicate lives entirely service-side; non-participants (including admin/parent) receive the oracle-safe `SESSION_NOT_FOUND`. authScopes use the documented `$all` conjunction rules; thin resolver; DomainErrors propagate uncaught.

### R-104 — resolveSessionDispute mutation (admin arbitration)
`resolveSessionDispute(id: ID!, resolution: DisputeResolution!, note: String): Session!`
WHEN an ADMIN invokes it on a `disputed` session THEN the system SHALL, inside ONE transaction:
- resolution = `CANCEL`: guarded UPDATE `SET status='cancelled', resolution_note=?, resolved_at=now()` predicate `id=? AND status='disputed'`, AND when `fee_held=true` SHALL refund via the SAME same-lane primitive `cancelSession` uses (refund reads `held_balance_lane`, returns to that lane, flips `fee_held=false`); the refund and the status flip are one transaction — partial application is impossible.
- resolution = `COMPLETE`: guarded UPDATE `SET status='completed', ended_at=now(), resolved_at=now(), resolution_note=?` predicate `id=? AND status='disputed' AND started_at IS NOT NULL`; the hold-consumption write mirrors `completeSession` (`fee_held=false`, no wallet credit). A disputed session that never started fails `VALIDATION` pre-DB (cannot complete what never happened).
Zero rows → probe chain (`SESSION_NOT_FOUND` / `SESSION_INVALID_TRANSITION`). `note` is optional, trimmed ≤ 500, `VALIDATION` on overflow.

### R-105 — DisputeResolution enum + SDL registration
`enum DisputeResolution { Cancel Complete }` SHALL be registered in `backend/graphql/pothos/shared/enum.pothos.ts` in the enum-object form (the file's only sanctioned registration shape) and exposed on the mutation argument. The SDL surface grows by exactly: 2 mutations, 1 enum, 5 nullable Session fields (`cancelReason`, `disputeReason`, `disputedAt`, `resolutionNote`, `resolvedAt`). The schema-surface freeze test SHALL be extended with a `DEV3_005_*` pin block per the documented extension-point convention (freeze title updated: grows by the DEV3-004 quartet AND the DEV3-005 dispute pair; codegen-sync belt-and-braces re-pinned).

### R-106 — adminDisputedSessions query (admin listing)
`adminDisputedSessions(filter: SessionListFilterInput, limit: Int, offset: Int): SessionPage!`
WHEN an ADMIN invokes it THEN the system SHALL return the paged list of sessions with `status='disputed'` (newest first, honest total count, `limit` clamp 1..50 default 25 — the participant list's clamps). Admin-only: `$all { authenticated: true, role: [UserRole.Admin] }`. The underlying repository read SHALL reuse the shared participant predicate builder family (a new status-first admin predicate — NOT a bypass of the clamp/validation helpers). Non-admin callers fail the `role` leg into the canonical localized FORBIDDEN (403).

### R-107 — cancelSession reason persistence (claimed hook)
WHEN `cancelSession(id, reason)` executes successfully THEN the service SHALL persist the trimmed reason (≤ 500) into `cancel_reason` within the SAME guarded UPDATE (predicate and stamps otherwise unchanged — no behavior change to state machine, refunds, or oracle-safety). The SDL `Session` type gains `cancelReason: String` (nullable; null for rows cancelled before this ticket). This fulfils the DEV3-004 resolver-contract earmark.

### R-108 — Session Pothos object + codegen growth
The `Session` Pothos object SHALL expose the five new nullable fields with the existing mapper conventions (exhaustive pothos mappers per review R1 ruling); `bun codegen` regenerates TypedDocumentNodes; only document-driven growth is allowed (no hand edits to generated artifacts).

### R-109 — i18n parity (ar/en, sessions + admin namespaces)
All new user-facing strings SHALL exist in BOTH locales with no key drift: student/teacher dispute action + confirm dialog (title/body/reason label/submit/cancel/success snackbar/error mapping), DISPUTED status chip label, cancel-reason display line, admin nav label + disputes page strings (title, empty state, resolve dialog: resolution radio labels Cancel/Complete, note field, submit, success snackbar) + filtered/loaded states. The sessions-namespace parity suite SHALL grow to cover every new key (parity count updated, 0 drift).

### R-110 — Student/teacher dispute UI
WHEN a participant views a session row in status `scheduled` or `started` THEN the row SHALL offer a dispute action (icon button + label, per-row in-flight slot consistent with the cron-r2 hardening) opening a confirm dialog (required reason textarea, 500-char counter, error surface). On success the row SHALL re-render with the DISPUTED chip without a refetch flicker (Apollo cache normalize). Cancelled rows with a persisted `cancel_reason` SHALL display it in the meta area (truncated with tooltip). Cancel rows currently open for `disputed` sessions SHALL be disabled (state machine forbids it).

### R-111 — Admin disputes page
The admin nav SHALL gain a `disputes` item (`/disputes`, admin role) rendering a real page: paged list of disputed sessions (status filter pinned to Disputed, honest count, sticky filter bar consistent with the sessions pages), each row showing intent, fee, dispute reason (expandable full text), created/disputed timestamps, participant ids, and a resolve action opening the arbitration dialog (R-104 radio + note). The page follows the `roleDashboardRoute`/`withPageAuth` admin gating pattern used by `/users`/`/teachers`. Empty state uses the shared `SessionsEmptyState` (icon-circle variant, distinct filtered-empty copy NOT needed here — single status).

### R-112 — Regression containment
The terminal-guard suite (REQ-072 family) SHALL extend with: disputed NOT reachable from completed/cancelled (INV-S1/S2 intact); resolved sessions accept no further transitions; open-dispute on a disputed session → `SESSION_INVALID_TRANSITION`; double-resolve → `SESSION_INVALID_TRANSITION`; non-participant open-dispute → `SESSION_NOT_FOUND`; non-admin resolve → `FORBIDDEN`; refund atomicity (CANCEL outcome on a held session refunds exactly the recorded lane; COMPLETE outcome consumes the hold; zero fee_held rows change nothing financially).

## Non-goals (this ticket)

- Wallet credit on arbitration COMPLETE (DEV3-012/D2), notifications (D1), student booking UI (D4), post-completion disputes (F2), dispute-audit actor columns (F1), dispute deadline/sla mechanics (none specified upstream).
