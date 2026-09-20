# Task 10 Outcome — Drawer UI: documents, hooks, section, dialogs, i18n namespace

**Date**: 2026-09-19
**Branch**: `feat/admin-subscription-management`
**Agent**: Task 10 Completion Subagent
**Scope**: NEW `frontend/graphql/sharedDocuments/admin/admin-subscriptions.documents.ts` (+ contract test), NEW `frontend/views/admin/students/subscriptions/` surface (section / row card / rows view / helpers / 4 dialogs / action-dialogs orchestrator / atoms / action hooks), NEW `subscriptionAdmin` i18n namespace (5-step registration + parity), drawer mount, codegen refresh of typed hooks.

---

## 1. Summary

The admin student drawer is now the full subscription-management surface. `admin-subscriptions.documents.ts` ships `adminStudentSubscriptionsQueryDocument` plus the four mutation documents (extend / renew / cancel / change plan), **every selection set carrying `id`** for cache-safe refetches, with `admin-subscriptions.documents.test.ts` pinning that contract (9/9, ×2). The documents are exported through `sharedDocuments/admin/index.ts`, and the codegen refresh regenerated `frontend/graphql/generated/gql/graphql.ts`, so the hooks consume **typed** documents (`TypedDocumentNode`) — no hand-written result/input types.

