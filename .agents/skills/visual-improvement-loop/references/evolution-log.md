# Evolution Log

This log is how the skill keeps improving after every run. Each visual-improvement loop ends by
appending its reusable lessons here; lessons then graduate to a permanent home in this skill's own
`references/` files or, optionally, `docs/<domain>/` — and the entry records where it landed.
AGENTS.md and `.agents/instructions/` files are hand-curated; runs NEVER update them.

## Append rules

- One entry per lesson, dated, with the plan/run that produced it.
- Record **where it landed** (or "candidate" until promoted). An entry without a home is a to-do.
- Only GENERAL invariants graduate into this skill's `references/` files or `docs/<domain>/`;
  AGENTS.md and `.agents/instructions/` are hand-curated and never promoted to. Feature specifics
  (entity names, routes, permission strings) stay in the plan's outcome file — never in this log's
  promoted form.
- When a lesson revises an existing reference, update that reference in the same change and say so here.

## Entries

### 2026-08-30 — credit-adjustment-system (skill created from this run)

- `screenshot --full` resets interaction-driven client state on SPA pages with scroll containers —
  prefer viewport shot + `scrollIntoView`; verify DOM state after. → landed: `agent-browser` SKILL.md gotcha 0; `references/capture-protocol.md`.
- Auth expiry silently turns every later capture into a login-page screenshot — `document.title`
  guard is mandatory per capture, re-login via `browser-login.ts --inject` on bounce. → landed: `agent-browser` SKILL.md gotcha 0b; `references/capture-protocol.md`.
- Batched `ReadMediaFile` (multi-megabyte vision payloads) kills the upstream stream — one image per
  inspector subagent; comparator is the single two-image exception. → landed: SKILL.md golden rule 1.
- Prototype color comparison misleads (arbitrary Tailwind values) — structure-only comparison; spec
  wins conflicts. → landed: SKILL.md golden rule 3; `references/prototype-compare.md`.
- Parallel fix waves clobber each other without disjoint file ownership; shared-tree workstreams must
  never be reverted — assign non-overlapping file sets, record (don't fix) foreign pre-existing
  failures. → landed: SKILL.md golden rule 5.
- Re-inspections waste effort re-reporting already-fixed items — pass the prior findings list into
  re-inspection prompts so inspectors confirm-or-contradict. → landed: `references/rubric.md`.
- Inspectors spent effort on mechanical defects a script detects (console errors, overflow, wrong
  page) — objective pre-check gate before scoring. → landed: `references/objective-prechecks.md`, `scripts/visual-precheck.sh`, SKILL.md Phase 3/4.
- RTL/Arabic captures had no scoring criteria. → landed: `references/rubric.md` RTL checklist.
- Fix waves rediscovered the same recipes per finding. → landed: `references/fix-patterns.md`.
- Free-form outcome files made scores non-comparable. → landed: `references/outcome-template.md`.

### 2026-09-11 — subscription-purchase-payment-gateway (visual-improvement-loop R1)

- Subagent contexts in the current environment do NOT receive image payloads — single-image inspectors
  must run via the `z-ai vision` CLI in Bash, one image per call, with the rubric inlined in the CLI
  prompt; the orchestrator aggregates text verdicts. → landed: `references/capture-protocol.md`
  (VLM-CLI inspector mode note under "Reading shots", updated in this change).
- Subagent sandboxes kill background processes between tool calls — bundle server start + login + all
  captures of one locale into ONE foreground Bash call (server relaunch recipe: `setsid nohup npx
  next dev --turbopack -p 3001`; first launch may die silently — always retry once). → candidate:
  `references/capture-protocol.md` (Sessions & auth).
- `--lifecycle codescene` is not a valid sub-loop lifecycle in this repo; deepest valid stage is
  `duplicates` — per-file fix waves must use it (orchestrator template drift). → candidate: SKILL.md
  quality-loop stage list.
- The `locale` cookie does NOT switch this app's locale — use the in-app locale switcher (preference
  is sticky across browser restarts). → candidate: `references/capture-protocol.md` (Sessions & auth).
