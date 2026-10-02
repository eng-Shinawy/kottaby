# Deferred Items Ledger

**Feature:** GitHub issue #229 — "No Phone Input Component" (reusable Phone input with frontend + backend validation and a shared Zod schema)
**Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
**Milestone:** `milestone_0_foundation` (derived — the issue carries no milestone label; see note below)
**Issue:** #229 — "No Phone Input Component"
**Created:** `2026-09-30`

> **Milestone derivation.** GitHub issue #229 carries **no** milestone label. It is placed in
> `milestone_0_foundation` because the deliverable is cross-layer foundation infrastructure:
> a shared validation module (`shared/lib/phone.ts`, REQ-1) consumed by frontend (REQ-3),
> backend services (REQ-4), and a reusable UI primitive (REQ-2) — not a domain-feature
> milestone. The sibling issue #230 (Country Selector) is derived the same way.

---

## Purpose

This ledger tracks (a) all work deferred from one task to another **within** this plan, and
(b) all work intentionally **out of scope** for issue #229, so nothing is silently forgotten.
Every deferred item is logged explicitly. Items with an `❌ Blocked` or `⚠️ Partial` status
block plan completion (see [Enforcement](#enforcement)); items marked `⏭️ Out of scope` are
deliberate scope decisions for a **future** issue/plan and do **not** block this plan.

This ledger follows `.agents/spec-process-guide/templates/deferred-items-template.md`,
extended with the Phase-0 baseline note required by the frozen design contract (D1–D10) and
the requirement set (REQ-1…REQ-9).

---

## Phase 0 — Baseline

**No error-count baseline is required for this plan**, because the plan is **additive**:

- It creates new files (`shared/lib/phone.ts`, `frontend/components/ui/PhoneInput.tsx`,
  `backend/services/shared/phone-validation.helpers.ts`, their tests, and a Storybook story).
- It edits existing files by **narrow in-place replacements** — the raw `phone` `TextField`s
  are swapped for `PhoneInput` (REQ-3) and the inline phone checks in
  `backend/services/auth/registration.service.ts:213-215` and
  `backend/services/admin/user-management.helpers.ts:163-167,217-218` are replaced by the
  shared helper (REQ-4).
- It adds **one** new i18n key (`phoneInvalid`, REQ-5) to three existing namespaces
  (`auth`, `adminUsers`, `studentOnboarding`) with no new namespace — each UI surface renders
  its own invalid-phone message (register → `Auth`; admin create/edit dialogs → `AdminUsers`;
  onboarding → `StudentOnboarding`).

There is **no GraphQL SDL change** (D7): `phone` stays `String` on inputs and `String`
(nullable) on outputs, so **no schema regen / codegen** is triggered. The only pre-existing
global checks that apply are the standard gates (`bun tsgo`, `bun biome:check`,
`bun run lint`, `bun run check:duplicates`), which are run **fresh after** the change:
the target state for every touched file is `bun run scripts/health/sub-loop.ts <file>
--lifecycle duplicates` exiting `0`. Any pre-existing failure surfaced while reading a
touched file is recorded in **Pre-existing Issues** below rather than being treated as a
regression of this plan.

### Pre-existing Issues (not caused by this plan)

| # | Observation | Location | Disposition |
|---|---|---|---|
| P1 | Stale mention of a `PhoneInput`/`CountrySelect` component that does not exist | `frontend/COMPONENT_PATTERNS.md:257` | Corrected as part of REQ-8 propagation if it names this plan's component; otherwise left (doc-only). |
| P2 | `users.phone` has no uniqueness or shape constraint in the DB | `backend/db/schema/users/users.ts:17` (only `unique("users_email_unique")` at `:44`) | Intentional; column change deferred (D-5 below). |
| P3 | No country→dial-code dataset exists | documented absent at `frontend/views/admin/users/dialogs/CreateUserDialog.tsx:23-27` | Deferred (D-2 below). |
| P4 | `auth` namespace has no locale-parity test (unlike other namespaces) | `shared/locale/**` (no `auth` parity test today) | Deferred (D-8 below). |

---

## Ledger Table (deferred / out-of-scope items)

| ID | Deferred item | Reason for deferral | Trigger / Follow-up | Related REQ / issue | Status |
|---|---|---|---|---|---|
| D-1 | **Country Selector component** (flag start adornment, ISO-3166 codes, localized names) | Issue #229 is the **phone** input only. A country selector is a distinct UI primitive tracked as its own issue. #229 deliberately does **not** add a dial-code picker to `PhoneInput` (D10). | Issue **#230** ("No Country Selector Component") is planned/implemented; or a form needs a country field rendered as a selector. | REQ-2 (component), REQ-3 (integration) · [#230](https://github.com/kottaby/kottaby/issues/230) | ⏭️ Out of scope |
| D-2 | **Country → dial-code / ISO-3166 dataset** (calling codes `+20`, `+966`, … and country inference) | No such dataset exists in the repo (explicitly documented absent at `frontend/views/admin/users/dialogs/CreateUserDialog.tsx:23-27`). Adding one needs a new data source and would couple #229 to the country feature. `libphonenumber-js` is not a dependency (D10). | A dial-code picker (D-1/#230) is built, or phone↔country inference is requested. | REQ-1 (schema), REQ-2 (props) · [#230](https://github.com/kottaby/kottaby/issues/230) | ⏭️ Out of scope |
| D-3 | **E.164 auto-formatting + input masking UX** (live grouping/spacing as the user types, `+20 10 1234 5678`) | Out of scope per D10. The plan deliberately keeps the input **unformatted**: the shared schema validates/normalizes the value (REQ-1) but does not render masks, avoiding caret-management complexity and a masking dependency. | Product asks for live phone formatting, or a design review requires it. | REQ-1 (`normalizePhone`), REQ-2 (component) | ⏭️ Out of scope |
| D-4 | **`libphonenumber-js` adoption** for per-country structural validation and `AsYouType` formatting | Not a dependency (D10 forbids new deps for this plan). The shared regex schema (`PHONE_E164_PATTERN = /^\+[1-9]\d{7,14}$/`, D2) covers the E.164 shape without a heavy data-driven library. | Per-country validation (length/prefix rules per region) becomes a requirement, usually alongside D-2. | REQ-1 (schema), REQ-4 (backend) | ⏭️ Out of scope |
| D-5 | **DB `users.phone` column type/length change** — stays `varchar("phone", { length: 20 })` | The column is wide enough for E.164 (`PHONE_MAX_LENGTH = 16` per D2, plus headroom) and is **nullable** today (`backend/db/schema/users/users.ts:17`). Changing it would require a migration with no functional gain and would risk existing rows. | A storage constraint (e.g. `CHECK`/NOT NULL, or narrowing) is requested; or a backfill makes the column shape-enforced. | REQ-1 (constants), REQ-4 (validation) | ⏭️ Out of scope |
| D-6 | **Backfill / migration of legacy non-E.164 `phone` values** (e.g. `0101234567`, `"  +20..."`) into E.164 | Existing rows may hold non-normalized values. A backfill needs a curation/region mapping that does not exist (D-2) and could corrupt data; #229 validates **new** input only. Legacy rows are read as-is (output stays `String`, D7). | D-2 lands, or a consumer needs every stored phone to be strictly E.164. | REQ-4 (backend), REQ-9 (data safety) | ⏭️ Out of scope |
| D-7 | **Admin phone search normalization** (directory search matching normalized E.164) | Admin user search currently matches raw stored strings; normalizing the search predicate is a behavior change depending on D-6 (backfill) to be correct for legacy rows. | Admin directory search is reworked, or D-6 lands. | REQ-3 (admin UI), REQ-4 | ⏭️ Out of scope |
| D-8 | **`auth` namespace locale-parity test** (en/ar key-set equality) | `phoneInvalid` was added to the `auth`, `adminUsers`, and `studentOnboarding` namespaces for correctness (each surface renders its own invalid-phone message), but the `auth` namespace still has **no** dedicated parity test today (unlike other namespaces). The compile-time `*Labels` interface gate already enforces en/ar key parity for all three, so only the **optional** runtime parity test is deferred — it is test-infrastructure work separate from #229. | A locale-drift bug appears in `auth`, or a broader i18n test-hardening task is scheduled. | REQ-5 (i18n) | ⏭️ Out of scope |
| D-9 | **Country field validation tightening** (free-text `country` → validated/structured) | `users.country` is still free-text `varchar(100)` (`backend/db/schema/users/users.ts:22`) with only a `countryRequired` label (`shared/locale/types/auth/index.ts:39`). Tightening it belongs to the country feature (D-1/#230), not the phone feature. | Issue #230 lands, or a country-shape requirement is added. | REQ-5 (i18n) · [#230](https://github.com/kottaby/kottaby/issues/230) | ⏭️ Out of scope |
| D-10 | **📋 Informational — two curator notes, no action required for #229.** (a) Pre-existing doc contradiction: `tests.instructions.md:29` says `getServerTranslations` hangs in tests, while `test/workflows/AGENTS.md` rule 6 mandates it for journey tests — empirical runs are green via the locale-pinned `-graphql` wrapper (see `outcome/midpoint-review-R1.md`, Round R2). Both are hand-curated rule files and MUST NOT be edited by plan work → for a **human curator**. (b) `normalizePhone` (`shared/lib/phone.ts`) currently has **no production consumer** — it is a plan-mandated public API (D2/REQ-1.3, EC-9), not dead code; normalization consumers are the future #230 normalization hand-off (mirrors D-3/D-6). | Neither item is in-scope work for #229: (a) is pre-existing rule-file drift, (b) is deliberate plan sequencing per the frozen design contract. | Human curator reconciles the two rule files; issue **#230** wires `normalizePhone` into real consumers (normalization hand-off). | REQ-1.3, REQ-7 · [#230](https://github.com/kottaby/kottaby/issues/230) | 📋 Informational | D-10 note (R5-fix): `PHONE_E164_PATTERN` is likewise a plan-mandated export with no production consumer yet (schema-internal use; future #230 hand-off) — stay an informational 📋 row (never a blocked/partial status).

**Status legend:** `⏭️ Out of scope` = deliberate scope decision for a future plan (does
**not** block this plan) · `❌ Blocked` = in-scope work not yet done (blocks completion) ·
`⚠️ Partial` = in-scope work partly done (blocks completion) · `🔄 In Progress` ·
`✅ Done` (requires an outcome-file or commit reference).

---

## In-plan deferred items (must resolve before completion)

No in-plan deferrals are known at plan authoring time. Implementation tasks (Phase 0–7) must
add rows here (status `❌ Blocked` / `⚠️ Partial` / `🔄 In Progress`) the moment they discover
work that belongs to another task or phase, then flip them to `✅ Done` with an `outcome/`
reference when completed.

| ID | Item | Source task | Target task | Status | Verified by | Notes |
|---|---|---|---|---|---|---|
| — | _(none yet — add during execution)_ | — | — | — | — | — |

---

## Non-deferred (in scope)

The following are explicitly **in scope** for this plan and must NOT be treated as deferred.
They are listed here so the ledger cannot be used to silently drop them.

| Capability | Where | Requirement |
|---|---|---|
| Shared Zod phone module: `PHONE_E164_PATTERN`, `PHONE_MAX_LENGTH`, `isValidPhone`, `normalizePhone`, `phoneSchema` | `shared/lib/phone.ts` (new) + `shared/lib/phone.test.ts` | REQ-1 |
| Reusable `PhoneInput` (forwardRef `Readonly` props, `type="tel"`, `inputMode="tel"`, `dir:"ltr"` bidi safety, `aria-invalid` + aria-live helper, no validation logic inside) | `frontend/components/ui/PhoneInput.tsx` (new) + `frontend/stories/ui/PhoneInput.stories.tsx` | REQ-2 |
| Frontend integration: register form + admin create/edit dialogs + onboarding profile section swap to `PhoneInput`, register adds `validate: v => (isValidPhone(v) ? true : t.phoneInvalid)` | `frontend/views/auth/register/RegisterIdentityFields.tsx`, `frontend/views/admin/users/dialogs/{CreateUserFormGrid,EditUserFormFields}.tsx`, `frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx` | REQ-3 |
| Backend helper `validatePhoneField(value, locale): ApiFieldErrorType \| null` wired into registration + user-management create/update; onboarding inherits via `createUser` (verified, no code change) | `backend/services/shared/phone-validation.helpers.ts` (new), `backend/services/auth/registration.service.ts`, `backend/services/admin/user-management.helpers.ts` | REQ-4 |
| `phoneInvalid` key added to `AuthLabels`, `AdminUsers` (`createDialog` + `editDialog`), and `StudentOnboarding` (`fields`) (en + ar) consumed by the frontend inline rule/message mapping and the backend code→message mapping (register → `Auth`; admin create/edit → `AdminUsers`; onboarding → `StudentOnboarding`) | `shared/locale/types/{auth,adminUsers,studentOnboarding}/index.ts` + their `shared/locale/{en,ar}/…` counterparts | REQ-5 |
| Tests: shared 4-tier (`shared/lib/phone.test.ts`), backend service tests, GraphQL wire test (`frontend/graphql/test/auth/`), registration journey (`test/workflows/auth/registration-phone.journey.test.ts`) | as listed in `plan.md` §10 | REQ-6 |
| Outcome knowledge base + `[ ]`→`[x]` task tracking | `…/outcome/`, `tasks.md` | REQ-7 |
| Canonical doc `docs/validation/phone-validation.md` (+ `.agents/skills/*/SKILL.md` if a skill applies) | `docs/validation/phone-validation.md` | REQ-8 |
| Server as trust boundary (no client-only validation), no input spread into DB updates, no raw input echoed in errors | `backend/services/**`, `backend/lib/errors.ts` | REQ-9 |

---

## Enforcement

The **final quality gate task** (last task before knowledge propagation) must confirm no
unresolved in-plan deferral remains:

```bash
# Count unresolved IN-PLAN items (⏭️ out-of-scope rows are excluded on purpose)
grep -E "\| (❌ Blocked|⚠️ Partial) \|" ai/plans/milestone_0_foundation/#229*/deferred-items.md | grep -vc '⏭️'
# Expected: 0
```

The enforcement check targets only the **In-plan deferred items** table above. `⏭️ Out of
scope` rows document deliberate scope boundaries for future issues (#230 and follow-ups) and
are not completion blockers. If any `❌`/`⚠️` row exists, it must be resolved (or explicitly
re-scoped into the out-of-scope table with rationale) before the plan is marked complete.

---

## Related Documents

- Template: `.agents/spec-process-guide/templates/deferred-items-template.md`
- Execution guide: `.agents/spec-process-guide/execution/implementation-guide.md` — deferred item workflow
- Skill: `.agents/skills/spec-driven-development/SKILL.md` — deferred-items ledger enforcement
- Sibling plan: `ai/plans/issue_230/no_country_selector_component/deferred-items.md` (Country Selector #230; dial-code/country items here D-1/D-2/D-9 mirror its scope boundary in the opposite direction)
