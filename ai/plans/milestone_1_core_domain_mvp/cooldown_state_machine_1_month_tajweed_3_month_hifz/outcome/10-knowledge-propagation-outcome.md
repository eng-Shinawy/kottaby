# Task 10 Outcome — Phase 6 Knowledge Propagation & Close-Out

> **Date:** 2026-06-01 · **Ticket:** `docs/planning/TICKETS.md:818-868` (Dev 2 · M1 · 5 SP)
> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Requirements:** REQ-001 (protocol close-out), REQ-006 (consolidated two-source-split evidence)
> **Scope guard:** docs-only delta — zero source files, zero `AGENTS.md`/`.agents/instructions/*` contact.

---

## 1. The knowledge doc

**Created:** `docs/teachers/applicant-cooldown.md` — durable engineering documentation, no plan-artifact references (grep-verified: zero `REQ-`, `Task N`, `Phase N`, `tasks.md`, `plan.md`, `deferred-items`, `outcome/` tokens across the doc and the three edited hosts).

Section list:

1. **Overview** — the cooldown concept (failed evaluation → timed re-purchase lock), 30-day Tajweed / 90-day Hifz minimums via the failure write path, and the explicit "what cooldown does NOT block" obligation (login, sessions, student privileges; the gate covers ONLY `purchaseVerificationPlan`).
2. **Cooldown source of truth** — `applicants.cooldown_until` as the single column; strict-`>` predicate; the full `(status, cooldownState)` transition table including terminal-on-pass `finalizeOnCertification` NULLing and the "no clearing writer besides certification" rule.
3. **The two-source split** — re-purchase gating reads `applicants.cooldown_until`; login/session-class gating reads `users.suspended*` (binding reconciliation per `docs/teachers/applicant-lifecycle.md` §2.3); cooldown machinery MUST NEVER write the governance triple; the **five test locks** enumerated (repo static pins, service direct-row oracle, wire governance-triple oracle, journey lock after both writer kinds, diff-scoped grep review gate).
4. **The derived `cooldownState` read-model** — `None | Active | Expired` definitions, strict `>` boundary, pure compute from `cooldown_until` + one captured `now`; NOT a stored column, NOT a pgEnum (single-source-of-truth rationale); the one shared `deriveCooldownState` helper consumed by both profile producers; mutual consistency with `cooldownActive`/`canPurchaseVerification` (including the `passed` terminal arm and the expected per-surface read-instant divergence).
5. **The admin cooldown-extension primitive** — signature; `max(currentCooldownUntil, now) + additionalDays` lengthen-only semantics (pre-epoch sentinel for null/expired base); eligibility (`pending`/`in_evaluation`/`failed` via the guarded WHERE; `passed` → terminal `APPLICANT_ALREADY_CERTIFIED`, including the concurrent-certification collapse onto the typed rejection); bounds 1..3650 integer validated pre-DB; session-sourced `actorId` (no wire actor arg); defense-in-depth gate ordering (authScopes → `requireAdminUser` → `assertActiveActorAdmin` → bounds → tx); one-transaction write+audit atomicity with the `outerTx` composition seam; accepted last-write-wins concurrency (never shortens, both attempts audit-observable).
6. **GraphQL surface** — `ApplicantCooldownState` enum (wire names = TS member names `None/Active/Expired`, enum-object Pothos registration, non-pgEnum), `cooldownState: ApplicantCooldownState!` on `ApplicantProfile`, `adminExtendApplicantCooldown(applicantId: Int!, additionalDays: Int!): ApplicantProfile!` (engine renders args sorted), and the error-code table (`APPLICANT_COOLDOWN_ACTIVE`, `APPLICANT_ALREADY_CERTIFIED`, `APPLICANT_COOLDOWN_EXTENSION_INVALID`, `APPLICANT_NOT_FOUND`) with producers.
7. **Operational notes** — audit-trail fidelity nuance (`from` = the guard-READ snapshot under concurrency, not a serialized before-image); the `AuditActionType.Adjust` / `entityType: "applicant"` / details-JSON contract (`{"field":"cooldown_until","from","to","additionalDays"}`, writer-truncated, `entity_type_entity_id_idx` history order); the concurrency hardening path (purpose-built `ApplicantRepository.findByIdForUpdate` in a future ticket — never an in-place change to the guarded write); the surface-freeze re-anchoring rule for `schema-surface.test.ts` / `sdl-static-assertions.test.ts`; no prepared statements on writes.
8. **Downstream consumers (child tickets)** — `Failed Applicant → Student Record Conversion` (`docs/planning/TICKETS.md:872-912`): what it inherits (privileges boundary, split, co-existence) and that the fail path writes no role-child rows; `Admin Override of Evaluation Results` (`docs/planning/TICKETS.md:916-958`): composes the primitive for grant-re-evaluation / reject / certify instead of minting a second cooldown writer; the "any new writer MUST go through this discipline" rule.
9. **Where it lives** — 15-row file map (enum + guard test, types, repo method, service, admin mapper, pothos registration + field, mutation, i18n leaf, repo suite, service suite, wire suite, surface suite, journey) with one-line purpose each.
10. **References** — sibling docs, error-contract doc, ticket anchors, test-lock map.

