# Deferred Items Ledger

**Feature:** Admin-Ordered Re-Evaluation (Teacher Wallet Deduction)
**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/`
**Specs:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/specs.md`
**Created:** 2026-09-30

---

## Purpose

This ledger tracks all work deferred from this plan — to a later task, to a child ticket, or to a named external owner — so no deferred item is forgotten. Every deferral is logged here with its reason, its canonical owner, and the surface where it was raised. The plan cannot be closed out until every row is either resolved or authoritatively handed off.

Two kinds of deferral are recorded in this plan:

1. **External hand-offs** — work that belongs to a different ticket / owner stream and is deliberately out of scope for this slice (D-001 … D-006). These are recorded so the boundary is explicit and the owner is named, not so this plan can implement them.
2. **Baseline findings** — pre-existing errors observed during Phase 0 baseline capture (see *Baseline & Pre-existing Issues*). These are not introduced by this plan and must not be "fixed" here.

> **Standing rule — hand-curated instruction files.** No `AGENTS.md` file and no `.agents/instructions/*.instructions.md` file is ever created, edited, or deleted as an outcome of a plan. Those files are hand-curated. Durable knowledge produced by this plan goes to `docs/<domain>/` and to this plan's own `outcome/` files only. This applies to every task in this plan, including the Phase 7 knowledge-propagation task.

---

## Ledger Table

| ID | Deferred Item | Source | Target / Owner | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D-001 | Product confirmation of the `RE_EVALUATION_FEE` value | Plan scope ruling (REQ-004.3) | Product (pricing owner) | ✅ Done | specs.md REQ-004.3 | Provisional decimal-string constant ships; value confirmed by product outside this plan. |
| D-002 | Wiring `SessionType.ReEvaluation` (`"re_evaluation"`) into the loop predicates | Plan scope ruling (REQ-008.4) | Future re-evaluation-reporting ticket | ✅ Done | specs.md REQ-008.4 | Loop reuses `teacher_evaluation` sessions by ruling; enum value stays writer-unused. |
| D-003 | Generic FR-3.8 admin override surface (manually certify / reject an applicant) | Plan scope ruling | M1 ticket — `docs/planning/TICKETS.md:916-958` | ✅ Done | specs.md Out-of-scope + :916-958 | Not this ticket; owned by the still-unshipped M1 overlay. |
| D-004 | Request-level idempotency keying for the order | Design ruling (REQ-010.4) | Future idempotency-hardening ticket | ✅ Done | specs.md REQ-010.4 | Guarded `passed → in_evaluation` + `is_approved` transitions are the replay arbiter today. |
| D-005 | Teacher notification of the ordered re-evaluation | Plan scope ruling (not an acceptance criterion) | Future "re-evaluation notification" ticket | ✅ Done | specs.md Out-of-scope | Explicitly not an acceptance criterion of this slice. |
| D-006 | Stale frozen-root-inventory SDL pins (outside-owner housekeeping) | `docs/billing/escrow-and-wallet-crediting.md` §7 | Surface-freeze maintainers (external) | ✅ Done | `docs/billing/escrow-and-wallet-crediting.md:117,126` | This field's own pins ARE refreshed (C13); only the pre-existing lag is noted. |

Status legend: ✅ **Done** = correctly deferred / handed off to the named owner (no residue inside this plan) · ⚠️ **Partial** = needs follow-up inside this plan · ❌ **Blocked** = unresolved, blocks plan completion · 🔄 **In Progress** = currently being worked.

---

## Deferral Detail