- Snapshot-text gotchas: EN buttons render uppercase with a leading space (" CREATE PLAN"); desktop
  table row-action text first matches the header/cell, not the row button; MUI Select "empty" state
  renders a zero-width-space placeholder. → candidate: `references/capture-protocol.md` snapshot-text gotchas.
- VLM structure readings of Arabic screens paraphrase/hallucinate labels ("Add New Service", "Tax
  Percentage", "Difficulty Level") — ground-truth implementation structure lists against component
  source/DOM state guards; comparison verdicts rest on the layout skeleton, never label text. →
  candidate: `references/prototype-compare.md`.
- Fix-wave recipes from this run promoted to the playbook: bare-text dialog cancel → outlined variant;
  asymmetric dialog gutter → logical `paddingInline` token spacing; low-contrast select icon →
  mode-aware text token on `.MuiSelect-icon`; weak dialog isolation → scoped `slotProps` backdrop
  scrim+blur. → landed: `references/fix-patterns.md` (4 new rows, updated in this change).

### 2026-09-13 — paymob-gateway-integration (visual-improvement-loop R1: 41 captures, 3 pages, EN+AR)

- Snapshot refs emit as `[ref=eN]` (not `@eN`) in this agent-browser version — `grep -o '@e[0-9]*'`
  never matches; extract `ref=e[0-9]+` and re-prefix `@`. → landed: `references/capture-protocol.md`
  (Version & environment gotchas, updated in this change).
- Console dump is cumulative per session — clear (`console --clear`) after each navigation so the
  pre-check gate judges only the current page. → landed: `references/capture-protocol.md` (same section).
- Back-to-back agent-browser calls inside `$(...)` race (empty snapshots) — retry loops gated on DOM
  state markers. → landed: `references/capture-protocol.md` (same section).
- Storybook iframes lack `next/font` variables — Arabic renders in fallback fonts; Arabic
  shaping/tracking findings are capture artifacts unless computed styles confirm. → landed:
  `references/capture-protocol.md` (same section).
- VLM inspectors hallucinate Arabic labels and estimate sizes/alignment DOM disproves (alert
  "centering", 40px buttons that measure 44, date bidi order, invented strings like "عرض الشكاوى") —
  arbitrate disputed findings with `agent-browser eval` ground truth before acting; a DOM-disproven
  finding is dismissed, not accepted debt. → landed: `references/rubric.md` (DOM arbitration rule,
  updated in this change).
- Story fixture state-machines can make arms unreachable: unverified-pending rows render the derived
  failed presentation, so the amber pending chip never appeared in any capture — assert each arm's
  UNIQUE state marker when capturing. → landed: `references/storybook-protocol.md` (per-arm state
  markers, updated in this change). Feature specifics in the plan outcome.
- MUI breakpoint objects are min-width: `sm` grid overrides leak into `lg`+ — reset at the next
  breakpoint. → landed: `references/fix-patterns.md` (grid reflow row, updated in this change).
- Centered-branch `minHeight` calc must match the page's actual chrome (heading vs no-heading pages
  differ); one-size calcs re-create top-anchoring. → landed: `references/fix-patterns.md`.
- `--lifecycle codescene` drift (flagged 2026-09-11) — promoted the fix: SKILL.md now says
  `--lifecycle duplicates`. → landed: SKILL.md Phase 5 + golden rule 4 wording (updated in this change).
- Subagent image delivery WORKS in the current environment (Explore agents render screenshots) —
  supersedes the 2026-09-11 VLM-CLI note; single-image-per-subagent remains the rule. → landed:
  `references/capture-protocol.md` (Reading shots note, updated in this change).
### 2026-09-13 — admin-financial-auditing-payments-wallet (visual-improvement-loop R2)

- **Wire-enum case bugs in display mappers**: the wallet/withdrawal tone+label mappers switched on
  lowercase wire values (`"completed"`) while the GraphQL wire sends capitalized enums
  (`"Completed"`) → every status chip rendered error-red, every type chip primary-blue. Tests
  passed because fixtures fed lowercase. Landed: fix-patterns (test mappers against wire-case
  values); fixed in `walletLedgerDisplay.ts` / `withdrawalStatusDisplay.ts`.
