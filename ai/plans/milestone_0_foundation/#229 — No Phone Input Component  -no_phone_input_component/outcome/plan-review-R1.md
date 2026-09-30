# Plan Review — Round 1 (Phase 1.5 Gate)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Issue:** [#229 No Phone Input Component](https://github.com/kottaby/kottaby/issues/229)
> **Milestone:** `milestone_0_foundation` (derived — the issue carries no milestone label)
> **Date:** 2026-09-30
> **Gate:** mandatory Phase 1.5 plan-review before implementation

## 1. Review Method

Three independent, read-only reviewers ran in parallel against the four authored artifacts
(`specs.md`, `plan.md`, `tasks.md`, `deferred-items.md`):

| # | Reviewer scope | Basis |
|---|---|---|
| R1 | Full plan-to-reality review (architecture, types, i18n, graphql, permissions, cross-refs) | `.agents/skills/plan-review/SKILL.md` |
| R2 | Ground-truth verification of **every** `path:line`, symbol, signature, exists/absent claim | direct `Read`/`Grep` of the repository |
| R3 | Structure, truncation, traceability, per-task pipeline, anti-pattern sweep | the plan's own authoring rules |

This is a **pre-implementation** gate (Phase 1.5): it exists to catch plan-to-reality mismatches
before any code is written. Ground truth was established beforehand by an 8-agent read-only
reconnaissance swarm over the real tree.

## 2. Verdict Summary

| Reviewer | Verdict | Findings |
|---|---|---|
| R1 (plan-review skill) | NEEDS-FIXES | 17 (0 CRITICAL / 5 HIGH / 5 MEDIUM / 7 LOW) |
| R2 (ground truth) | NEEDS-FIXES | 12 (4 HIGH / 3 MEDIUM / 5 LOW) |
| R3 (structure/anti-pattern) | NEEDS-FIXES | 8 (0 HIGH / 2 MEDIUM / 6 LOW) |

**All findings were fixed in Round 1.** No CRITICAL findings were raised. R3's structural
dimensions (all mandatory `plan.md` sections present, zero truncation, zero REQ misses, full
per-task pipeline, anti-pattern sweep) came back **clean**; its findings were minor references.

## 3. Findings & Fixes

Findings were de-duplicated across reviewers (several were reported independently by two or three
reviewers — strong signal). Grouped below by the correction that resolved them.

### H-1 — Admin surfaces are NOT RHF forms (reported by R1 #1, R2 #4) — HIGH

**Problem:** `Tasks 11/12/13` (and `plan.md §7.3`) told the implementer to "wire the same RHF
inline `validate:` rule" at the admin create/edit dialogs and the onboarding section. Those
surfaces use controlled `form`/`setForm`/`fieldErrors` state — there is no `useForm`, no
`register`, no `validate`, and no `t`.

**Fix:** rewrote REQ-3.2/3.3/3.4 (specs), `plan.md §7.3/§7.4`, and Tasks 11/12/13 to a
**controlled-mode** integration: `<PhoneInput value={form.phone} onChange={…} error={…} />`
with the error derived from the shared `isValidPhone` predicate (on change/blur) and the existing
server `fieldErrors.phone` projection remaining authoritative.

### H-2 — Onboarding phone field is inside a `.map()` (reported by R1 #2, R2 #5) — HIGH

**Problem:** `OnboardStudentProfileSection.tsx:87-93` is the phone **entry in the
`identityFields` data array**, not JSX. The real `TextField` is rendered generically by
`identityFields.map(...)` at `:110-127` — so "replace the TextField at `:87-93`" was not executable.

**Fix:** Task 13 and `plan.md §7.3` now require branching **inside `identityFields.map(...)`**
on `field.errorKey === "phone"` (or hoisting phone out of the loop), with the data array at
`:73-100` / phone entry at `:87-93` correctly identified.

### H-3 — Wrong backend type names + a fabricated `export const` (reported by R2 #1, #2) — HIGH

**Problem:** `plan.md §4.5` cited `validateCreateInput(input: AdminRegistrationSubmitInput, …)`
and `validateUpdatePatch(patch: AdminUpdateUserPatch, …)`. The real signatures are
`AdminCreateUserSubmitInput` and `AdminUserUpdateDbPatch`; **`AdminUpdateUserPatch` does not
exist**. It also claimed `export const MAX_PHONE_LENGTH: number = 20;`, but `:30` is a
**private, non-exported** `const MAX_PHONE_LENGTH = 20;` referenced only in-file (`:165`, `:217`).

**Fix:** corrected both signatures and the `MAX_PHONE_LENGTH` description in `specs.md`,
`plan.md §4.5`, and Task 7.

### H-4 — Update guard would not typecheck and changed clear semantics (R1 #3, R2 #3) — HIGH

**Problem:** the proposed `if (patch.phone !== undefined) { validatePhoneField(patch.phone, …) }`
passes `string | null | undefined` into `value: string` (TS error) and breaks the documented
`null`/empty = "clear the stored value" contract. The existing guard is
`typeof patch.phone === "string"` (`user-management.helpers.ts:217`).

**Fix:** guard is now `typeof patch.phone === "string"`; an empty string still **clears** the
phone (validate only when non-empty). EC-13 rewritten to match. `plan.md §4.5 Change 2` and Task 7 updated.

### H-5 — `phoneInvalid` key had no home on the admin surfaces (R1 #1/#5/#6/#9, R2 #6) — HIGH

**Problem:** REQ-5.1 added `phoneInvalid` **only** to `AuthLabels`, yet Tasks 11–13 asked the
admin/onboarding surfaces to render it — and those surfaces use the `AdminUsers` and
`StudentOnboarding` namespaces. Neither had a `phoneInvalid` key. The requirement was unsatisfiable.

