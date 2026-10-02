# Plan Review Report — Teacher Availability Toggle (Available/Unavailable)

## Review Round: R1
## Date: 2026-09-30
## Subagents Dispatched: verify-cross-ref-consistency (2 independent passes), verify-paths-exist, verify-i18n-namespaces, verify-graphql-accuracy, verify-permissions-enums, verify-three-tier-architecture

---

## Summary

- **Total issues found:** 15 (R1–R15 resolutions)
- **Blocking (CRITICAL/HIGH):** 7 — R1, R2, R3, R4, R5, R6, R11
- **Medium:** 6 — R7, R9, R10, R12, R13, R14
- **Low/Notes:** 2 — R8, R15

Two independent reviewers flagged the same cross-artifact inconsistencies: the trio disagreed on file stems, the `id` scalar, test filenames, the knowledge-propagation target, deferred-row IDs, the locale key-set, and a direct contradiction between plan §3.3 and tasks 1.3/4.2. Every resolution below is now applied; all artifacts agree.

---

## Findings by Dimension

| Dimension | Subagent | Issues Found | Status |
|---|---|---|---|
| Paths Existence | verify-paths-exist | 3 (R1, R3, R4) | ✅ Fixed |
| i18n Compliance | verify-i18n-namespaces | 3 (R7, R8, R15) | ✅ Fixed |
| GraphQL Accuracy | verify-graphql-accuracy | 3 (R2, R10, R12) | ✅ Fixed |
| Permissions/Enums | verify-permissions-enums | 1 (R9) | ✅ Fixed |
| Cross-Reference Consistency | verify-cross-ref-consistency | 5 (R5, R6, R11, R13, R14) | ✅ Fixed |
| Architecture Compliance | verify-three-tier-architecture | 0 | ✅ Clean |

---

## Detailed Findings (by resolution)

1. **[HIGH] R1 — File naming drift.** specs.md used bare `availability.{pothos,query,mutation,documents}.ts`; plan.md used `AvailabilityToggleCard.tsx`; card path was `views/dashboard/home/` in specs. → Standardized domain-prefixed stems everywhere: `teacher-availability.{pothos,query,mutation,documents}.ts`; card = `frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx` added to that barrel.
2. **[HIGH] R2 — `id` scalar.** plan §3.1 said `id: ID!` / `t.exposeID`. → `id: Int!` with `t.exposeInt("id")` (matches `TeacherAvailabilityReturnType.id: number` and specs/tasks).
3. **[HIGH] R3 — Test filenames.** plan used `teacher-availability-toggle.journey.test.ts` and `teacher-availability.wire.test.ts`. → `test/workflows/teachers/teacher-availability.journey.test.ts`; `backend/graphql/test/teacher-availability.integration.test.ts`; frontend = `frontend/graphql/test/teachers/teacher-availability.test.ts`.
4. **[HIGH] R4 — Knowledge-propagation target.** specs REQ-081 / §4 matrix / §4.1 said `docs/sessions/teacher-availability-toggle.md`. → canonical `docs/teachers/teacher-availability.md` in ALL artifacts (plan Verification Anchors included).
5. **[HIGH] R5 — AGENTS.md edit mandate.** tasks 7.2 mandated editing root `AGENTS.md` + `backend/services/AGENTS.md`. → Replaced 7.2 with a docs-only propagation + skill-reference task; specs REQ-083 and plan anchors now state "NO AGENTS.md or `.agents/instructions/*.md` file is modified".
6. **[HIGH] R6 — Deferred-row ID space collision.** Ledger rows reused design-decision IDs `D1..D8`. → Renamed to `DEF-1..DEF-6`, identical in plan.md and deferred-items.md; tasks prose for the never-resurrect row now cites `DEF-1`. All rows ✅ resolved-pointer; `grep` open-row count = 0.
7. **[MEDIUM] R7 — Locale layout + key set.** plan §2.3/tasks 1.2 used `.../availability/index.ts` as the leaf and an 11-key set. → Real convention `<ns>/labels.ts` + `<ns>/index.ts`; frozen 8-slot set (`cardTitle`, `toggleToAvailableCta`, `toggleToUnavailableCta`, `certificationRequiredHint`, `inSessionLockedHint`, `updateSuccess`, `updateGenericError`, `loadErrorNotice`) used in specs REQ-063.2, plan §2.3, tasks 1.2 + parity test.
8. **[LOW] R8 — `ctx.t` key.** specs REQ-002.3 `ctx.t("errors")` → `ctx.t("errorsTranslations")`.
9. **[MEDIUM] R9 — INV-A1 vs NOT-FOUND split.** plan §3.2 matrix conflated absent row with uncertified; tasks 5.1 actor U allowed "row absent or uncertified". → Split into "row PRESENT, `isApproved=false` → FORBIDDEN/403" vs "NO row → `TEACHER_NOT_FOUND`/404"; journey INV-A1 assertion uses explicit `isApproved=false` row (`createTestTeacherRow`, `backend/db/test/entity-setup.ts:550`); absent id stays the 404 probe.
10. **[MEDIUM] R10 — Error-class wording.** `TEACHER_NOT_CERTIFIED` was called "CONFLICT-family"/"CONFLICT path". → "booking/rubric VALIDATION-class `TEACHER_NOT_CERTIFIED` toast" (error-link.map.ts:346-360). FORBIDDEN/403 decision unchanged.
11. **[HIGH] R11 — Client-handling contradiction.** plan §3.3 ordered the card to "branch on `extractErrorCode` explicitly … never rely on the generic map", contradicting task 1.3 (map row) + 4.2 (relies on the map). → Deleted the contradictory sentence; single mechanism = the Apollo error-link map row `TEACHER_IN_ACTIVE_SESSION` → `teacherInActiveSession`.
12. **[MEDIUM] R12 — Resolver async.** tasks 3.1 `resolve:` callbacks `await ctx.t(...)` but were non-async. → Both made `async`.
13. **[MEDIUM] R13 — Line-number anchors.** Corrected to verified actuals across the trio: `shared/locale/types/errors/labels.ts:247/249`, en `:110`, ar `:106`; schema-surface Query-root pin `:972-1006` (Mutation `:1097` kept); `setOnline` docstring `:397-447`; `backend/services/index.ts:17`; mutation barrel `:36-47`; query barrel `:18-21`; navItems `:144-150`; allowlist-coverage `:135,142,158`.
14. **[MEDIUM] R14 — REQ range + coverage index.** Banners said `REQ-001..REQ-093`. → `REQ-001..REQ-095`; added REQ-073 / REQ-094 / REQ-095 rows to the Requirement Coverage Index.
15. **[LOW] R15 — Test-inventory const names.** tasks used `AVAILABILITY_{QUERY,MUTATION}_FIELDS`. → `TEACHER_AVAILABILITY_QUERY_FIELDS` / `TEACHER_AVAILABILITY_MUTATION_FIELDS` in all three artifacts.

