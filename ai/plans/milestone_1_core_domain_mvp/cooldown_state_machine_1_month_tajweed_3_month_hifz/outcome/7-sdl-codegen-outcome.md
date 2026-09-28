# Task 7 Outcome — SDL/codegen refresh + schema-surface re-anchor

> **Date:** 2026-09-27 · **Ticket:** `docs/planning/TICKETS.md:818-868` (T2-008 — Dev 2 · M1 · 5 SP)
> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Specs:** `specs.md` (REQ-002.4, REQ-008, REQ-007) · **Design:** `plan.md` §4.1 · **Task def:** `tasks.md` Phase 3
> **Scope guard:** Task 7 regenerated the two checked-in codegen artifacts and re-anchored the SDL-surface suite. ZERO production source changes, ZERO config changes (`codegen.ts` and `scripts/generator/generate-gql-schema.ts` byte-untouched), `schema.graphql` never hand-edited (only regenerated, idempotence proven). No `git commit` (orchestrator-owned — artifacts left staged-in-worktree, nothing staged by this task).

---

## 1. Generated SDL — the three expected surface items (actual generated lines)

`bun run generate:gqlSchema` → wrote `frontend/graphql/generated/schema.graphql` (61002 → 61105 bytes, +8 lines, exit 0). Verified verbatim from the regenerated file:

```graphql
enum ApplicantCooldownState {
  Active
  Expired
  None
}

type ApplicantProfile {
  canPurchaseVerification: Boolean!
  cooldownActive: Boolean!
  cooldownState: ApplicantCooldownState!
  cooldownUntil: DateTime
  id: Int!
  lastAttemptAt: DateTime
  status: ApplicantStatus!
  verificationAttempts: Int!
}

  adminExtendApplicantCooldown(additionalDays: Int!, applicantId: Int!): ApplicantProfile!
```

- **Enum members** are the TS member names `None` / `Active` / `Expired` (the `ApplicantStatus` precedent); the lexicographic engine renders the SET sorted (`Active, Expired, None`) — same set as the tasks.md literal `enum ApplicantCooldownState { None Active Expired }`, set-compared in the pins.
- **Mutation args** render in the engine's sorted order `additionalDays: Int!, applicantId: Int!` — exactly the Task-6 fallout prediction; the tasks.md literal (`applicantId: Int!, additionalDays: Int!`) is the same two-arg set, order-free. The sorted-position pin (§4) anchors the applicant write directly after `adminCreateUser` (shared `adminExtend` prefix; `Applicant` < `Subscription`).
- `.gitignore` does NOT exclude the generated artifacts (`git check-ignore` → not ignored; both are git-tracked) — they ride the orchestrator's commit.

## 2. Files created / modified

| File | Change |
|---|---|
| `frontend/graphql/generated/schema.graphql` | REGENERATED (generator output only) — +8 lines: the 4-line `ApplicantCooldownState` enum block, the `cooldownState: ApplicantCooldownState!` field on `ApplicantProfile`, and the `adminExtendApplicantCooldown(additionalDays: Int!, applicantId: Int!): ApplicantProfile!` Mutation root field. |
| `frontend/graphql/generated/gql/graphql.ts` | REGENERATED via `bun codegen` — **byte-identical to the prior commit** (exit 0, "Generate outputs" ✔). Expected: the codegen emits operation-derived types only (`typescript-operations` + `typed-document-node`), and ZERO frontend document consumes the new surface yet (grep over `frontend/graphql/sharedDocuments/` + `frontend/views/` → zero hits). The generated module is in sync with the refreshed SDL; the cooldown-specific types materialize when the next ticket's documents are authored and codegen re-runs. |
| `backend/graphql/test/schema-surface.test.ts` | RE-ANCHORED — the four stale surface-freeze pins extended + ONE new positive describe block (§4/§5). 84/5 → **93/0**. |

## 3. Schema-surface re-anchor detail (`backend/graphql/test/schema-surface.test.ts`)

The five stale pins flagged by Task 6 (84/5, baseline 89/0) — all five enumerated in `outcome/6-graphql-outcome.md` §4 — resolved as:

1. **Mutation inventory** — new pinned constant `APPLICANT_COOLDOWN_MUTATION_FIELDS = ["adminExtendApplicantCooldown"]` spread into the frozen additions set; the sanctioned-additions title + comment extended (+ "the applicant-cooldown extension write").
2. **Admin sorted block** — `adminExtendApplicantCooldown` inserted into the contiguous admin slice between `adminCreateUser` and `adminExtendSubscription`; the block census 17 → 18 (comment + slice length updated, ordering narrative extended).
3. **Enum inventory** — new pinned constant `APPLICANT_COOLDOWN_ENUMS = ["ApplicantCooldownState"]` spread into the frozen enum set; title + comment extended.
4. **Whole-schema named-type delta** — `...APPLICANT_COOLDOWN_ENUMS` spread into the additions array (the enum is a new named SDL type); title extended.
5. **Committed-SDL codegen sync** — self-resolving once the SDL was regenerated: the committed file is byte-identical to a fresh `printSchema(lexicographicSortSchema(graphQLSchema))` emission (passing).