| ID | Title | Reason / Blocker | Canonical Owner / Ticket | Surfaced In |
|---|---|---|---|---|
| D-001 | `RE_EVALUATION_FEE` value is provisional | The fee value is a product pricing input, not an engineering constant. The plan ships a decimal string constant with a docblock marking it product-owned; re-pricing is a follow-up, not a plan blocker. | Product (pricing owner) | specs.md REQ-004.3; `shared/constants/re-evaluation.constants.ts` (C1) |
| D-002 | `SessionType.ReEvaluation` (`"re_evaluation"`) not wired into loop predicates | The ticket rules that "the same 5-session evaluation loop applies" (`docs/planning/TICKETS.md:2172-2178`). The loop therefore reuses ordinary `teacher_evaluation` sessions: `insertEvaluationSession` writes `sessionType: SessionType.TeacherEvaluation` (`backend/services/teachers/evaluation-booking.helpers.ts:257`), and `buildEvaluationSessionPredicate` / `countEvaluationBookingsInCycle` stay filtered on `teacher_evaluation`. Wiring the `re_evaluation` value into those predicates would fork the loop and is explicitly out of scope. Reuses `SessionType.ReEvaluation` only as read-side/reporting vocabulary. | Future re-evaluation-reporting ticket | specs.md REQ-008.4; `backend/enum/scheduling/session-type.enum.ts:9`; `backend/services/teachers/evaluation-booking.helpers.ts:257` |
| D-003 | Generic FR-3.8 admin override surface (manually certify / reject an applicant) | This ticket ships exactly ONE governance writer (order → debit → de-certify → loop re-entry). The generic override surface — admin inspects the 5 reports and manually certifies, rejects, or grants re-evaluation — is a separate M1 deliverable. Verified absent: no `adminRejectApplicant` / `adminGrantReEvaluation` field exists. It MUST NOT be duplicated here. | M1 ticket — "Admin Override of Evaluation Results", `docs/planning/TICKETS.md:916-958` (Dev 2 · Milestone 1 · 3 SP · Blocked By Cooldown State Machine) | specs.md Out-of-scope; `docs/planning/TICKETS.md:916-958` |
| D-004 | Request-level idempotency keying for the order | No idempotency-key machinery exists on this flow and none is added. A completed order cannot be replayed because the applicant is no longer in the `passed` state. The first-class arbiter is the pair of guarded transitions: `TeacherRepository.decertifyOnce` (`WHERE id = $1 AND is_approved = true`) and `ApplicantRepository.reopenForReEvaluation` (`WHERE id = $1 AND status = 'passed'`). A racing loser matches zero rows, throws `ConflictError`, and its already-executed debit rolls back with the transaction. No `ctx.idempotencyKey` is read. | Future idempotency-hardening ticket (mirrors the withdrawal-settlement predicate-arbiter model) | specs.md REQ-010.1, REQ-010.4 |
| D-005 | Teacher notification of the ordered re-evaluation | Notifying the subject teacher that a re-evaluation has been ordered and a fee deducted is not an acceptance criterion of this slice. No notification channel is built, spied, or wired as part of the order pipeline. | Future "re-evaluation notification" ticket | specs.md Out-of-scope; specs.md REQ list (no notification REQ) |
| D-006 | Stale frozen-root-inventory SDL pins (outside-owner housekeeping) | The frozen whole-root operation inventories lag behind root fields shipped by other surfaces; refreshing those pre-existing pins is surface-freeze housekeeping owned outside this domain (`docs/billing/escrow-and-wallet-crediting.md:117`, external-owner ledger entry D3 at `:126`). This plan refreshes ONLY the pins its own new field touches. | Surface-freeze maintainers (external owner) | `docs/billing/escrow-and-wallet-crediting.md:117,126`; specs.md C13 |

### Notes on the two non-obvious deferrals

**D-006 — scope of the pin refresh.** This plan is the *new-field* owner, not the *root-inventory* owner. Its acceptance criterion (REQ-011.4) requires the new `adminOrderTeacherReEvaluation` field to be pinned and the committed SDL artifact regenerated byte-identical. That refresh happens (C13: `backend/graphql/test/sdl-static-assertions.test.ts:140-145`, `backend/graphql/test/schema-surface.test.ts:726,1160` + a contains-pin). The *pre-existing* lag in those same frozen inventories — fields shipped by other surfaces that were never re-pinned — is a distinct, earlier defect belonging to the surface-freeze maintainers. Touching those pins while regenerating is unavoidable collateral; the deferral is the *pre-existing* rows, not the new one. Recorded here so the two are not conflated and so the external owner is on record.

**D-003 — why it is not a duplicate.** This plan adds a governance *writer* (`TeacherRepository.decertifyOnce`) and a new `passed → in_evaluation` transition. That is not the FR-3.8 override surface. The FR-3.8 surface lets an admin *hand-adjudicate* an evaluation outcome (manual certify / manual reject / grant re-evaluation without cooldown); this plan lets an admin *order a fresh paid re-evaluation* that then runs through the unmodified automated 5-session loop. The applicant-lifecycle doc's "No override surface exists in this lifecycle layer" (`docs/teachers/applicant-lifecycle.md:124`) is a statement about the *lifecycle-guard* layer — this plan's writer is a governance writer, and REQ-014 updates that transition table. The M1 ticket remains the sole owner of the hand-adjudication surface.

---

## Status Values

- ✅ **Done** — Item completed / authoritatively handed off to the named owner, verified against a source (specs.md ruling, outcome file, or commit).
- ⚠️ **Partial** — Partially resolved inside this plan and needs follow-up.
- ❌ **Blocked** — Not resolved; plan cannot complete until addressed.
- 🔄 **In Progress** — Currently being worked on.

### Interpretation for external hand-offs

