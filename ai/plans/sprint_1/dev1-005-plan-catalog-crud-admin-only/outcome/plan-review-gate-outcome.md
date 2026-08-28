# Task 0.3 — Plan-Review Gate (Phase 1.5) — Outcome

**Task ID:** 0.3
**Agent:** plan-review-gate subagent
**Date:** 2026-08-26 (drafted) · 2026-08-28 (re-validation & completion pass — see "Gate completion record")
**Methodology:** `.agents/skills/plan-review/SKILL.md` (read in full; layers mapped, layer AGENTS.md conventions checked, cross-cutting dimensions verified, findings reported per format)
**Review inputs (read fully):** `specs.md` (REQ-001..REQ-083, 228 lines), `plan.md` (D1..D8, 529→539 lines), `tasks.md` (33 tasks / 301 checkboxes + dependency graph, 627→628 lines), `deferred-items.md` (D1/D2/D3), prototype inventory (4 screens listed, not opened).

---

## Verdict

## ✅ PASS-WITH-AMENDMENTS

All findings are MINOR and were fixed as surgical pre-implementation text amendments (specs.md / plan.md / tasks.md / deferred-items.md). No structural rewrite was needed; the plan's architecture, task decomposition, dependency graph, and security posture are sound.

**Explicit statement: Phase 1 is UNBLOCKED.** Tasks 1.1 → 1.2 → (1.3 ∥ 1.4) → 1.5 may begin immediately. This outcome file satisfies REQ-083's "the plan-review gate outcome SHALL exist before implementation".

**No blockers remain.** The one scoped BLOCKED verdict raised by Task 0.2 (deferred-item D3, missing `grantFreeTrialOnce` precedent) was adjudicated by this gate via resolution path (a) — see Finding F4/Amendment 8 — and D3 is now ✅ Done. Tasks 2.2.3 / 2.3.4 are unblocked.

---

## D3 Ruling (mandatory adjudication from Task 0.2)

**Ruling: option (a) — amend the plan to drop the DEV1-004 code-precedent dependency and rely on the plan's own D2 definition.** Rationale: REQ-014/015 (specs.md:57-58) + plan.md D2/§4.2 define the guarded conditional UPDATE **self-containedly** (single-predicate `UPDATE … WHERE id AND is_active = <opposite> RETURNING *`, zero-row → `existsById` probe → `PLAN_NOT_FOUND` vs `PLAN_ALREADY_INACTIVE/ACTIVE` disambiguation, TOCTOU window = 0). The DEV1-004 code was never merged (`grantFreeTrialOnce` → 0 hits in `backend/`, verified by 0.2 and re-verified by this gate); blocking Phase 2 on landing DEV1-004 would add zero design value and violate this ticket's scope. Amendments: plan.md canonical-refs header + D2 rationale + §2.3 + tasks.md 0.2.5 reworded to "pattern defined herein per D2/REQ-014/015; sprint_0 DEV1-004 plan doc = documented design reference only"; deferred-items D3 → ✅ Done (resolved by amendment); task 0.2.5 (redefined cell) ticked with verification evidence (the sprint_0 plan doc exists on disk). The SQL, conflict mapping, and race analysis are unchanged — this is a provenance downgrade, not a design change.

---

## Findings (17 total: 4 MEDIUM · 11 LOW · 2 INFO)