Every contract in the doc was verified against the shipped code before writing (service `:178/:434/:142-145`, repo `:561`, mutation `:119-142`, pothos `:132/:61`, mapper `:134-135`, generated SDL `:632/:641`, i18n `labels.ts:160`/`en:68`/`ar:67`), and every referenced file path was existence-checked on disk.

## 2. Links added (one per host, matching each host's backtick-path style)

| Host doc | Placement | Link text |
|---|---|---|
| `docs/teachers/applicant-lifecycle.md` | §2.3 (after the two-source-split paragraphs) | Writer-side pointer: failure stamp + `adminExtendApplicantCooldown` + derived `cooldownState` → `docs/teachers/applicant-cooldown.md` |
| `docs/teachers/evaluation-rubric-scoring.md` | End of "Failure-area derivation & cooldowns" | Consumer pointer: the state machine that consumes the stamp (read-model, extension primitive, governance boundary) |
| `docs/teachers/verification-plan-purchase.md` | Sibling-docs blockquote (header) | `docs/teachers/applicant-cooldown.md` (the machine that arms the `APPLICANT_COOLDOWN_ACTIVE` denial + the admin extension behind it) |

Both referenced docs exist on disk (no invented files): `docs/teachers/evaluation-rubric-scoring.md`, `docs/teachers/verification-plan-purchase.md`. The `docs/planning/TICKETS.md:<lines>` anchor style follows in-repo precedent (`docs/billing/escrow-and-wallet-crediting.md`, `docs/curriculum/lessons-crud.md`).

## 3. Patterns / gotchas extracted from the outcome corpus (2+ occurrences)