Every row above is an **external hand-off** — work ruled out of scope and assigned to a named owner/ticket. For these rows, ✅ **Done** means *"the deferral is correctly captured, the boundary is explicit, and the owner is named"* — it does **not** claim the deferred work itself was performed by this plan. No external hand-off leaves residue inside this plan, so none of them is ⚠️ or ❌.

---

## Baseline & Pre-existing Issues

Recorded during Phase 0 (REQ-001.1 baseline capture) and carried forward so new issues introduced by this plan are distinguishable from pre-existing ones. Phase 0 records baseline counts for `bun tsgo`, `bun biome:check`, and `bun run scripts/lint-service.ts --json --id baseline`, and writes `outcome/0-baseline-outcome.md`.

**This table is populated during Phase 0.** It starts empty (no errors recorded yet); the executing agent appends one row per pre-existing error surfaced, and reconciles against `/tmp/baseline-*.txt` at the final quality gate.

| # | Command | Location (`path:line`) | Symptom | Pre-existing? | Owner / Disposition |
|---|---|---|---|---|---|
| B-0 | — | — | *(placeholder — populate at Phase 0)* | — | — |

**Rules for this table**

- A row is **pre-existing** only if it reproduces on the pristine tree before any plan edit.
- Pre-existing errors are **never "fixed" by this plan** — they are logged here and left for their owner. Fixing a pre-existing error in an unrelated file is a scope violation.
- New errors introduced by this plan are **not** deferrable: they must be fixed before the owning subtask is marked complete (the per-file quality loop, `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`, is the gate).
- At the final quality gate, compare current counts against `/tmp/baseline-*.txt`; any delta must be either zero or an explicitly owned new-error entry.

---

## Usage Guidelines

### When to Add a Deferred Item

Add a row when:

1. A task discovers work that belongs to a different task/phase or a different owner stream.
2. A technical/scope constraint requires splitting work across tickets.
3. A dependency is discovered that blocks immediate completion.
4. A design ruling (REQ) explicitly excludes something from this slice.

**Format:**

```markdown
| D-<next-id> | <Brief description> | <source> | <owner/ticket> | ✅ Done | <specs REQ / doc:line / outcome> | <Context/rationale> |
```

### When to Update Status

- **→ ✅ Done:** the item is resolved or authoritatively handed off; add the verification reference (specs REQ, `path:line`, outcome file, or commit).
- **→ ⚠️ Partial:** partially resolved; a named follow-up remains inside this plan.
- **→ ❌ Blocked:** not resolved; blocks plan completion.
- **→ 🔄 In Progress:** a task has begun work on the item.

### When to Reference in Outcome Files

- Adding a deferral: *"Deferred the re-evaluation notification to a future ticket (see deferred-items.md D-005)."*
- Resolving one: *"Resolved deferred item D-00X (see deferred-items.md)."*

---

## Enforcement

The final quality gate (last task before Phase 7: Knowledge Propagation) MUST verify all deferred items are resolved:

```bash
# Count unresolved items
grep -c "❌\|⚠️" ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/deferred-items.md

# Expected: 0
# If >0: Task is BLOCKED — resolve all ❌/⚠️ items before plan completion
```

**Exit criteria:** the plan cannot be marked complete while any ❌ or ⚠️ status remains.

---

## Anti-Patterns (What NOT to Do)

- ❌ **Don't defer without logging** — "I'll handle this later" must become a ledger row.
- ❌ **Don't use vague descriptions** — name the item, the owner, and the exact surface.
- ❌ **Don't mark ✅ without a verification reference** — cite the specs REQ, `path:line`, or outcome file.
- ❌ **Don't leave ⚠️/❌ unresolved** — partial items need a completion path; blocked items block the plan.
- ❌ **Don't defer a critical bug** — security, data-corruption, and money-path bugs in this plan's own surfaces are fixed immediately, never deferred.
- ❌ **Don't implement an external hand-off** — D-003 (FR-3.8 override) and D-002 (enum wiring) are owned elsewhere; re-implementing them here duplicates another ticket.
- ❌ **Don't edit hand-curated instruction files** — no `AGENTS.md` / `.agents/instructions/*.instructions.md` is ever created or modified from a plan outcome.

---

## Related Documents

- Requirements of record: `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/specs.md`
- Design: `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/plan.md`
- Tasks: `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/tasks.md`
- Outcomes: `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/outcome/`
- Money-path rulings: `docs/billing/escrow-and-wallet-crediting.md` §5, §8.2 (hand-off), §7 (surface posture)
- Applicant lifecycle: `docs/teachers/applicant-lifecycle.md`
- M1 override ticket: `docs/planning/TICKETS.md:916-958`
- Template: `.agents/spec-process-guide/templates/deferred-items-template.md`
- Skill: `.agents/skills/spec-driven-development/SKILL.md` (deferred-items ledger enforcement)
