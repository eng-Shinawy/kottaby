# DEV3-005 — Tasks

> Rules: checkboxes move `[ ]` → `[-]` (in progress) → `[x]` (closed with outcome file). Scoped commits only. Every subagent re-reads specs.md + plan.md + worklog.md before touching code.

- [x] 0.1 Baseline capture: record current gates (tsgo/biome/eslint/oxlint counts, student+teacher suite counts, battery totals) into `outcome/0.1-baseline.md`; seed `deferred-items.md` (F1, F2 below). *(orchestrator or delegate)*
- [x] 1.1 Schema (R-101): five nullable columns on `session`; push dev+test DBs; `$inferSelect` flows through repo barrel; tsgo 0.
- [x] 1.2 Repository (R-102/104/106 primitives): `openDisputeOnce`, `resolveDisputeCancelOnce` (+ same-lane refund reuse inside the transaction), `resolveDisputeCompleteOnce`, `listAdminDisputed`, `countAdminDisputed`; repo tests green.
- [x] 1.3 Service (R-102/103/104/107/112): `openSessionDispute`, `resolveSessionDispute` (admin), cancel-reason persistence inside the existing `cancelSession` UPDATE; id/reason guards pre-DB; probe-chain classifications; INV-S1/S2 regression tests; service suite green.
- [x] 2.1 GraphQL (R-105/106/108): DisputeResolution enum registration, 2 mutations (authScopes: participant=$all{authenticated} service-side predicate; resolve=$all{authenticated, role:[Admin]}), admin query, Session object +5 fields with exhaustive mappers, SDL gates (schema-surface DEV3_005 pins + freeze title, session-sdl suite, allowlist untouched), codegen green.
- [x] 3.1 Frontend documents + student/teacher UI (R-109/110): TypedDocumentNodes, dispute action+dialog on both rows (per-row in-flight slots), DISPUTED chip styling (amber tokens, RTL-safe), cancel-reason meta line, cancel CTA disabled on disputed, snackbars + error mapping, ar/en keys + parity suite grown (0 drift), component suites green.
- [x] 3.2 Admin UI (R-109/111): nav item + `/disputes` page (admin-gated like `/users`), sticky-bar paged list, arbitration dialog (resolution radio + note + in-flight submit), empty state via `SessionsEmptyState`, i18n ar/en + parity, admin component suite green.
- [x] 4.1 Full gates (orchestrator): tsgo/biome/eslint/oxlint, full battery delta 0 vs 0.1 baseline, live agent-browser dispute flow (student opens → chip flips; admin resolves both outcomes; teacher view consistent), hydration badge stays clean.
- [x] 5.1 Close-out: `outcome/final-outcome.md`, deferred-items sweep (F1/F2 forward, no ❌/⚠️), scoped commit(s), push, worklog entries.

## Deferred (pre-declared)

- **F1** — dispute actor-id columns + audit-log entries for open/resolve (owner: future ticket; not required for arbitration v1).
- **F2** — post-completion dispute window (requires amending DEV3-004's INV-S1 terminal ruling; owner: DEV3-022 conversation).
