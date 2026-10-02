# Task 9 — Outcome: Storybook story for `PhoneInput`

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 9 — Storybook story (`frontend/stories/ui/PhoneInput.stories.tsx`) (REQ-2.4, REQ-6.5)
> **Date:** 2026-09-30 · **Pipeline:** 9.QL → 9.TE → 9.SEC → 9.SR → 9.IV — all executed
> **⚠️ Environment anomaly (A3) — read §5 first:** this sandbox's working tree was HEAD on
> `main@5a8369fe` WITHOUT the consolidated Task 1/3/8 work (commit `9a2b5bb2` on
> `feat/no-phone-input-component`), so `frontend/components/ui/PhoneInput.tsx` was ABSENT from
> the working tree. All story verification was therefore additionally performed in a faithful
> scratch tree extracted from `feat/no-phone-input-component` (read-only `git archive` — zero git
> writes, zero repo-tree pollution). The story imports exactly the mandated deep path.

## 1. Summary

Created `frontend/stories/ui/PhoneInput.stories.tsx` — the sole code artifact of Task 9. CSF3,
house style mirrored from `frontend/stories/ui/TextField.stories.tsx` /
`NotificationDrawer.stories.tsx`: `const meta = { ... } satisfies Meta<typeof PhoneInput>`,
`export default meta`, `type Story = StoryObj<typeof meta>`, `parameters.layout: "padded"`,
`tags: ["autodocs"]`, one-line JSDoc per story, domain-only comments (no REQ/Task/plan
references).

| Story | Shape | What it exercises |
|---|---|---|
| `Default` | args (spread-style): `name: "phone"`, `label`, `fullWidth`, `startAdornment` (`PhoneOutlined` in `InputAdornment`) | Empty field wired the way the register form's `{...register("phone")}` spread delivers `name`/handlers/ref + the register icon |
| `Required` | args: `required: true` (+ name/label) | Required asterisk state |
| `WithValue` | render → controlled harness (`useState`): `value="+201234567890"` + `onChange` | CONTROLLED mode (`value`/`onChange`), the admin-dialogs/onboarding wiring |
| `ErrorState` | args: `error: true`, `helperText: "Please enter a valid phone number."` | Error ring, reserved helper line, polite live-region copy (story placeholder copy — allowed in stories) |
| `Disabled` | args: `disabled: true` | Disabled field |
| `RtlContext` | render → `Box dir="rtl"` (theme-callback `sx`: `background.paper` + `divider` border) → `Stack spacing={2} sx={{ maxWidth: 400 }}` → controlled harness with Arabic label `رقم الهاتف` and `+201234567890` | Bidi guarantee: the value stays LTR inside an RTL container (component pins `dir: "ltr"` on the `<input>`) |

Notes:
- Meta is `component: PhoneInput` with `title: "Form/PhoneInput"` EXACTLY. Args are typed
  against `PhoneInputProps` structurally: `satisfies Meta<typeof PhoneInput>` +
  `StoryObj<typeof meta>` — proven by negative control (§3).