1. **Real-TS-enum + enum-object Pothos registration discipline** (occurrences: Task 1, Task 6, R9/R12 pattern-consistency audits) — GraphQL enums are backed by real TS enums in `backend/enum/` with fail-closed guards, registered once by passing the enum OBJECT; string-literal unions and pgEnums are prohibited. Documented as the `ApplicantStatus` precedent the cooldown enum mirrors.
2. **Guarded WHERE-predicate IS the concurrency mechanism** (Tasks 2/4, plan §6, R3/R9/R12) — `extendCooldownOnce` matches the `transitionToFailed` discipline byte-for-byte in shape (pre-states folded into WHERE, `RETURNING` → `row ?? null`, tx-required); `FOR UPDATE` explicitly not used (D4) — documented as the hardening path.
3. **Captured-now single-instant derivation** (Tasks 4/5, midpoint-R1 Finding 1, R12) — one `new Date()` per invocation drives every cooldown observable; the shared exported `deriveCooldownState` is the one strict-`>` boundary for both profile producers (the admin mapper derives the boolean OFF the enum to keep the trio consistent).
4. **Sub-loop is single-file and TS-scoped** (Tasks 3/2/4/6/8 all rediscovered it) — the script takes ONE file per invocation and its lint stages skip markdown; this task recorded the markdown behavior explicitly (§4) instead of re-tripping it.
5. **Surface-freeze suites must be re-anchored, never silently flipped** (Task 7 + R2's MEDIUM finding on `sdl-static-assertions.test.ts`) — any schema growth requires a documented one-time reconciliation of the freeze pins; promoted into the doc's operational notes as a durable rule.
6. **`logDomainError` ctx carries the machine-readable `code` member** (R9's LOW finding, fixed; R12 verified) — every domain-log call-site keys consumers on `code`; pinned in the service suite and reflected in the doc's audit/ops notes.
7. **Two-source-split proof is diff-scoped** (Tasks 2/4/8, Task 9 PASS A/C, R2/R12) — file-level `rg "suspended"` shows pre-existing matches; the gate proof is the added-lines grep (exit 1) + the runtime governance-triple oracles; the doc's test-locks section consolidates all five enforcement layers.
8. **Test-first RED can mask dead assertion branches** (Task 5 → 6-fix-journey) — the journey's guard failures hid two latent assertion defects until the mutation landed; the cross-actor journey now stands at 12/12 and is cited in the doc as the executable lifecycle contract.

## 4. Files touched

| File | Delta |
|---|---|
| `docs/teachers/applicant-cooldown.md` | NEW — the knowledge doc (10 sections) |
| `docs/teachers/applicant-lifecycle.md` | +2 lines (§2.3 pointer) |
| `docs/teachers/evaluation-rubric-scoring.md` | +3 lines (consumer pointer) |
| `docs/teachers/verification-plan-purchase.md` | +2 lines (sibling-docs blockquote) |
| `ai/plans/.../tasks.md` | checkbox `10.` flipped |
| `worklog.md` | Task 10 entry appended |

Not touched: `AGENTS.md`, `.agents/instructions/*`, all source/test files, generated artifacts.

## 5. Gate results

| Gate | Result |
|---|---|
| Sub-loop `--lifecycle duplicates` × 4 markdown files (single-file invocations) | exit 1 by **scope-skip, not violation**: the script's oxlint stage reports "No files found to lint. Please check your paths and ignore patterns." for `.md` inputs (0 files processed; tsgo stage passes project-wide). Markdown is outside the sub-loop's lint scope — consistent with every prior task's markdown handling (plan files/outcomes were never sub-looped). |
| Biome check (read-only) on the 4 markdown files | "No files were processed in the specified paths" — markdown is not a biome-supported language for this config; N/A. |
| Substituted verification (per the task gate's fallback) | Hygiene greps over all 4 docs: zero plan-artifact tokens (`REQ-[0-9]`, `Task [0-9]`, `Phase [0-9]`, `tasks.md`, `plan.md`, `deferred-items`, `outcome/`) → grep exit 1; every referenced repo/doc path existence-checked on disk (one false alarm in the check itself — the error-contract doc lives at `docs/graphql/domain-error-extensions-code.md`, which the doc cites correctly and which exists). |
| `bun tsgo` | exit 0 — **0 errors** (docs-only delta, zero type impact). |
| `deferred-items.md` ledger | unchanged; D1..D8 all 📋, row-anchored blocker grep remains 0. |

## 6. Verdict

**Task 10 COMPLETE — the plan's final task.** The cooldown state machine now has its durable, plan-free engineering reference wired into all three adjacent canonical docs; the two-source split (REQ-006) is documented with its full enforcement stack; both child tickets have explicit composition hand-offs. All plan tasks (0–10, incl. 2.5 and the fix waves) are closed; the ledger carries zero ❌/⚠️.