`useSubscriptionAdminActions` wraps the four mutations in `useMutation` and drives the drawer refresh via **refetch of the drawer query** (data stays fresh without cache surgery; the section's read runs `cache-and-network` so current rows remain visible while the fresh list streams in). `SubscriptionAdminSection` hosts the query + the four dialogs + the shared feedback snackbar; `SubscriptionRowsView` renders the list (honest empty state) and `SubscriptionRowCard` renders each row with the per-status action matrix (active → extend/cancel/change plan; expired → renew; pending/cancelled → none) and the directory label-value recipe with tone-lane status chips. The four dialogs are presentational (MUI v9 `sx`-only, ≥44px touch targets, `aria-labelledby`): they forward only validated submit intents and render server-localized denials in inline error alerts, staying open on every failure arm. `SubscriptionActionDialogs` orchestrates open-state per row via `subscriptionDialogAtoms`; pure logic (newest-first sort, `parseExtendDays`, `normalizeCancelReason`, `eligibleChangePlanTargets`, `ACTIONS_BY_STATUS`) lives in `subscriptionAdmin.helpers.ts` for the no-render test tier.

The **`subscriptionAdmin` i18n namespace** went through the full five-step registration (REQ-0.5): types leaf (`shared/locale/types/subscriptionAdmin/`) → `en` labels → `ar` labels → namespaces registry/index wiring → message-type integration (`shared/locale/types/message.ts` + both `messages.ts`), with the **runtime parity test** enforcing exact en/ar key-set parity (21/21, ×2). Drawer copy resolves via `useAppTranslation(SubscriptionAdmin)`; dialog dismiss reuses `common.cancel` (single-sourced); server denials render verbatim (already localized). Mount: `AdminStudentDetailDrawer` was read first, then the section was inserted **directly below the balances section** — the drawer itself stays presentational.

## 2. Files created / modified

**Modified (8):**

| # | File | Change |
|---|------|--------|
| 1 | `frontend/graphql/generated/gql/graphql.ts` | Codegen refresh — typed inputs/results + typed hooks for the read + four mutations. |
| 2 | `frontend/graphql/sharedDocuments/admin/index.ts` | Barrel export of the new subscription documents module. |
| 3 | `frontend/views/admin/students/AdminStudentDetailDrawer.tsx` | Mount `SubscriptionAdminSection` below the balances section. |
| 4 | `shared/locale/en/messages.ts` | `subscriptionAdmin` namespace registration (en). |
| 5 | `shared/locale/ar/messages.ts` | `subscriptionAdmin` namespace registration (ar). |
| 6 | `shared/locale/namespaces/index.ts` | Namespace module wiring. |
| 7 | `shared/locale/namespaces/registry.ts` | Namespace handle registration. |
| 8 | `shared/locale/types/message.ts` | `SubscriptionAdminLabels` integrated into the `Translations` union/interface. |

**New:**

| Path | Contents |
|------|----------|
| `frontend/graphql/sharedDocuments/admin/` | `admin-subscriptions.documents.ts` (query + 4 mutations, `id` everywhere), `admin-subscriptions.documents.test.ts` (contract test). |
| `frontend/views/admin/students/subscriptions/` | `SubscriptionAdminSection.tsx`, `SubscriptionRowCard.tsx`, `SubscriptionRowsView.tsx`, `subscriptionAdmin.helpers.ts`. |
| `frontend/views/admin/students/subscriptions/dialogs/` | `ExtendSubscriptionDialog.tsx`, `RenewSubscriptionDialog.tsx`, `CancelSubscriptionDialog.tsx`, `ChangeSubscriptionPlanDialog.tsx`, `SubscriptionActionDialogs.tsx` (orchestrator), `subscriptionDialogAtoms.tsx` (shared dialog shell + actions), `index.ts`. |
| `frontend/views/admin/students/subscriptions/hooks/` | `useSubscriptionAdminActions.ts` (4 `useMutation` wrappers + drawer-query refetch). |
| `shared/locale/types/subscriptionAdmin/` | `index.ts` — `SubscriptionAdminLabels` interface (compile-typed both leaves). |
| `shared/locale/en/subscriptionAdmin/` | en label tree. |
| `shared/locale/ar/subscriptionAdmin/` | ar label tree (exact key parity). |

## 3. Test results

- `admin-subscriptions.documents.test.ts` — **9 pass / 0 fail ×2** (documents exist, `id` in every selection set, barrel export).
- `subscriptionAdmin` namespace **parity test — 21 pass / 0 fail ×2** (en/ar key-set parity, grouped sub-block leaves, zero dead keys).
- GraphQL integration suite (`test/...subscription-admin.test.ts`) — **26 pass / 26 stable** (wire surface unchanged by the frontend layer).
- `bun tsgo` — **0 errors**.

## 4. Quality loop (`sub-loop.ts <f> --lifecycle duplicates`)

Batch 1 (all 14 in-scope files):

| File | Exit |
|------|------|
| `subscriptions/SubscriptionAdminSection.tsx` | 0 |
| `subscriptions/SubscriptionRowCard.tsx` | 0 |
| `subscriptions/SubscriptionRowsView.tsx` | 0 |
| `subscriptions/subscriptionAdmin.helpers.ts` | 0 |
| `dialogs/CancelSubscriptionDialog.tsx` | 0 |
| `dialogs/ChangeSubscriptionPlanDialog.tsx` | 0 |
| `dialogs/ExtendSubscriptionDialog.tsx` | 0 |
| `dialogs/RenewSubscriptionDialog.tsx` | 0 |
| `dialogs/SubscriptionActionDialogs.tsx` | 0 |
| `dialogs/index.ts` | 0 |
| `dialogs/subscriptionDialogAtoms.tsx` | 0 |
| `hooks/useSubscriptionAdminActions.ts` | 0 |
| `admin-subscriptions.documents.ts` | 0 |
| `admin-subscriptions.documents.test.ts` | 0 |

**14/14 exit 0 — no ceiling breaches (75-line fn / 300-line file), no splits needed.** After the SR comment scrub (§6), the 8 touched files (7 subscriptions files + `shared/locale/types/subscriptionAdmin/index.ts`) were re-run: **8/8 exit 0**.

## 5. Security (10.SEC)

- The drawer lives inside the admin-gated `/students` page (`withPageAuth([Admin])`); the section (and every mutation it hosts) only ever renders inside the admin directory drawer — no student-facing leak.
- Per-status lifecycle actions: active → extend/cancel/change plan; expired → renew; pending/cancelled → none (exhaustive `Record<SubscriptionStatus, …>` matrix, enum-members only).
- Client-side validation is deliberately narrow: whole-days `> 0` for extend (`parseExtendDays`) and the 200-character cancel-reason seam cap; everything else degrades to the server's localized denial (the server keeps window-ceiling and eligibility authority).

## 6. Single-source / interlock (10.SR / 10.IV)

- **10.SR**: plan-artifact grep (`REQ-`, `Task 10`, `Phase 7`, `specs.md`, `tasks.md`, `.ai/plans`) over the subscriptions tree + documents module + the three `subscriptionAdmin` locale dirs initially returned **16 hits — all `REQ-*` tokens inside comments/docblocks**; all scrubbed (comments reworded, zero behavior deltas), re-grep → **0**, and the 8 edited files re-passed the QL sub-loop. No runtime string literals for statuses/directions — comparisons flow from VALUE imports through exhaustive Record tables.
- **10.IV**: mount followed the read-file-first rule (`AdminStudentDetailDrawer` read before editing; section placed below balances); MUI v9 `sx`-only styling with theme-palette/tone lanes, no hardcoded colors; RTL/LTR inherited from the drawer; i18n through the registered namespace with property access only (never call-by-key); dialogs follow the existing dialog precedent (presentational + server-denial surfacing). No commits/pushes.

## 7. Carry-forward (Tasks 11 / 12)

- **Success copy contract**: the change-plan success copy's **carried/forfeited session counts ride the mutation payload** (the hook's job) — the dialog carries no proration math; Tasks 11/12 must keep consuming payload numbers, never recompute client-side.
- **Zero-notification contract**: the whole admin subscription surface is journey-pinned (`NotificationEngine.publishReceipts` spied, zero dispatches at every step — Task 8); downstream tasks must not introduce client-initiated notification expectations on this surface.
- Documented scope-extension precedent (Task 9): admin mutation gates use inlined scope literals — relevant if Tasks 11/12 touch backend auth again.
- Sandbox runbook (from Task 7): postgres up + port-3066 orphan eviction before suite runs; first cold turbopack boot may exceed a 5-min window.