- Turbopack `.next-dev` disk cache poisons survive a dev-server restart after a transient syntax
  error — a fixed source still serves the broken module. Clear `.next-dev` (dev build artifact,
  NOT a protected lint cache) and restart. → landed: `references/capture-protocol.md`.
- The browser session console buffer persists across navigations — stale `[error]` entries
  false-positive the console gate after fixes. Gate on a fresh session, or verify the count drops
  after reload. → landed: `references/capture-protocol.md`.
- Batch viewport-capture loops MUST re-verify the active tab + a content marker before EVERY
  screenshot: two captures were taken with a different tab's content (URL/view state churn between
  commands). → landed: `references/capture-protocol.md` (state guard, batch discipline).
- `NEXT_LOCALE` cookie silently reverts after browser-session churn → re-pin + title-guard per
  capture. → landed: `references/capture-protocol.md`.
- MUI Select with `value=""`: `renderValue` is NOT called for the empty value — use `displayEmpty`
  so the "" MenuItem text shows in the closed control. → landed: `references/fix-patterns.md`.
- MUI Autocomplete: overriding `renderInput`'s `slotProps` wholesale (common when adding an
  htmlInput aria-label) drops the popup-indicator endAdornment — merge `...params.slotProps`.
  → landed: `references/fix-patterns.md`.
- MUI multiline outlined TextField + forced `inputLabel: { shrink: true }` clips the notched label
  glyphs at the border — don't force shrink on multiline fields; the un-shrunk label is the hint.
  → landed: `references/fix-patterns.md`.
- Offscreen pre-check heuristic flags elements clipped INSIDE overflow-auto scroll containers
  (e.g. scrollable tab strips at 390px) — verify `scrollWidth > clientWidth` + page-level overflow
  before treating an offender as a defect. → landed: `references/objective-prechecks.md` (manual
  fallback note).
- Subagent concurrency in this environment is ~2 — dispatch inspector pairs, not quads; failures
  surface as `user concurrency limit exceeded`. → landed: `references/rubric.md` (dispatch note).
- Fix-wave recipes promoted to the playbook: outlined TonalChip variant to separate chip
  FAMILIES (type vs status) when dark container pairs collide; contained-primary vs outlined-error
  settle-button pair; error-tinted disabled destructive submit; right-aligned money columns with
  bold amounts. → landed: `references/fix-patterns.md` (3 new rows, updated in this change).

### 2026-09-13 — subscription-validity-window-expiry (visual-improvement-loop run)

- Sandbox tool-runners kill background dev servers between tool calls, AND a server that was started
  before file edits keeps serving the stale module graph (HMR churn = phantom console errors + stale
  titles after edits). Kill + fresh-start the server before every post-edit capture round; bundle
  server-start + captures into one foreground call. → landed: `references/capture-protocol.md`
  (Sessions & auth, updated in this change).
- The precheck console sweep accumulated session-wide buffer entries across captures (constant phantom
  FAIL on every shot). → landed: `scripts/visual-precheck.sh` now `console --clear` per navigation;
  `references/objective-prechecks.md` note (updated in this change).
- Off-viewport bleed check false-positived on decorative gradients clipped by `overflow:hidden`
  ancestors. → landed: `scripts/visual-precheck.sh` skips ancestor-clipped offenders;
  `references/objective-prechecks.md` check #4 (updated in this change).
- VLM sub-8px alignment/spacing claims are unreliable: across 3 passes, three DIFFERENT icon-offset
  directions, contradicting center/void positionings, and two "misaligned footer" claims — every one
  disproven by DOM `getBoundingClientRect` (deltas 0-2px or token-exact). Pixel-verify before fixing;
  contradictory findings = noise signature. → landed: `references/fix-patterns.md` watch-out row
  (updated in this change); protocol note in `references/capture-protocol.md`.
- VLM integer-granularity totals plateau ≈9.0-9.2 on defect-free surfaces; the 9.5 READY bar is
  reachable only via the rubric's accepted-debt clause with pixel-verified adjudication. → noted in
  `references/rubric.md` (updated in this change).