| # | Sev | Finding (one-line) | Where | Resolution |
|---|---|---|---|---|
| F1 | MEDIUM | `getServerTranslations(locale, "…")` two-arg signature does not exist — actual API is `getServerTranslations(locale)` returning the full `Translations` bundle (verified: `shared/locale/server-graphql.ts:3`; precedent `backend/lib/api/api-response.ts:218`) | specs REQ-002/051 + traceability row; plan §1.1/§3.2/§4.1; tasks 2.3.SR | Amended to `getServerTranslations(locale).errorsTranslations.*` |
| F2 | MEDIUM | No `Translation` enum / `MessageSchema` in `shared/locale/` — real mechanism is `defineNamespace` handles (`shared/locale/namespaces/*/*.namespace.ts`, verified) + `Translations` interface (`shared/locale/types/message.ts`, verified); task 1.4 also missed the namespace-handle creation step | specs REQ-002/054; plan §2.6(b); tasks 1.3.1/1.4/4.3.1 | Reworded to `useAppTranslation(Plans)` + handle creation added to task 1.4 |
| F3 | MEDIUM | `ConflictError` hard-codes `extensions.code = "CONFLICT"` (`backend/lib/errors.ts:159-161`, verified) and `DomainError` overrides `options.extensions.code` — `PLAN_ALREADY_INACTIVE/ACTIVE` custom codes are unreachable without extending the class (`ValidationError`'s overloaded `(code, message, options)` constructor verified at `errors.ts:74-77`); no task covered `backend/lib/errors.ts` | specs REQ-050; plan §3.2/§4.1; task 2.3.4 | REQ-050 reworded; task 2.3.4 now extends `ConflictError` (mirroring the `ValidationError` overload; default `CONFLICT` preserved) |
| F4 | LOW→gate ruling | DEV1-004 `grantFreeTrialOnce` guarded-update code does not exist anywhere in `backend/` (DEV1-004 planned, never executed) — task 0.2.5 as written hard-fails and blocks via 0.2.6 (raised as deferred-item D3 by the 0.2 agent) | plan refs/D2; tasks 0.2.5 | **Gate adjudication, resolution path (a)** — see D3 Ruling above. Zero design change |
| F5 | LOW | `backend/graphql/gqlSchemaBuilder.ts` path drift — `gqlSchemaBuilder` actually exported from `backend/graphql/pothos/builder.ts:66` (verified; agrees with 0.2 outcome §3.1) | specs REQ-004; tasks 0.2 list + 0.2.4 | Paths corrected |
| F6 | LOW | `frontend/graphql/sharedDocuments/billing/` does not exist and top-level `sharedDocuments/index.ts` exports only `./auth`+`./teachers` (verified) — plan §5.4's "no top-level barrel change needed" claim is false | plan §5.4; task 4.1 | Task 4.1 gains the `billing/` subdir creation + top-level `export * from "./billing";` |
| F7 | LOW | Phantom docs referenced: `backend/db/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/components/ui/AGENTS.md`, `frontend.instructions.md`, `mobile-desktop.instructions.md` (all verified ABSENT; replacement docs verified present) | tasks 1.1/2.1/4.3/4.4 | Repointed to `backend/db/schema/AGENTS.md`, `backend/db/test/AGENTS.md`, `frontend/AGENTS.md`, `frontend/COMPONENT_PATTERNS.md`, `frontend/THEME_PALETTE.md` |
| F8 | LOW | Test-runner path `bun run scripts/run-test/run-test.ts` does not exist — canonical is `test/scripts/run-test.ts` (verified; root AGENTS.md documents it with `--last`/`--focus` log-capture flags) | specs REQ-071; tasks protocol/3.6.TE/5.1.TE/5.3.2 | All paths replaced |
| F9 | LOW | Role-mismatch SSR redirect target is the caller's ROLE-SPECIFIC dashboard via `roleDashboardPath` — never bare `/dashboard` (`frontend/lib/auth/withPageAuth.ts` + `roleDashboardRoute.ts`, both verified present); docs/tests saying `/dashboard` would fail | specs REQ-062/REQ-064 matrix; plan §3.3/§5.3; tasks 4.2.1/4.2.TE/4.3.BF | Reworded to role-dashboard semantics |
| F10 | LOW | Deferred-items ledger was an empty template at gate start (D1/D2 pre-seeding claimed by intake but absent) — resolved by the parallel 0.1 agent, which correctly pre-seeded D1/D2 (verified present) | deferred-items.md | No further action; verified present |
| F11 | LOW | plan.md final bullet truncated mid-sentence ("…(REQ") | plan.md §6.6 | Completed ("…(REQ-083)") |
| F12 | LOW | specs.md REQ-064 note garbled clause ("distinct from via `theme.palette` tokens") + tasks.md 0.3.2 typo "spec/plam" | specs l.136; tasks l.70 | Text repaired |
| F13 | LOW | specs.md header + plan.md canonical refs use `ai/plans/dev1-005-…` / `ai/plans/dev1-004-…` paths missing the `sprint_1/` / `sprint_0/` segments | all three docs | Paths corrected (headers) — residue in REQ bodies / task cells caught by re-validation, see F14 |
| F14 | LOW | **Residual stale plan-dir paths after F13's header-only fix**: specs REQ-001 + REQ-083 (incl. the REQ-083 grep gate command!) + closing footer; tasks.md protocol rules 1 & 7, task 0.1 file list, task 6.5.1 grep command — the 6.5.1/REQ-083 grep would have run against a non-existent path | specs l.41/154/226; tasks l.14/28/38-39/566 | All occurrences → `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/…` |
| F15 | LOW | **Runner-path leftovers + phantom `n.ts`**: plan §4.4 and specs REQ-076 still said `scripts/run-test/run-test.ts` after F8; and the amended protocol claimed root AGENTS.md documents `test/scripts/n.ts` — no such file exists (verified ABSENT; AGENTS.md documents `test/scripts/run-test.ts` log-capture flags) | plan §4.4; specs REQ-076; tasks protocol rule 3 | Paths corrected; `n.ts` clause removed |
| F16 | MEDIUM | **REQ-076 had no covering task** — completeness gap: REQ-076 (component-test discipline) was cited by zero of the 33 tasks; found by the REQ↔task re-sweep (every other REQ-001..083 maps to ≥1 task) | tasks 4.3/4.4 | REQ-076 added to Task 4.3 `_Requirements_`; 4.3.TE / 4.4.TE tagged with REQ-076 discipline |
| F17 | LOW | **D3-downgrade wording residue in specs.md**: §3 canonical-alignment bullet ("DEV1-002/DEV1-004 precedents … reused, not reinvented") and traceability row ("DEV1-004 guarded-update precedent") still implied code-level reuse | specs l.191/205 | Reworded to spec-defined pattern + documented design reference only |
| I1 | INFO | plan.md §2 numbering skips "2.4" (2.3 → 2.5) — cosmetic; left as-is to avoid structural churn | plan.md | Noted, no change |
| I2 | INFO | Plan §3.3 matrix adds a Supervisor row beyond specs REQ-064 matrix — benign superset, consistently asserted by task 3.6.1 | plan §3.3; tasks 3.6.1 | Noted, no change |

---

## Methodology checks performed (plan-review SKILL.md)

- **Layers mapped + AGENTS.md conventions checked:** `backend/db/schema`, `backend/db/repo`, `backend/db/seeds`, `backend/db/test`, `backend/types`, `backend/services`, `backend/graphql` (pothos/query/mutation), `shared/locale`, `frontend/graphql/sharedDocuments`, `frontend` root, `app/` — every AGENTS.md the tasks cite was verified to exist; phantom citations fixed (F7).
- **Type imports:** plan routes ALL types through `backend/types/billing/plan.types.ts` (`PlanSelectType`/`PlanInsertType` verified present; `PlanReturnType`/`PlanSubmitInput`/`PlanUpdateInput` extensions planned in task 1.2); no resolver-local types; `DBTransaction` from `@/backend/types` — ✅ compliant.
- **Service boundaries:** Server Component (4.2) resolves `getTranslations(locale)` only, delegates to client container using Apollo hooks (4.3) — ✅ compliant.
- **MUI v9:** `sx`-only, `*Outlined` icons, `theme.palette.*` via theme-callback, `React.SubmitEvent` — ✅ compliant (REQ-063).
- **i18n:** compile-time TS i18n in `shared/locale/` mandated; the mechanism references were WRONG (F2) and are now aligned with the actual `defineNamespace`/`Translations` system (verified: `shared/locale/namespaces/define-namespace.ts`, `namespaces/index.ts`, `types/message.ts` `Translations` interface, per-domain `*.namespace.ts` precedents); property-access-only discipline preserved; `ctx.t` verified real (`gqlContextFactory.ts:45,217`); `readTranslation`/`translation-preload`/`getDefaultTranslations` helpers verified to exist for REQ-076 references.
- **Logging:** `logger.logDomainError`/`logger.error` only; `console.*` prohibited — verified `backend/lib/logger.ts:72` — ✅.
- **Test conventions:** `runInRollback` + `tx` + `entity-setup.ts` + `expectRepoError`, never `expect().rejects.toThrow()` — verified helpers exist (`backend/db/test/test-utils.ts:34,77`; `backend/db/test/entity-setup.ts`); runner path fixed (F8/F15) — ✅.
- **GraphQL documents:** named `*QueryDocument`/`*MutationDocument` in `sharedDocuments/billing/`, `id` in every selection, `@apollo/client/react`, no `useLazyQuery` — ✅ (barrel step fixed, F6).
- **Completeness (REQ ↔ task coverage):** every REQ-001..REQ-083 maps to ≥1 task — re-swept REQ-by-REQ in the re-validation pass; the one gap found (REQ-076, F16) was fixed; every task cites REQs — ✅.
- **Dependency graph consistency:** bottom-of-tasks graph (`0.1 → 0.2 → 0.3(GATE) → 1.1 → 1.2 → (1.3 ∥ 1.4) → 1.5 → 2.1 → 2.2 → 2.3 → 2.4(MID-POINT GATE) → 3.1 → (3.2 ∥ 3.3) → 3.4 → 3.5 → 3.6 → 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 5.1 → 5.2 → 5.3 → (6.1∥6.2∥6.3∥6.4) → 6.5(DEFERRED GATE) → 7.1 → 7.2 → 7.3 → 7.4(CLOSURE)`) matches phase/task document ordering and the hard gates — ✅.
- **Testability of acceptance criteria:** REQ-073 boundary matrix, REQ-072 `extensions.code` matrix, REQ-020 grep assertion, REQ-083 grep/baseline gates are all mechanically testable — ✅.
- **Schema/decision coherence:** D1 (lifecycle columns) ↔ REQ-010/042 and the real `plans` table (CHECK names `plans_session_count_check`/`plans_price_check`/`plans_interval_days_check`, `decimal(10,2)`, `char(3)` default `EGP`, `varchar(255)` title — verified in `backend/db/schema/billing/plans.ts` and live DB by Task 0.2); D2 (guarded state transition) ↔ REQ-014/015/040 — coherent and, after the D3 ruling, correctly provenanced as spec-defined; D5 (visibility split) ↔ REQ-016/060/064 — coherent (single `listActive` predicate, field-level authScopes); D4 (decimal string) ↔ REQ-012/022 — coherent; D6/D7/D8 verified against `docs/DATABASE_MIGRATIONS.md` / `docs/IDEMPOTENCY.md` scope notes / existing `billing/` layout — ✅.
- **Security coverage (BFLA/BOPLA/BOLA):** REQ-030 + task 3.6 BFLA matrix; REQ-031 + tasks 1.2.SEC/2.3-Tier-4/5.3.4 BOPLA; REQ-032 ruling + 6.4.1 BOLA — all present and test-proven; `role` scope OR semantics + fail-closed verified in `backend/graphql/pothos/builder.ts` (by Task 0.2: `:108-128`) — ✅.
- **No internal contradictions:** the REQ-050 "CONFLICT vs custom code" ambiguity (F3, resolved), the redirect-target mismatch (F9, resolved), the D3 provenance residue (F17, resolved) — none remain.

---

## Amendments applied (summary — full detail in plan.md "Pre-Implementation Amendment Log" incl. gate-completion addendum items 12-17)

1. `getServerTranslations` single-argument property-access form (specs REQ-002/051/traceability; plan §1.1/§3.2/§4.1; tasks 2.3.SR).
2. i18n mechanism corrected to `defineNamespace` handles + `Translations` interface; task 1.4 gains `shared/locale/namespaces/plans/` handle creation + messages aggregation (specs REQ-002/054; plan §2.6(b); tasks 1.3.1/1.4.x/4.3.1).
3. `ConflictError` custom-code overload added to task 2.3 scope (`backend/lib/errors.ts`); REQ-050 wording tightened (specs REQ-050; plan §3.2/§4.1; tasks 2.3.4).
4. D3 adjudicated via resolution path (a): guarded UPDATE is spec-defined normative pattern; DEV1-004 doc = design reference only (plan refs/D2; tasks 0.2.5; deferred-items D3 → ✅ Done).
5. `gqlSchemaBuilder` path → `backend/graphql/pothos/builder.ts` (specs REQ-004; tasks 0.2/0.2.4).
6. Task 4.1 + plan §5.4: `sharedDocuments/billing/` is NEW and top-level barrel gains `./billing` export.
7. Phantom AGENTS.md / instruction-file references repointed to real docs (tasks 1.1/2.1/4.3/4.4).
8. Test-runner path → `test/scripts/run-test.ts` (specs REQ-071; tasks protocol + 3 sub-tasks).
9. Role-mismatch redirect → role-specific dashboard via `roleDashboardPath` (specs REQ-062/064; plan §3.3/§5.3; tasks 4.2.x/4.3.BF).
10. REQ-081 addendum forward-looking caveat noted on task 7.2; 6.5.1 grep scoping note added (0.2.IV caveat honored).
11. Text repairs: truncated plan bullet, garbled specs clause, `spec/plam` typo, `sprint_1/`/`sprint_0/` path prefixes in document headers.
12. *(re-validation)* Residual stale `ai/plans/dev1-005-…` paths fixed in specs REQ-001/REQ-083/footer and tasks protocol rules 1 & 7 / task 0.1 file list / task 6.5.1 grep command (F14).
13. *(re-validation)* Runner-path leftovers fixed in plan §4.4 + specs REQ-076; phantom `test/scripts/n.ts` claim removed from tasks protocol rule 3 (F15).
14. *(re-validation)* plan §5.4 component tree `useAppTranslation(Translation.Plans)` → `useAppTranslation(Plans)` (F2 residue).
15. *(re-validation)* plan §5.5 browser step 2 bare `/dashboard` → role-specific dashboard (F9 residue).
16. *(re-validation)* REQ-076 coverage gap closed: added to Task 4.3 requirements + 4.3.TE/4.4.TE discipline tags (F16).
17. *(re-validation)* specs §3 alignment bullet + traceability row D3-downgrade wording (F17).
18. Task 0.2.5 (redefined by the D3 ruling) ticked with verification evidence.

Files touched by amendments: `specs.md`, `plan.md` (incl. "Pre-Implementation Amendment Log" with gate-completion addendum), `tasks.md` (incl. 0.2.5 tick), `deferred-items.md` (D3 row → ✅ Done with gate ruling). No plan structure rewritten; no code touched.

---

## Gate completion record

This outcome file was drafted by the 0.3 gate session and then **re-validated to completion by the same Task 0.3 plan-review-gate subagent** (the first pass was interrupted after drafting the outcome and applying amendments 1-11, before the worklog entry and final verification). The completion pass:

- Re-verified every load-bearing amendment fact against the repo (symbol-level probes: `shared/locale/server-graphql.ts:3`, `shared/locale/namespaces/define-namespace.ts` + `namespaces/index.ts` + `types/message.ts`, `backend/lib/errors.ts:74-77,158-161`, `backend/graphql/pothos/builder.ts:66`, `frontend/graphql/sharedDocuments/index.ts`, `test/scripts/run-test.ts` present / `scripts/run-test` and `test/scripts/n.ts` absent, `frontend/lib/auth/{withPageAuth,roleDashboardRoute}.ts`, `backend/db/test/test-utils.ts:34,77` + `entity-setup.ts`, `backend/lib/logger.ts:72`, `backend/graphql/gqlContextFactory.ts:45,217`, AGENTS.md existence matrix, sprint_0 DEV1-004 plan doc present).
- Found and fixed the residual inconsistencies F14-F17 (leftovers of amendments 2/7/9/11 + the REQ-076 coverage gap).
- Ticked task 0.2.5 (redefined by the D3 ruling) with evidence; amended tasks.md checkboxes 0.3 / 0.3.1 / 0.3.2 / 0.3.OD.
- Appended the Task 0.3 entry to `worklog.md`.

---

## Gate status

**Phase 1 (Tasks 1.1 → 1.5) is UNBLOCKED as of this outcome file.**

- 0.1 (baseline) and 0.2 (dependency guard) completed by sibling agents; 0.2's scoped BLOCKED verdict (D3) is adjudicated here; 0.2.5 closed by the ruling.
- Downstream gates unchanged: 2.4 (mid-point), 5.3 (coverage/differential), 6.5 (deferred-items), 7.4 (closure).
- Carried-forward watch items for later gates: (a) 7.2.2 must actually land the REQ-081 addendum in `docs/specs/open-decisions-and-gaps.md` before 7.4 closure (specs.md header statement is forward-looking until then); (b) 6.5.1 marker-grep must be scoped to `| D…` ledger-table rows AND use the corrected `ai/plans/sprint_1/…` path; (c) task 2.3 must include the `backend/lib/errors.ts` `ConflictError` extension in its change set and outcome.