---

## Fix Subagents Dispatched

| Subagent | Target Files | Findings Fixed | Status |
|---|---|---|---|
| fix-cross-ref | `specs.md`, `plan.md`, `tasks.md`, `deferred-items.md` | R1–R15 | ✅ Complete |

---

## Post-Fix Verification

Check 1 — REQ coverage (every `specs.md` REQ appears in `tasks.md`):
```bash
for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo "MISSING: $r"; done
# output: (none — no MISSING lines)
```

Check 2 — open deferred rows (must be 0):
```bash
grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md
# output: 0
```

Check 3 — stale tokens (must return nothing):
```bash
grep -nE "AvailabilityToggleCard|views/dashboard/home/TeacherAvailabilityCard|exposeID|teacher-availability-toggle.journey|teacher-availability.wire|ctx.t\(\"errors\"\)" specs.md plan.md tasks.md
# output: (nothing)
grep -n 'REQ-001\.\.REQ-093' specs.md plan.md tasks.md
# output: (nothing) — the stale range banner is gone; REQ-093 now only appears as the legitimate requirement ID (specs.md ×3, tasks.md ×3)
```

Check 4 — DEF- ledger rows identical in plan.md and deferred-items.md:
```
plan.md:      DEF-1 DEF-2 DEF-3 DEF-4 DEF-5 DEF-6
deferred.md:  DEF-1 DEF-2 DEF-3 DEF-4 DEF-5 DEF-6
```

Additional greps: no bare `teachers/availability.*` stems remain; no `\| D[0-9]` ledger rows remain in deferred-items.md; no `docs/sessions/teacher-availability-toggle` path remains.

- [x] All stale references resolved (grep confirms)
- [x] New tasks/components added where needed
- [x] AC traceability complete (REQ-001..REQ-095 covered)
- [x] Deferred ledger resolves to 0 open rows
- [x] Trio agrees on naming, scalar, filenames, doc target, ledger IDs, key set

---

## Lessons for Future Plans

- Deferred-ledger IDs MUST live in a namespace disjoint from design-decision IDs (`DEF-n` vs `Dn`) — reusing `D` caused a silent collision.
- Pick the `<ns>/labels.ts` + `<ns>/index.ts` locale leaf layout from the start; `types/applicant` (single `index.ts`) is the wrong precedent.
- File stems must be domain-prefixed from the first draft; a bare `availability.*` set drifts across artifacts immediately.
- `AGENTS.md` / `.agents/instructions/*` are hand-curated and are never a plan-work edit target — knowledge belongs in the canonical `docs/` home.

---

## Traceability

**Plan files modified:**
- `specs.md` — R1, R3(§2.9 REQ-093), R4, R5, R7, R8, R9, R10, R13, R14, R15
- `plan.md` — R1, R2, R3, R4, R5, R6, R7, R11, R13, R14, R15
- `tasks.md` — R1, R3, R4, R5, R6, R7, R9, R10, R12, R13, R14, R15
- `deferred-items.md` — R6 (DEF-1..DEF-6, identical to plan.md)

**Outcome knowledge base updated:** this report saved as `outcome/plan-review-R1.md`.

---

**Final verdict: Plan passes all AGENTS.md rules after R1 fixes.**