- Repo db CLIs parse their own `--env-file` (must come AFTER the script path; `bun --env-file` itself
  is consumed by bun). Fresh sandboxes need `cp .env.test.ci .env.test`. → plan outcome only
  (repo-specific; not promoted to skill refs).

### 2026-09-13 — parent-read-only-monitoring-portal pass 2 (pglite dev rig)
- Subagent single-image inspectors are flaky in sandboxed environments: 3/6 calls returned "images
  are not available in sub-agent context" on files other agents read fine. Fallback per the skill:
  VLM-CLI inspector mode (`z-ai vision -p <rubric> -i image`, ONE image per call); prototype
  comparisons work there with two `-i` args (prototype first). → landed: `references/capture-protocol.md`
  (Reading shots section, updated in this change).
- Inspector prompts must DECOUPLE "prototype structure delta" from the six scored axes. A rubric
  that left them coupled produced 6.5-8.5 verdicts dominated by out-of-scope redesign requests
  ("restore the audio player", "replace cards with a table") on a spec-driven implementation; the
  decoupled rubric scored the SAME pixels 9.2-10 with zero findings. → landed:
  `references/prototype-compare.md` + `references/rubric.md` (updated in this change).
- VLM digit-script claims ("mixed Arabic-Indic vs Latin numerals") are disprovable in one DOM eval:
  enumerate the digit codepoints over `main.textContent` and `new Set` them. Both claimed
  mixed-format findings were all-Latin hallucinations. → landed: `references/objective-prechecks.md`
  manual-eval fallback (updated in this change).
- "Toast overlaps the title" claims survive repeat passes as zombie findings; a single geometry
  probe (`.MuiSnackbar-root` rects vs header rect) killed it (no snackbar nodes existed at all).
  → landed: `references/fix-patterns.md` adjudication row (updated in this change).
- Sandbox rigs without a Postgres install: `DB_PROVIDER=pglite` + `PGLITE_DATA_DIR` run the FULL
  dev server + db/service/journey/UI suites green (the db CLI still demands a format-valid
  DATABASE_URL placeholder). Fixture data dirs copy freely between worktrees while unheld. → plan
  outcome only (repo-specific; not promoted to skill refs).

### 2026-09-13 — parent-read-only-monitoring-portal prod-rig cross-check (second independent run)
- Chromium withholds `SameSite=Strict` injected cookies from the FIRST top-level navigation (about:blank initiator); curl succeeds and the failure mimics a server auth bug. Inject `SameSite=Lax` in capture rigs, or warm the origin with one same-origin navigation before the guarded URL. → landed: `references/capture-protocol.md` (Production-build rig fallback).
- When a sandbox's dev server never hydrates (`__next_f` empty, React fiber absent, zero app-initiated fetches), `next build --experimental-build-mode compile` + `next start` is the fallback rig: hydration-correct, memory-stable, and immune to PGlite single-data-dir worker aborts. → landed: `references/capture-protocol.md`.
- Multi-shot harnesses must key login per credential pair (per-shot email/password keys); a per-invocation login captured the populated parent's state for the empty-state shot. → landed: `references/capture-protocol.md`.
### 2026-09-14 — verification-plan-purchase-5-sessions (visual-improvement-loop run)

- agent-browser `eval` with LONG multi-statement JS (arrow IIFE + many statements) intermittently
  throws `SyntaxError: Unexpected identifier` on strings that are valid JS and that shorter variants
  of the same shape execute fine — rewrite as comma-joined `var` statements without braces/IIFE and
  it runs. Bisect the string before blaming the page. → landed: `references/capture-protocol.md`
  (snapshot-text gotchas, updated in this change).
- Browser-daemon crash (`Resource temporarily unavailable` after 5 retries) POISONS the reused
  session name — subsequent commands fail until daemons are killed AND a FRESH session name is
  used. → landed: `references/capture-protocol.md` (Sessions & auth, updated in this change).
- Component suites in memory-tight sandboxes OOM-kill silently mid-run (exit 137, zero fail lines,
  lock released) after N files — run the affected component files TARGETED (same preloads) instead
  of the alphabetical full-suite, and free the dev-server memory first. → landed:
  `references/capture-protocol.md` (batch discipline, updated in this change).
