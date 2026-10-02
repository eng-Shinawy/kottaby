# Task 17 — Knowledge propagation + outcome + progress close-out (FINAL)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 17 — Knowledge propagation + outcome + progress close-out (REQ-7.2, REQ-7.3, REQ-8.1, REQ-8.2)
> **Worktree:** `/home/z/feat-wt` · **Branch:** `feat/no-phone-input-component` · zero git writes performed
> **Date:** 2026-09-30 · **Verdict: COMPLETE** — all four REQs delivered; task 17 is the last open task and its checkbox is now `[x]`.

## 1. REQ-8.1 — canonical doc created: `docs/validation/phone-validation.md`

Created `docs/validation/` (directory was absent) with the consolidated phone-validation
reference. Outline:

1. **Why a single phone contract** — one shape authority (`shared/lib/phone.ts`), one server
   gate, one input primitive; the pre-feature drift it eliminates.
2. **The shape decision: strict E.164** — dial-code-independence, no masking, and the
   `PHONE_MAX_LENGTH = 16` vs `varchar("phone", { length: 20 })` column relationship
   (`backend/db/schema/users/users.ts:17` — column intentionally unchanged, nullable, no
   uniqueness/shape constraint; tightening is future migration work).
3. **The shared module** — verbatim `PHONE_E164_PATTERN`, `PHONE_MAX_LENGTH`, `phoneSchema`,
   `isValidPhone`, `normalizePhone` with strip-before-trim idempotence and no-`g`-flag notes.
4. **Machine codes, never user copy** — `PHONE_REQUIRED`/`PHONE_TOO_LONG`/`PHONE_INVALID` are
   codes; mapping table to `auth.phoneRequired` / `errors.validation` / `auth.phoneInvalid`;
   per-namespace frontend copy.
5. **The server gate** — verbatim `validatePhoneField(value, locale): ApiFieldErrorType | null`
   with the `getServerTranslations` switch, first-failing-check order, no-echo guarantee,
   purity, and its consumers (registration; admin create/update; onboarding inheritance via
   `createUser`).
6. **The input primitive** — `PhoneInput` props, `helperText ?? " "`, `dir: "ltr"` bidi,
   `aria-live="polite"`, dual ref entry points, no validation inside.
7. **Two frontend validation modes** — Mode A (RHF inline `validate` in
   `RegisterIdentityFields.tsx`) vs Mode B (controlled `isValidPhone` error computation in
   admin dialogs/onboarding), no `@hookform/resolvers`.
8. **Update patch semantics** — the precise table: absent = skip; wire `""`/whitespace =
   reachable + stored verbatim (gate skipped deliberately, admin-only); wire `null` phone =
   normalized to absent; `dateOfBirth: null` = service-layer clear; edit dialog omits phone
   when cleared; allow-list (no mass-assignment).
9. **Rules** — server trust boundary; machine-code messages; pure/synchronous validation;
   fixed templates; one shape authority.
10. **Anti-patterns** — client-only validation as authorization; libphonenumber/dial-code
    data; SDL changes; `{ ...input }` mass-assignment; raw-input echo; RHF in controlled
    surfaces; assuming DB shape enforcement.
11. **Rollout Summary** — shipped vs deliberately-not-shipped; the exported-but-consumerless
    `normalizePhone` / `PHONE_E164_PATTERN` kept as public API for the #230 normalization
    hand-off ("do not remove").
