# DEV3-005 — Implementation Plan

**Feature:** `dev3-005-session-dispute-states`
**Branch:** `feat/dev3-004-session-creation-lifecycle-scheduled-sta` (continues the DEV3-004 line; owner merges to main)
**Specs:** see `specs.md` in this directory (R-101..R-112)

---

## §1 — Architecture

### §1.1 State machine delta (the ONLY allowed edges)

```
                    ┌──────────────────────────────────────────┐
                    │            (INV-S1/S2 UNCHANGED:          │
                    │  completed, cancelled remain terminal —   │
                    │  zero outgoing edges, structural)         │
                    └──────────────────────────────────────────┘

 scheduled ──┐
 started  ──┴──▶ disputed ──▶ cancelled   (admin, CANCEL outcome: same-lane refund when fee_held)
                 │
                 └────────▶ completed   (admin, COMPLETE outcome: started_at required, hold consumed)
```

Everything else (scheduled→started, started→completed, participant cancels) is UNCHANGED from DEV3-004.

### §1.2 Canonical names and placement (D6 lesson honored)

- Service methods live IN `backend/services/classes/session-lifecycle.service.ts` (the file that owns the machine): `openSessionDispute`, `resolveSessionDispute`.
- Repository methods live IN `backend/db/repo/classes/session.repository.ts` (guarded-UPDATE family): `openDisputeOnce`, `resolveDisputeCancelOnce`, `resolveDisputeCompleteOnce`, `listAdminDisputed`, `countAdminDisputed`. Guarded predicates follow the existing zero-row-classification contract.
- GraphQL mutations live IN `backend/graphql/mutation/classes/session-lifecycle.mutation.ts`; the admin query IN `backend/graphql/query/classes/session.query.ts` (the query barrel that already hosts `sessionPage`).
- Enum registration IN `backend/graphql/pothos/shared/enum.pothos.ts` (enum-object form only).
- Frontend documents IN `frontend/graphql/sharedDocuments/scheduling/session.documents.ts` (the 7-doc family grows by the dispute docs; codegen document-driven).

### §1.3 Reuse map (extend, never duplicate — the DEV3-004 traceability clause)

| Need | Reused primitive |
|---|---|
| Guarded UPDATE + zero-row classification | `startSessionOnce`/`cancelSession`-family predicate style + the ONE cold probe read |
| Refund on arbitration CANCEL | the exact same-lane refund primitive inside `cancelSession`'s transaction (call the SAME repository/service function — no copy) |
| Hold consumption on arbitration COMPLETE | mirror `completeSession`'s `fee_held=false` write in the resolve UPDATE |
| Positive-safe-integer id guard | the existing REQ-054 shape guard helper |
| i18n messages | `getServerTranslations(locale)` + the sessions/server namespaces |
| paged list + clamps | the participant list predicate builder family + DEFAULT_PAGE_SIZE/MAX_PAGE_SIZE |
| UI row/dialog/chips/empty states | `SessionRow`/`SessionStatusFilterChips`/`CancelSessionConfirmDialog`/`SessionsEmptyState` component suite |

## §2 — Database delta

`session` gains: `cancel_reason varchar(500)`, `dispute_reason varchar(500)`, `disputed_at timestamptz`, `resolution_note varchar(500)`, `resolved_at timestamptz` — all nullable, no defaults, no indexes beyond existing (disputed rows are a filtered minority; the admin list filters by status on an existing-status column — revisit index at real scale). Push-only flow: `bun --no-env-file run scripts/dbActions/index.ts --env-file=.env push` (dev) AND `--env-file=.env.test push` (test). PostgreSQL 17 user-space cluster at /tmp/pgdata (restart command in worklog env-setup entry).

## §3 — GraphQL surface delta (freeze-pin extension)

- Mutations: `openSessionDispute(id: ID!, reason: String!): Session!`, `resolveSessionDispute(id: ID!, resolution: DisputeResolution!, note: String): Session!`
- Query: `adminDisputedSessions(filter: SessionListFilterInput, limit: Int, offset: Int): SessionPage!`
- Enum: `DisputeResolution { Cancel Complete }`
- Session type +: `cancelReason`, `disputeReason`, `disputedAt`, `resolutionNote`, `resolvedAt` (all nullable)
- Gates: schema-surface freeze test grows a `DEV3_005_*` pin block + freeze title updated; session-sdl suite extended; public-operations allowlist UNTOUCHED (all three ops are authed → not allowlist material, Rule 8.4); codegen run after documents land (4.1 lesson: document-driven).

## §4 — Frontend delta

- Student + teacher session rows: dispute action (only when status ∈ scheduled|started), dispute dialog (reuse the cancel-dialog structural pattern: portal-safe controlled textarea, 500-char counter, per-row in-flight slot), DISPUTED chip (amber accent tokens — never raw hex; RTL-safe), cancel-reason meta line on cancelled rows, cancel CTA disabled on disputed rows.
- Admin: nav item `disputes` (icon GavelOutlined or ScaleOutlined — *Outlined family), page at `app/(dashboard)/disputes/page.tsx` admin-gated like `/users`, sticky-bar list + arbitration dialog (resolution radio, note, submit with in-flight state), row styling consistent with sessions rows.
- i18n: sessions namespace + admin/dashboard namespace ar/en, parity suite grown to zero drift.

## §5 — Test strategy

| Layer | File family | Coverage |
|---|---|---|
| Repo | `backend/db/repo/classes/session.repository.test.ts` family | guarded dispute UPDATE predicates, zero-row returns, admin list predicate + clamps |
| Service | `backend/services/classes/session-lifecycle.service.test.ts` family | R-102/104/107/112 paths: happy transitions, probe chain, pre-DB validations, INV-S1/S2 regression, refund/consume atomicity, oracle-safety, admin-only resolve |
| SDL/pothos | `backend/graphql/test/` schema-surface + session-sdl | surface freeze pins (DEV3_005 block), enum registration, allowlist untouched |
| UI components | `test/ui/components/student|teachers|admin/` | dispute dialog branches (open/submit/error/localed), chip render, cancel-reason line, admin page list+dialog branches |
| Parity | sessions namespace parity suite | ar/en zero drift |
| Live | agent-browser (orchestrator) | open dispute as student → row chip flips; admin resolves → terminal; badges clean |

## §6 — Gates and conventions (inherited, binding)

- tsgo 0 · biome check 0 · eslint 0/0 · oxlint 0 · sub-loop `--lifecycle` duplicates exit 0 on touched files.
- Thin resolvers (no try/catch, no repo imports), `$all` conjunction authScopes, BOPLA minimal surface.
- No `git add .` — scoped commits only; no Co-authored-by; push after gates with `git pull --rebase origin <branch>` first.
- Worklog: every subagent reads `/home/z/my-project/worklog.md` first and appends its section after.
- Outcome files per task in `outcome/` of this directory.