- Prototype-comparison inspectors score the implementation against the prototype's FULL fancy scope
  (roadmaps, resource grids, audio players) and return low "impl structure" scores even when the
  implementation is exactly spec-scoped — the spec-wins rule must be restated IN the comparator
  prompt (implementation is judged on its spec's scope; richer prototype ideas are recorded as
  user-decision candidates, never silently implemented). → landed: `references/prototype-compare.md`
  (rules section, updated in this change).
- Lifecycle-status chips must stay lifecycle-semantic even when the branch news is positive:
  failed-ELIGIBLE kept a success-toned chip because eligibility reads as good news — the eligibility
  copy lives in the zone body; the chip stays in the failed (warning) family. → promoted:
  `references/fix-patterns.md` (new row, updated in this change).

## 2026-09-19 — parent-session-completion-notification-display run (dev-server rig, pglite sandbox)

- Per-file quality loops (sub-loop.ts) run CONCURRENTLY while a dev server holds the default PGlite
  data dir corrupt the shared `./db/pglite` (WAL panic: `record with incorrect prev-link`); the
  eager `@/backend/db` import in the lint-service opens a second PGlite on the same dir. → landed:
  `references/capture-protocol.md` (new env gotcha: when DB_PROVIDER=pglite, run quality loops with
  `PGLITE_DATA_DIR=/tmp/<unique>` pointed away from the dev server's dir, and serialize multi-agent
  fix waves' gates; a corrupt dir is rebuilt via drizzle-kit push with a pglite-driver config +
  re-seed).
- The skill's bundled `scripts/visual-precheck.sh` may be absent in consumer repos; the manual eval
  fallback in `references/objective-prechecks.md` is sufficient and keeps the gate mandatory. →
  landed: `references/objective-prechecks.md` (note strengthened: gate = rule, script = convenience;
  copy the eval snippets when the script is missing).