**Fix:** REQ-5.1 now adds `phoneInvalid` to **three** existing namespaces (no new namespace):
`AuthLabels` (register), `AdminUsersLabels` (`createDialog.phoneInvalid` + `editDialog.phoneInvalid`),
and `StudentOnboardingLabels` (`fields.phoneInvalid`), each implemented in `en` + `ar`. Tasks 3,
11, 12, 13 and the traceability tables were updated accordingly.

### M-1 — `label` required by the component but absent at 3 of 4 call sites (R1 #6, R2 #8) — MEDIUM

**Problem:** `PhoneInputProps.label` was required, but the admin/onboarding sites render an
external `AdminDialogFieldLabel` and pass no label — forcing a duplicate MUI label.

**Fix:** `label?: string` is now **optional**; `plan.md §4.2` and Task 8 document pairing with
the existing external `AdminDialogFieldLabel` (via the field `id`).

### M-2 — `PhoneIcon` startAdornment would be silently dropped (R1 #7) — MEDIUM

**Problem:** the register phone field carries a `PhoneIcon` `startAdornment`
(`RegisterIdentityFields.tsx:79-82`); the prop set could not carry it → unreported visual regression.

**Fix:** added `startAdornment?: React.ReactNode` to `PhoneInputProps`; register site passes the icon.

### M-3 — EC-7 contradicted EC-8 (R1 #8, R2 #7) — MEDIUM

**Problem:** EC-7 expected a 17-char value → `PHONE_INVALID`, but `.max(PHONE_MAX_LENGTH=16)`
runs before `.regex(...)`, so it actually yields `PHONE_TOO_LONG`.

**Fix:** EC-7 is now a ≤16-char shape failure (`"+20abc1234"`) → `PHONE_INVALID`; EC-7/EC-8 no longer overlap.

### M-4 — False "existing auth parity test" claim (R1 #5, R3) — MEDIUM

**Problem:** specs/plan claimed parity was "verified by the existing parity mechanism" and told
Task 3 to "run the existing auth parity test" — **no `auth` parity test exists**.

**Fix:** all such claims replaced with the compile-time `*Labels` type gate; the optional runtime
parity test is recorded in `deferred-items.md` D-8.

### M-5 — React/`useAppTranslation` misuse + prop-type drift + minor refs — LOW/MEDIUM

- `useAppTranslation("Auth")` (string) → handle form `useAppTranslation(Auth)` (C9).
- `helperText`/`onChange`/`aria-invalid` prop types aligned between `plan.md` and `tasks.md`;
  refs documented as landing on MUI `TextField`'s top-level `inputRef`.
- Dangling `design.md` → `plan.md` (Task header).
- `--lifecycle duplicates` chain corrected to `tsgo → oxlint → biome → lint → check:duplicates`.
- Task 15/D7: no `generate:gqlSchema` (zero SDL delta); `bun codegen` only if a genuinely new
  document is added — reuse `auth.documents.ts` otherwise.
- Task 4: `registerUser` receives `phone: ""` (not `"MISSING"`); `test/workflows/auth/` noted as a
  new domain subdirectory (permitted by `test/workflows/AGENTS.md` rule 10).
- Task 0: pipeline (QL/TE/SEC/SR/IV) explicitly scoped to implementation tasks.
- Backend helper exported through the live `@/backend/services/shared` barrel.
- `deferred-items.md` placeholder links replaced with real issue URLs
  (`https://github.com/kottaby/kottaby/issues/NNN`); `§7` → `§10` cross-reference fixed.
- zod phrasing narrowed to "only **production** usage" (a type-only import also exists in
  `admin-session-governance.types.test.ts:14`).
- REQ-3.5 traceability widened to the admin surfaces; traceability summary rows added for the 7
  dotted sub-ids that were missing from `specs.md`'s own table.

## 4. Post-Fix Verification (re-run after fixes)

| Check | Command | Result |
|---|---|---|
| Traceability `specs.md → tasks.md` | `for r in $(grep -oE 'REQ-[0-9]+(\.[0-9]+)?' specs.md \| sort -u); do grep -q "$r" tasks.md \|\| echo "MISSING: $r"; done` | **zero misses** |
| Non-standard suffix ids | `grep -c 'REQ-[0-9]\.[0-9][a-z]' *.md` | **0 in all four files** |
| Truncation | `tail -1` on each artifact | **all end cleanly** (checklist item / table row / bullet) |
| `plan.md` mandatory sections | section headers §1–§13 | **all present** (incl. concurrency, journey, UX/nav, security) |
| Wrong logger path | `grep -rn "frontend/utils/logger"` | **0 matches** (correct path is `@/frontend/lib/logger`) |
| Anti-pattern sweep | `Translation.` enum · two-arg `getTranslations` · raw `bun test` on workflows · bottom-nav additions · dangling paths | **clean** |

Final artifacts: `specs.md` (443 lines) · `plan.md` (621) · `tasks.md` (439) · `deferred-items.md` (143).

## 5. Gate Decision

**PASS.** All 37 de-duplicated findings were resolved within Round 1; no CRITICAL findings remain.
The plan is cleared to proceed to implementation (Phase 2) under the spec-driven-development task
pipeline. The residual items are intentional scope boundaries recorded in `deferred-items.md`
(Country Selector #230, dial-code dataset, masking/libphonenumber, DB column change, legacy
backfill, optional parity test).

> **Carry-over for implementers:** read this file and `deferred-items.md` before starting any task
> (REQ-7.1). The highest-risk corrections to keep in force are **H-1** (admin surfaces are
> controlled, not RHF), **H-2** (onboarding renders through `identityFields.map`), **H-4**
> (update guard `typeof patch.phone === "string"`; empty clears), and **H-5** (three namespaces
> carry `phoneInvalid`).