- `WithValue`/`RtlContext` use a small `ControlledPhoneInput` harness component (house pattern:
  `NotificationDrawer`'s `DrawerHarness`) so the controlled mode carries a real `onChange`
  (avoids the React controlled-input-without-onChange warning and keeps the field typeable).
- MUI `Stack` with `sx` used in `RtlContext` (the house width-constraint idiom from
  `TextField.stories.tsx`). The RTL container styling uses a theme callback
  (`theme.palette.background.paper` / `theme.palette.divider`) — no hardcoded colors.
- `placeholder` is NOT a `PhoneInputProps` prop, so it is deliberately absent (args are
  type-checked against the component's props — a made-up prop would fail tsgo).
- The preview shell (`.storybook/StoryWrapper.tsx`) already wraps `Form/*` stories in a centered
  box and its `locale` global flips the document LTR/RTL; the `RtlContext` story additionally
  proves the component-local bidi safety independent of that global.

## 2. Files created / modified

| File | Action |
|---|---|
| `frontend/stories/ui/PhoneInput.stories.tsx` | **CREATED** (sole code artifact) |
| `<plan>/tasks.md` | Task 9 checkbox `[ ]` → `[x]` (ONLY that line) |
| `<plan>/outcome/9-outcome.md` | this file |
| `/home/z/my-project/worklog.md` | Task 9 section appended |

No other file touched. `PhoneInput.tsx` was NOT modified (it is not even present in this
sandbox's working tree — see §5; the story imports it via the mandated deep path
`@/frontend/components/ui/PhoneInput`).

## 3. Verification results

### 9.QL — Quality Loop

**In-repo run (mandated command, exact):**
`bun run scripts/health/sub-loop.ts frontend/stories/ui/PhoneInput.stories.tsx --lifecycle duplicates`
→ **exit 1** at the oxlint stage with EXACTLY two diagnostics, both rooted in the §5 anomaly:
`TS2307: Cannot find module '@/frontend/components/ui/PhoneInput'` (+ cascading
`TS7006: Parameter 'event' implicitly has an 'any' type`, because `PhoneInputProps` could not
resolve to type the `onChange` prop). The tsgo stage had already false-passed vacuously
(OOM-killed project-wide run emits no diagnostics — the Task 3 honesty pattern); the REAL
diagnostics came from oxlint's type-aware `tsgolint` stage. These two errors are **the only
delta between this sandbox's tree and the feature branch**, i.e. purely the missing Task 8
artifact, not a story defect.

**Faithful-tree run (binding evidence):** same command executed in
`/tmp/task9-verify` — a `git archive` extraction of `feat/no-phone-input-component` (which
contains `PhoneInput.tsx` via `9a2b5bb2`) with this story copied in and node_modules
hard-link-copied (no symlinks permitted in sandbox):
- ✅ tsgo stage reported pass (vacuous-or-real — indistinguishable; superseded by the scoped
  tsgo proof below),
- ✅ oxlint (type-aware, tsgolint) **passed** — the same stage that surfaced TS2307/TS7006
  in-repo is clean once the component exists ⇒ import resolution + prop typing verified,
- ✅ biome:check passed (it auto-formatted the harness signature to one line; the formatted
  version was synced back to the repo file),
- ❌ lint:type-aware — **eslint SIGKILL'd by the kernel OOM-killer** (also with
  `LINT_MAX_OLD_SPACE_MB=1536 LINT_QUEUE_CONCURRENCY=1`); environment memory limit (4.1 GiB,
  next-server holds ~0.6 GB), not a code signal (Task 3 documents the same class of failure),
- duplicates stage never reached in-loop ⇒ run directly:
  `bunx jscpd -c .jscpd.json frontend/stories/ui/PhoneInput.stories.tsx` → **"Found 0 clones"**,
  exit 0,
- supplementary: file-scoped NON-type-aware eslint
  (`bun run scripts/lint-service.ts -f frontend/stories/ui/PhoneInput.stories.tsx --id task9`)
  in the faithful tree → **exit 0**.

**Scoped tsgo compile gate (Task 3's documented OOM-fallback pattern — the REAL type proof):**
temp tsconfig OUTSIDE the repo (`/tmp/tsconfig.task9.json` extends the extracted root
`tsconfig.json`, preserving `paths: {"@/*": ["./*"]}`, `strict`, `moduleResolution: "bundler"`;
overrides `incremental: false`, `types: []`; `include` = exactly [story, `PhoneInput.tsx`]):
`node_modules/.bin/tsgo -p /tmp/tsconfig.task9.json --noEmit` → **exit 0, zero diagnostics**.
**Negative control (gate-engagement proof):** an identical scratch story with
`fullWidth: "yes"` → `error TS2322: Type 'string' is not assignable to type 'boolean |
undefined'` ×4, exit 1 ⇒ the `@/` alias + component resolve AND the story args are genuinely
typed against `PhoneInputProps` ⇒ the clean exit-0 run is non-vacuous. Scratch fixtures
deleted afterwards.

### 9.TE — Test Engineering

- **Storybook build discovery:** the repo's storybook commands are `bun run storybook` (dev
  server — forbidden to start) and `bun run build-storybook` (`storybook build`, framework
  `@storybook/nextjs-vite` v10.6.0, stories glob `../frontend/stories/**/*.stories.tsx`). There
  is NO story-test script (the `@storybook/addon-vitest` addon is registered in
  `.storybook/main.ts`, but no `vitest.config`/`*.stories.test.ts` integration exists in the
  repo — "Vitest for Storybook" in root `AGENTS.md` is not wired up yet).
- **Attempted the real build** in the faithful tree: `bun run build-storybook` → manager built,
  Vite transformed **13,667 modules**, then **SIGKILL (kernel OOM)** during the transform/render
  phase — the full-app build is infeasible in this 4.1 GiB sandbox. Notably the failure is a
  memory kill mid-transform, NOT a resolution/compile error naming the new story.
- **Fallback (per task contract):** (a) sub-loop typecheck evidence — oxlint type-aware pass +
  scoped tsgo exit 0 with negative control (§3, non-vacuous); (b) scoped tsgo proof of the
  story file — same run. Both controlled (`WithValue`/`RtlContext` harness: `value`+`onChange`)
  and spread prop shapes (`Default`/`Required`/`Disabled`: `name`/`label`/`required`/`disabled`
  args mirroring the `{...register}` delivery) are exercised.
- REQ-6.5 honored: NO frontend render test authored (repo has no render tier); the story is a
  story, not a test.

### 9.SEC — Security & Tenancy Audit: pass

- Placeholder data only: `+201234567890` (the task's own example), labels "Phone number" /
  "رقم الهاتف" — no real PII, no identifiers, no emails/usernames of real persons.
- No network calls: no fetch/Apollo/MSW handlers in the story (MSW preview loaders are global
  infra, untouched); no `console.*`.
- `helperText` copy is the fixed placeholder sentence mandated by the task (stories may carry
  story placeholder copy; production copy comes from the i18n keys shipped in Task 3).

### 9.SR — Semantic Review: pass (all items)

| Item | Result |
|---|---|
| `title` exactly `"Form/PhoneInput"` | ✅ |
| default meta `component: PhoneInput` | ✅ (`satisfies Meta<typeof PhoneInput>`) |
| story args typed against `PhoneInputProps` | ✅ structurally via CSF3 typing + TS2322 negative control |
| No MUI style props outside `sx` | ✅ (`Stack spacing` is a legitimate prop; styling only in `sx`, incl. theme callback) |
| No hardcoded colors | ✅ grep clean (`#hex`/`rgb(`/`rgba(`/`hsl(` → 0; only `theme.palette.*` in a callback) |
| No dead stories | ✅ six stories = the six mandated states, each distinct |
| No `console.*` | ✅ grep clean |
| No `FormEvent` (React 19) | ✅ (only `React.ChangeEventHandler` inferred through `PhoneInputProps`) |
| No cross-layer import | ✅ sole `@/` import is the component; no `@/backend` |
| House style | ✅ CSF3 meta/`satisfies`/`StoryObj`/`tags: ["autodocs"]`/`layout: "padded"`, per-story JSDoc, render-vs-args mix mirroring `TextField.stories.tsx` |
| Comments clean of plan artifacts | ✅ domain-only |

### 9.IV — Instruction Verification: pass

The sub-loop printed the applicable rule files: `.agents/instructions/frontend.instructions.md`,
root `AGENTS.md`, `frontend/AGENTS.md` — all three read IN FULL and honored:
- `frontend.instructions.md` §Theme & Styling (no hardcoded colors, theme callback, `sx`-only) ✅;
  §Storybook (decorators live in preview — none needed; no provider wrapping required —
  `StoryWrapper` provides LocaleProvider/theme; no `useAppTranslation` used in the story so no
  LocaleProvider dependency) ✅; §React 19 (no `FormEvent`) ✅; §Code Style (no nested ternary) ✅.
- `frontend/AGENTS.md` (MUI v9 `sx` discipline; `*Outlined` icon naming — `PhoneOutlined` ✅).
- Root `AGENTS.md` (no `console.*`; no barrels; no new deps; deep imports; MUI v9; React 19).

## 4. Carry-forward knowledge

- **Story import path (deep, no barrel):** `import { PhoneInput } from "@/frontend/components/ui/PhoneInput";`
  (never a relative path, never a barrel) — matches Task 8's export surface.
- **Integration tasks (10–13) can copy story idioms:** controlled mode =
  `<PhoneInput value={v} onChange={e => set(e.target.value)} />` (harness pattern); spread mode
  = pass `name` (+ handlers/ref from `register(...)`); the `startAdornment` register idiom is
  `<InputAdornment position="start"><PhoneOutlined fontSize="small" /></InputAdornment>`.
- **Storybook infra facts:** `Form/*`-titled stories are auto-centered by
  `.storybook/StoryWrapper.tsx` (`checkIsUiComponent`); the preview `locale` global ("ar"
  default) flips the whole document RTL with stylis-plugin-rtl — component-level bidi must
  still be proven by an explicit `dir="rtl"` container (this story does). No story-test
  (addon-vitest) wiring exists yet; if it is added later, `Form/PhoneInput` stories are
  args-driven and portable.
- **Environment (A3) — IMPORTANT for the orchestrator:**
  1. This sandbox's working tree was `main@5a8369fe` WITHOUT the consolidated commit
     `9a2b5bb2` (which lives on `feat/no-phone-input-component` and contains Tasks 0/1/3/8
     artifacts + checkbox flips). Every subagent sandbox appears to start HEAD-on-main
     (anomaly A1, recurring since Task 0) — but this session additionally LACKED the
     consolidated working-tree content, so the mandated component read + QL run could only be
     completed via the read-only `git archive` scratch-tree method (§3). The orchestrator must
     `git switch feat/no-phone-input-component` before merging this task's outputs (story +
     Task 9 checkbox + outcome + worklog), and before Tasks 10–17.
  2. In-repo sub-loop for the story will keep failing with TS2307 until the tree contains
     `frontend/components/ui/PhoneInput.tsx`; after the switch it should pass all five stages
     (verified stage-by-stage in the faithful tree; expect the flaky OOM caveats below).
  3. Memory ceilings confirmed this session: project-wide tsgo — vacuous-pass risk
     (Task 3 pattern); lint:type-aware eslint — SIGKILL (even with
     `LINT_MAX_OLD_SPACE_MB=1536 LINT_QUEUE_CONCURRENCY=1`); `storybook build` — SIGKILL after
     13,667 modules. Definitive type evidence pattern: scoped `tsgo -p <temp-config extending
     root tsconfig, include=touched files, incremental:false, types:[]> --noEmit` + negative
     control.
- **Deferred ledger:** no new deferrals (D-1…D-9 all ⏭️ Out of scope; nothing in this task is
  blocked or partial).

## 5. Environment anomaly A3 (details, for reproducibility)

- `git status --porcelain` (pre-work) → empty; HEAD `main@5a8369fe`; `worklog.md` gitignored
  (`.gitignore:102`) and thus preserved across the reset.
- `frontend/components/ui/PhoneInput.tsx`, `shared/lib/phone.ts`, the i18n key edits, the
  outcome files 0/1/3/8, and the Task 0/1/3/8 checkbox flips were all ABSENT from the working
  tree; they exist in commit `9a2b5bb2` on `feat/no-phone-input-component` (verified
  `git branch --contains 9a2b5bb2`, `git show --stat`).
- Component was read via `git show 9a2b5bb2:frontend/components/ui/PhoneInput.tsx` (read-only).
- Scratch verification tree: `git archive feat/no-phone-input-component | tar -x -C
  /tmp/task9-verify` + story copy + `cp -al` node_modules hard-link copy (symlinks are
  forbidden in this sandbox). All scratch artifacts (`/tmp/task9-verify`, `/tmp/task9-reads`,
  `/tmp/tsconfig.task9*.json`, `/tmp/task9-build-storybook.log`) were deleted after
  verification; the repo tree contains none of them.