- VLM inspectors contradict each other across passes on the same pixels (dir=ltr vs dir=rtl on the
  same element; +4px vs −4px rhythm) and hallucinate copy ("rating trena", "English placeholder in
  AR UI" that DOM shows as Arabic). The DOM-arbitration rule is load-bearing: arbitrate EVERY
  disputed finding and dismiss disproven ones rather than looping. → landed: `references/rubric.md`
  (arbitration section note: run arbitration before ANY second fix wave; one fix wave + arbitration
  closed this run at the documented plateau).
- Stored notification copy renders in the EMIT-time locale while drawer chrome follows the live UI
  locale (users.locale=null → app default ar rows under EN chrome); inspectors flag the mismatch as
  an i18n defect. It is per-locale-at-emission contract behavior. → landed:
  `references/capture-protocol.md` (state-verification note: verify stored-copy locale semantics
  before accepting inspector i18n findings on notification surfaces).
- 2026-09-19 (teacher-withdrawal-plan visual run): Three reusable lessons landed in this change.
  (1) A nested second top-level `db.transaction(..., {isolationLevel})` opened inside a
  `withTransaction` block hard-fails on single-connection providers (PGlite: "Failed query: begin
  isolation level …") and silently splits snapshots on pooled Postgres — when a visual run's
  pre-check console gate surfaces provider-specific GraphQL INTERNAL_SERVER_ERRORs, arbitrate the
  provider's transaction semantics BEFORE touching styles; the fix shape (live tx handle +
  savepoint join, isolation on the withTransaction config) now exists in
  `backend/services/billing/admin-financial-auditing.service.read.helpers.ts`. → promoted:
  `references/capture-protocol.md` (objective pre-checks hand-off note).
  (2) Nested git worktrees cannot run `next dev --turbopack`: Turbopack resolves only inside the
  project root and a nested worktree has no node_modules; a hardlink copy (`cp -al`) of the parent
  node_modules into the worktree resolves it at zero disk cost (symlinks are banned in this
  sandbox). → landed: `references/capture-protocol.md` (sandbox setup section).
  (3) In a 4GB sandbox the running dev server + the per-file sub-loop's type-aware eslint child
  OOM-kill each other (SIGKILL/SIGABRT with zero lint findings) — gates and captures must not run
  concurrently: stop the dev server for the gate run, restart for recapture. → landed:
  `references/capture-protocol.md` (batch capture discipline).

## 2026-09-19 — Admin Subscription Management (dev-server + PGlite run)

- PGlite data dirs are EXCLUSIVE per process: seeding `db/pglite` via an external `pglite-sql.ts`
  process while the dev server holds the dir FORKS the view — the server's in-process instance
  keeps serving its pre-boot page cache (two of five externally-inserted rows were invisible to
  GraphQL until a full server restart; the external process saw all five). Rule: server STOPPED →
  mutate → server RESTART, same as `reset-state.sh` already prescribes. → landed:
  `references/capture-protocol.md` (PGlite discipline, updated in this change).
- A bilingual caption composed of mixed-direction fragments (price "450.00 EGP" + Arabic counted
  forms) joined into ONE string scrambles under the bidi algorithm in RTL — digits visually
  interleave with the wrong fragment. Fix shape: render each fragment as its own
  `unicodeBidi: isolate` span inside a flex row (which mirrors with the document direction), pin
  the Latin-heavy fragment `dir="ltr"`, keep the logical order in `aria-label`. → landed:
  `references/fix-patterns.md` (new row: "mixed-direction caption fragments", updated in this
  change).
- Sandboxed environments where the HARNESS may flip the working tree back to the default branch
  between tool calls (observed via reflog, seconds after an explicit feature-branch checkout):
  never assume HEAD across tool calls — re-verify `git branch --show-current` immediately before
  every `git add`/`commit`/`push`, and treat the remote branch ref as authoritative for CI. →
  landed: `references/capture-protocol.md` (worktree hygiene, updated in this change).
- Seed users share `ADMIN_PASSWORD` (`seed-config.defaultAdminCredential`) — changing the env's
  admin credentials silently changes every demo user's password; login failures on capture runs
  may be seed-config, not a bug. → landed: `references/capture-protocol.md` (Sessions & auth,
  updated in this change).
- `document.title` on this app is page-local (namespace-driven), not the brand string — the
  capture harness `--expect-title` guard must target the page title ("المستخدمون", "Students",
  "سجل التدقيق"), else every capture fails the title gate spuriously. → landed:
  `references/capture-protocol.md` (title guard note, updated in this change).

### 2026-09-20 — teacher_average_rating_aggregation_update (visual-improvement-loop run: 19 captures, 3 pages, EN+AR, pglite dev rig)

- MUI `Rating` star a11y names live on the label element TEXT, not the hidden input's `aria-label`
  (null) — star-selection capture rigs must match `label.textContent`. → landed:
  `references/capture-protocol.md` (Version & environment gotchas, updated in this change).
- Host-scoped cookie mismatch: inject on `localhost` + navigate `127.0.0.1` bounces guarded pages
  exactly like auth failure — unify ONE origin across inject + captures + precheck. → landed:
  `references/capture-protocol.md` (Sessions & auth, updated in this change).
- Fullscreen-sheet dialogs need the WHOLE block clustered (paper justifyContent:center + content
  flex:0 0 auto + centered title on compact) — centering only the middle while actions stay
  bottom-pinned re-scores just as badly as top-anchoring. → landed: `references/fix-patterns.md`
  (new row with measured before/after, updated in this change).
- Pre-existing/sandbox: `lint:type-aware` in-process service OOM-kills below a 2.5 GB child heap in a
  4 GB cgroup — run sub-loops with `LINT_MAX_OLD_SPACE_MB=2560 LINT_QUEUE_CONCURRENCY=1` and the dev
  server stopped. → plan outcome only (sandbox-specific sizing).
- Journey race-leg (concurrent submits) scores 11/4 on the PGlite single-connection rig vs 15/15 on
  PostgreSQL — proven pre-existing/environmental via `git stash` cross-check (same 11/4 on clean
  branch). → plan outcome only (rig-specific).
- Landing provisioning rows with `OVERRIDING SYSTEM VALUE` does not advance identity sequences —
  later auto-inserts collide; `setval(pg_get_serial_sequence(...), MAX(id))` after manual-ID loads.
  → plan outcome only (rig-specific).

### 2026-09-23 — direct_student_onboarding_with_offline_payment (visual-improvement-loop run: 30 captures, 4 surfaces, EN+AR, PGlite dev rig)

- Subagent contexts in this sandbox cannot render images (`Read` → "[1 image(s) omitted: images are
  not available in sub-agent context]") — the orchestrator must inspect via the `z-ai vision` CLI,
  ONE image per call (preserves the one-image golden rule mechanically). → landed:
  `references/capture-protocol.md` (inspector fallback, updated in this change).
- `z-ai vision -o <relative-path>` silently fails in this harness; `-o /abs/path.json` works and the
  script wrapper `scripts/visual-loop/vlm-score-pass.sh`'s relative `vi-out/` outputs never appear.
  → landed: `references/capture-protocol.md` (CLI invocation notes, updated in this change).
- VLM inspectors hallucinate whole UI states under modal conditions (invented "Duplicate Students"
  dialog, fabricated non-existent locale strings, "lacks backdrop" against a DOM-verified
  rgba(0,0,0,.5) backdrop) — modal captures attract modal-semantics delusions; arbitrate EVERY
  backdrop/centering/occlusion claim against `getComputedStyle` before acting, and treat v2
  findings that contradict v1 as noise. → landed: `references/rubric.md` (modal-capture arbitration
  note, updated in this change).
- `text-overflow: ellipsis` without `white-space: nowrap` is DEAD CODE — the v1 pass proved it live
  (history-dialog name line). Fix shape: always ship the three-property truncation recipe as a set.
  → landed: `references/fix-patterns.md` (truncation-recipe row updated in this change).
- Real submissions during capture drives double as free denial-path E2E: the duplicate-email and
  duplicate-reference guards rendered their localized inline errors while driving the dialog —
  worth an explicit step in the capture protocol when the surface has unique-constraint UX.
  → landed: `references/capture-protocol.md` (state-drive note, updated in this change).
- Per-user locale can silently re-assert between capture batches (LocaleSwitcher's write-through
  mutation vs the cookie-only API): re-set the cookie AND re-verify the toolbar button's
  aria-label before every batch. → landed: `references/capture-protocol.md` (Sessions & auth,
  updated in this change).

## 2026-09-23 — admin academic tracking (kottaby #224) visual run

- MUI `Stack divider` NODE with a hairline `width: 1` rendered as a 752×172px block (collapsed width
  token + flex growth) and cratered a tablet pass to 7.8 — prefer a logical `borderInlineStart`
  hairline on the second lane (never a layout node for separators). → landed: `references/fix-patterns.md`.
- Capture rigs must gate on a DATA marker (testid row/card count), not `document.title` alone: Apollo
  refetch after locale re-pin holds skeletons past the settle and the title guard still passes.
  → landed: `references/capture-protocol.md` (state-verified capture).
- `--expect-title` is locale-dependent ("Academic Tracking" vs "التتبع الأكاديمي") — pin the locale and
  the expected title as ONE pair per batch, or AR batches fail the title gate spuriously.
  → landed: `references/capture-protocol.md` (locale pinning).
- Plateau adjudication: at 9.0–9.6 the dominant findings become contradictions across passes (divider
  "missing" with 2 hairlines in DOM, "add tooltip" with the `title` attr present, fold-crop reported as
  truncation) — DOM-arbitrate each, then close via the accepted-debt clause instead of re-looping.
  → landed: `references/rubric.md` (calibration note extension).
- Dense-table recipe for 9–10 honest columns in a 1126px lane: 8px inline gutters + 13px nowrap headers
  + stacked two-line position lanes + merged name/email cell + short-track grade lines; full copies ride
  `title` tooltips so honesty never truncates. → landed: `references/fix-patterns.md` (new row).

## 2026-09-26 — student progress tracking surfaces (kottaby #227) visual run

- MUI v9 `Tabs` hides scroll buttons below the `sm` breakpoint by default (`scrollButtonsHideMobile`
  = `!allowScrollButtonsMobile`), so a scrollable tab strip at 390px shows a mid-word partial next-tab
  label ("Homework" → "nework") with NO affordance — VLM inspectors reliably flag it as clipping.
  Adding `allowScrollButtonsMobile` renders the chevrons on compact viewports and leaves desktop
  untouched (strip not scrollable there). → landed: `references/fix-patterns.md` (new row, updated in
  this change).
- Static-fold screenshots of scrollable pages attract "bottom content clipped / no breathing room"
  findings: arbitrate by scrolling to `scrollHeight` and measuring the last card's gap to the viewport
  before fixing any padding claim — a fold-crop of a scrollable page is not a defect. → landed:
  `references/objective-prechecks.md` (manual eval fallbacks, updated in this change).
- Sandbox auth TTL is short: silent cookie expiry mid-batch turns captures into login pages while the
  capture script keeps "passing" until the title guard — re-run `browser-login.ts --inject` per batch
  and treat a generic brand-only title as expiry. → landed: `references/capture-protocol.md`
  (Sessions & auth, updated in this change).
- Detail pages can reuse the LIST page's `document.title` (route-shared titles) — per-arm state
  markers must be localized tab-panel copy (e.g. the progress-record count sentence), never the
  title. → landed: `references/capture-protocol.md` (document.title page-local gotcha, updated in
  this change).

## 2026-09-28 — cooldown plan visual run (trace 1a0e7a0e9b9cfe91)
- Sandbox survival: Storybook dies silently after "ready" (reaper + Chromatic watcher ENOSPC storms). Fallback rig: dev server + `browser-login.ts --inject`; sessions invalidate on every server restart — re-inject per batch. (captured in this log; capture-protocol already documents the reaper pattern)
- PGlite double-start: an orphaned `next-server` surviving pkill + supervisor respawn opens TWO WASM instances on one data dir → `Aborted()` GraphQL 500s on login. Rule: after ANY restart assert `servers=1`; on aborts rebuild the dir (bootstrap+seed). → promoted into capture-protocol "DB-provider gotcha".
- Inspector contradiction closure: a surface that flips the SAME element between "make active"/"dim it"/"make it float less" across passes with DOM-verified affordances is closed at 3 passes; record arbitrations, accept the plateau per rubric. → already codified in rubric (2026-09-23 note); this run adds the 4-pass data point.
- Verdict-file caching: score verdicts keyed by image filename must be cleared between recapture rounds or stale verdicts alias in. → promoted into capture-protocol (batch discipline).

## 2026-09-28 — cooldown plan pass 2 (`ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/outcome/12-visual-pass2-ci-hardening-outcome.md`)

1. **Inspector fallback**: the single-image subagent channel can degrade mid-run ("images are not available in sub-agent context", persistent across retries). The `z-ai vision` CLI with the same rubric prompt is a reliable fallback inspector — promoted to `capture-protocol.md`.
2. **CDP viewport drop**: `agent-browser set viewport` can close the CDP channel and silently reset the viewport (observed 500px) after long sessions; re-set the viewport AND re-verify the title guard after any hiccup — promoted to `capture-protocol.md`.
3. **CI gate composition**: a branch passing every per-file sub-loop can still fail CI's whole-repo gates (knip unused exports, cross-file jscpd `-t 0`, eslint full incl. `import-x/no-duplicates`, oxlint `--deny-warnings`). Pre-push battery: `bun run check:unused`, repo-wide `bun run check:duplicates`, `bunx tsgo -b --noEmit`, `bun run biome:check` (a WRITER — commit its diff) — promoted to this file; fix-wave protocol note (rule 4 composes with CI, not replaces it).
4. **pgEnum VALUES need committed SQL migrations**: drizzle schema arrays cover only the push path; fresh migrate-path CI DBs miss new enum values. Drop an idempotent `backend/db/migration/*.sql` (guard-then-ALTER pattern of migration 7) and verify with a direct enum-space query on a rebuilt dir.
5. **Verify-clean-dir step**: CI's trailing "Working directory modified by checks" failure means a check writes (biome `--write`) — run every writing check locally and commit its diff before pushing.