**Positive pins (NOT snapshot-blind):** new describe block `applicant cooldown surface — enum vocabulary + read field + admin extension write`, 4 tests:
- `ApplicantCooldownState` carries EXACTLY the 3 canonical values — wire names = TS member names AND runtime values = TS member values (`active` / `expired` / `none`), plus single-source agreement against the imported canonical TS enum itself (mirrors the `NotificationType` pin shape).
- `ApplicantProfile.cooldownState` exists on the canonical object and is NON-NULLABLE `ApplicantCooldownState!` (instanceof-guarded, fail-fast).
- `adminExtendApplicantCooldown` returns `ApplicantProfile!` with EXACTLY the two required args (`additionalDays: Int!`, `applicantId: Int!`), no third arg smuggled (closed arg whitelist).
- The mutation carries the EXACT `$all` conjunction `{ authenticated: true, role: [UserRole.Admin] }` off the Pothos extensions snapshot (scope keys exactly `["authenticated", "role"]`, role set exactly `[UserRole.Admin]`) — mirrors the admin-governance describe.

## 4. Verification results

| Gate | Command | Result |
|---|---|---|
| SDL generation | `bun run generate:gqlSchema` | ✅ exit 0 — wrote the 3 surface items (+8 lines); re-run → byte-identical 61105 bytes (idempotent generator, no manual edits) |
| Frontend codegen | `bun codegen` | ✅ exit 0 — regenerated `gql/graphql.ts` byte-identical (zero frontend consumers yet — §2) |
| 7.QL | `bun tsgo` | ✅ exit 0 — **0 errors** (codegen introduced zero type errors; sub-loop on generated files N/A per task def) |
| 7.TE | `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts` | ✅ **93 pass / 0 fail / 614 expect() calls** (was 84/5; +4 positive pins) |
| 7.TE hygiene | `bun run scripts/health/sub-loop.ts backend/graphql/test/schema-surface.test.ts --lifecycle duplicates` | ✅ exit 0 (tsgo → oxlint → biome:check → lint:type-aware → check:duplicates) |
| Regression (graphql tier) | `bun run test/scripts/run-test.ts backend/graphql/test/admin-applicant-cooldown.wire.test.ts` | ✅ **12 pass / 0 fail / 54 expects** — the Task-6 wire contract stays green against the regenerated SDL (200/403/401 + SDL + audit + two-source split) |
| 7.SEC | secret-pattern grep over both generated artifacts (`secret`, `password`, `private key`, `api key`, `bearer`, `credential`, `DATABASE_URL`, `postgresql://`, `sk-`/`ghp_`/`AKIA` key shapes) | ✅ only pre-existing schema API vocabulary (`password: String!` args/inputs of the auth/onboarding mutations + contract docstrings) — zero key material, credentials, or connection strings |
| 7.SR | `git diff --stat codegen.ts scripts/generator/generate-gql-schema.ts graphql.config.yml` | ✅ empty — codegen config byte-untouched; `schema.graphql` is exactly generator output (fresh-emission sync test passing + idempotence re-run) |
| Hygiene (authored delta) | diff-scoped greps over the 122 added test lines | zero `console.*`, zero plan-artifact/REQ/task references, no `Translation.` enum, no two-arg `getTranslations` |

## 5. Pipeline checklist evidence

- **7.QL** ✅ — per task def, the sub-loop is N/A on generated files; `bun tsgo` → exit 0 (0 errors) after both codegen steps. The AUTHORED file of this task (schema-surface.test.ts) went through the full `--lifecycle duplicates` sub-loop → exit 0.
- **7.TE** ✅ — the SDL-surface suite asserts the new enum/field/mutation on the BUILT schema (not merely the committed text): 4 positive pins + the 4 re-anchored freeze inventories + the byte-identical committed-SDL sync. 93/0.
- **7.SEC** ✅ — generated artifacts carry schema API shape only; the auth surface's `password`/token vocabulary is field DECLARATION, not secret material (§4). No `.env` values, keys, or connection strings leak into either artifact.
- **7.SR** ✅ — `codegen.ts` / `generate-gql-schema.ts` / `graphql.config.yml` untouched (empty diff); `schema.graphql` regenerated only (never hand-edited — proven by the deterministic fresh-emission sync pin + the byte-identical generator re-run).
- **7.IV** ✅ — rule files read before/while implementing: root `AGENTS.md`, `backend/AGENTS.md`, `backend/graphql/AGENTS.md` (the enum-registration rule's step 5: "Run `bun run generate:gqlSchema` then `bun codegen` after registering a new enum"), `frontend/graphql/AGENTS.md` (generated-types policy — operation-derived only, single `graphql.ts`), `.agents/instructions/backend.instructions.md` (§ GraphQL Schema Generation: both steps required).

## 6. Notes for downstream tasks

- **Orchestrator (commit):** the worktree carries exactly 3 modified files — `frontend/graphql/generated/schema.graphql`, `frontend/graphql/generated/gql/graphql.ts` (byte-identical rewrite, may show as unchanged in some diffs), and `backend/graphql/test/schema-surface.test.ts` — plus the plan's own `tasks.md` (checkbox flips) and this outcome. Nothing staged, no commit performed.
- **Next ticket (frontend):** `gql/graphql.ts` currently has ZERO cooldown-derived operation types by design — author the shared documents (e.g. the admin-extension mutation document selecting `id status cooldownUntil cooldownActive canPurchaseVerification cooldownState`), re-run `bun codegen`, and the typed-document-node types materialize. `ApplicantCooldownState` maps to a native TS enum (`enumType: "native"` in the untouched config).
- **Task 8 (final gate):** the schema-surface suite is back to a clean 93/0 freeze; any further schema change now fails the inventory pins by design. The committed-SDL sync pin enforces `generate:gqlSchema` on every future Pothos change.
- **Task 9 (review wave):** the new describe block's closed-arg-whitelist pin (`expect(field.args).toHaveLength(2)`) + the `$all` conjunction pin are additional static anchors beside the wire-tier smuggling probe.