12. **Related Documents** — relative-path sibling links in the `docs/billing/paymob-gateway.md`
    §12 style, plus the [#230](https://github.com/kottaby/kottaby/issues/230) issue link.

Meta-hygiene: **no plan-artifact references inside the doc** (no REQ-x / task numbers /
design-contract IDs / tasks.md or deferred-items.md citations) — domain behavior only;
sibling links are by path; the deferred-ledger substance (consumerless exports, #230
hand-off) is restated as domain fact. Doc conventions honored (no hardcoded strings,
structured sections, numbered `## N.` layout).

## 2. REQ-8.2 — skills evaluation: **NOT APPLICABLE**

Scanned `.agents/skills/` (46 skills) case-insensitively for `phone`. Matches are incidental:
vendor reference material under `paymob-payments/references/docs/**`, one schema-designer
example, and a mermaid ERD reference. **No skill's SKILL.md documents phone/validation
patterns** that this feature changes, so there is nothing to update. Recorded rather than
edited — per repo policy `AGENTS.md` and `.agents/instructions/*` are hand-curated and plan
work must not create or edit them (SKILL.md files are treated with the same hand-curation
spirit). Standing record: **REQ-8.2 not applicable — no skill documents phone validation.**

## 3. REQ-7.2 — synthesis of the outcome knowledge base (all 34 outcome files read)

### 3.1 The layer → artifact map of this feature

| Layer | Artifact(s) | Role |
|---|---|---|
| Shared lib | `shared/lib/phone.ts` (+ `.test.ts`) | Shape authority: pattern, `PHONE_MAX_LENGTH`, schema, predicate, normalizer; machine-code messages |
| Shared i18n | `shared/locale/{types,en,ar}/{auth,adminUsers,studentOnboarding}/index.ts` (9 files) | `phoneInvalid` (+ existing `phoneRequired`) keys; compile-time `*Labels` en/ar parity gate |
| Backend services | `backend/services/shared/phone-validation.helpers.ts` (+ test); `backend/services/shared/index.ts` | The single server gate (`validatePhoneField` → localized `ApiFieldErrorType`) |
| Backend consumers | `backend/services/auth/registration.service.ts`; `backend/services/admin/user-management.helpers.ts` | Registration + admin create/update funnel through the gate; onboarding inherits via `createUser` |
| Frontend UI | `frontend/components/ui/PhoneInput.tsx`; `frontend/stories/ui/PhoneInput.stories.tsx` | Presentation-only tel primitive (bidi, helper-line reservation, aria-live) |
| Frontend views | `RegisterIdentityFields.tsx`; `CreateUserFormGrid.tsx`; `EditUserFormFields.tsx`; `OnboardStudentProfileSection.tsx` | Mode A (RHF inline validate) and Mode B (controlled + `isValidPhone`) |
| Tests | `test/workflows/auth/registration-phone.journey.test.ts` (9/9, 98 expects); `frontend/graphql/test/auth/auth.test.ts` (24/24, 97 expects) | Cross-actor journey + wire proofs of the server trust boundary |
| Docs (this task) | `docs/validation/phone-validation.md` | Canonical contract reference |

### 3.2 Learnings worth carrying forward

- **Schema-as-authority beats parallel implementations.** Deriving the predicate
  (`safeParse().success`) from the schema made drift structurally impossible and gave the
  backend gate its machine codes for free. Machine-code zod `message`s (codes, not copy)
  decoupled the shared module from i18n and from every layer.
- **Pure/synchronous validation is a security property.** Because `validatePhoneField` does
  no DB/IO, the format gate cannot become a tenancy or enumeration oracle — the review waves
  (R2/R7 security probes) leaned on this repeatedly.
- **The repo has no frontend render-test tier** (UI is E2E-only, documented at
  `frontend/components/ui/fieldError.test.ts:2-13`). Coverage for UI primitives came from
  tsgo prop-contract proof + Storybook story + journey + wire test — a pattern future
  component plans should expect.
- **Patch semantics need prose precision.** The subtlest reviewed area was admin update
  reachability: absent key = skip, wire `""`/whitespace reachable & stored verbatim (gate
  skipped deliberately, admin-only), wire `null` phone normalized to absent, `dateOfBirth:
  null` = service-layer clear, edit dialog omits phone when cleared (review-context item 13
  is the final truth; now mirrored in the doc's §8 table).
- **Hand-curated rule files are landmines.** The `tests.instructions.md:29` vs
  `test/workflows/AGENTS.md` rule-6 contradiction was worked around empirically (locale-pinned
  `-graphql` wrapper) rather than edited (see carry-over 3.3).
- **Environment constraints shape evidence.** Full-repo tsgo/tsgolint OOM in this 4.1 GiB
  sandbox made scoped-tsgo + negative control the canonical type evidence; `bun quality-gate`
  stayed environment-blocked (16-final-gate §1) with per-check compensation. Two pre-existing
  failures (getStats on a seedless test DB; SessionAdminGovernance chaos-race flake) are
  documented and carried, not fixed.
- **Sub-checkbox convention held end-to-end.** Outcome files carry pipeline evidence; parent
  checkboxes carry completion.

### 3.3 Carry-over items (post-plan)

1. **#230 Country Selector hand-off** — dial-code/country dataset, country selector UI, and
   the normalization consumers for `normalizePhone`/`PHONE_E164_PATTERN`.
2. **Consumerless public API note** — `normalizePhone` and `PHONE_E164_PATTERN` are deliberate
   plan-mandated exports with no production consumer yet (ledger row D-10); they are
   documented in the new doc's §11 as "do not remove" so knip-style reviews and future
   readers don't mistake them for dead code.
3. **For a human curator:** the pre-existing contradiction between
   `.agents/instructions/tests.instructions.md:29` ("`getServerTranslations` hangs in tests")
   and `test/workflows/AGENTS.md` rule 6 (journey tests mandate it) — both hand-curated rule
   files must be reconciled by a human; plan work correctly left them untouched.

## 4. REQ-7.3 — progress verification

- `rg '^\s*- \[.\] [0-9]'` over tasks.md: tasks **0–16 all `[x]`** at parent level.
- Flipped the final task: `- [ ] 17. Knowledge propagation…` → `- [x] 17. …` (single line
  change; the only tasks.md edit of this task).
- The **85 X.Y sub-pipeline checkboxes (N.QL/TE/SEC/SR/IV for tasks 1–17) remain `[ ]` by
  documented convention** — recorded here again explicitly (as in 16-final-gate §4 and
  review-context item 7): outcome files carry the per-subtask evidence; no mass-flip.
- Stale-marker sweep: `rg '\[-\]'` over tasks.md → **no matches** (zero stale `[-]`).

## 5. Pipeline evidence (17.QL / 17.TE / 17.SEC / 17.SR / 17.IV)

- **17.QL** — `bun run scripts/health/sub-loop.ts docs/validation/phone-validation.md
  --lifecycle duplicates` → process completed with **exit 0**: tsgo stage ✅ (no errors for
  the doc); oxlint stage reports "No files found to lint" for a `.md` target (docs are
  lint-light by design — markdown is not a lint-target of the oxlint/eslint config), then the
  run finished and released the process lock cleanly. No diagnostics raised against the doc.
- **17.TE** — snippet-drift check performed by reading the shipped files and copying
  signatures verbatim: `shared/lib/phone.ts` (all five exports match char-for-char),
  `backend/services/shared/phone-validation.helpers.ts` (`validatePhoneField` signature +
  switch mapping verbatim), `frontend/components/ui/PhoneInput.tsx` (props, `helperText ??
  " "`, `slotProps` with `dir:"ltr"` / `aria-live:"polite"`, `useForkRef` dual-ref),
  `RegisterIdentityFields.tsx:71-82` (Mode A snippet) and
  `OnboardStudentProfileSection.tsx:111-136` (Mode B snippets). No fabricated APIs; named
  symbols `validateCreateInput` / `validateUpdatePatch` / `buildUpdatePatch` /
  `textFieldErrorProps` are attested by review-context items 9/13 and the component docblock.
- **17.SEC** — no secrets, credentials, or PII in the doc; the only phone literal is the
  placeholder `+201001234567` (the same example the shipped module docblock uses). Error
  examples are codes/templates, never raw-input echo.
- **17.SR** — every `path:line` reference is real (`backend/db/schema/users/users.ts:17`
  verified directly: `phone: varchar("phone", { length: 20 })`); component/file names
  verified against the 26-file change scope; **no `AGENTS.md` or `.agents/instructions/*`
  edits**; deferred-items.md left untouched (D-10 row already covers the consumerless-export
  note — no new deferral to log).
- **17.IV** — root `AGENTS.md` read in full (commands, layer map, i18n rules, lint service,
  sub-loop protocol, doc conventions incl. the paymob canonical-doc pointer); `docs/` layout
  surveyed (28 domain dirs; `docs/validation/` newly created); exemplar
  `docs/billing/paymob-gateway.md` §12 style adopted for Related Documents.

## 6. Deliverables (Task 17)

| Deliverable | Status |
|---|---|
| `docs/validation/phone-validation.md` (REQ-8.1, 12 sections, meta-reference-free) | ✅ |
| REQ-8.2 skills verdict recorded ("not applicable — no skill documents phone validation") | ✅ §2 |
| `outcome/17-knowledge-propagation-outcome.md` (REQ-7.2 synthesis; this file) | ✅ |
| tasks.md: 0–16 verified `[x]`; task 17 flipped to `[x]`; 85 sub-checkboxes `[ ]` by convention; no stale `[-]` (REQ-7.3) | ✅ §4 |
| 17.QL sub-loop on the doc → exit 0 | ✅ §5 |
| 17.TE snippet/signature drift check (5 shipped files read, verbatim) | ✅ §5 |
| 17.SEC secrets/PII sweep → clean | ✅ §5 |
| 17.SR no-fabricated-API + path:line verification; no AGENTS/instructions edits | ✅ §5 |
| 17.IV root AGENTS.md + docs conventions read | ✅ §5 |
| Worklog Task-17 section appended (`/home/z/my-project/worklog.md`) | ✅ |

**Plan state after Task 17: all 18 parent tasks (0–17) `[x]`; deferred ledger has zero
❌/⚠️ rows; no open code findings (R10 final). The #229 plan is COMPLETE.**
