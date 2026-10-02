# Capture Protocol (agent-browser)

Used by the visual-improvement-loop skill. All screenshots must land in `scratch/screenshots/`.

## Sessions & auth

- Fresh session per loop: `agent-browser session id --scope worktree --prefix <short-prefix>`; export the value as `AGENT_BROWSER_SESSION`.
- **Public auth pages need an anonymous session (added 2026-10-01):** an injected admin cookie
  session silently redirects `/register` (and other public auth routes) to the authenticated home —
  capture public auth surfaces in a second, never-logged-in session or you are scoring the wrong
  page. The bounce is silent: the title guard passes, the URL is just not the one you asked for.
  Re-verify `location.pathname` in the same eval as the title guard.
- App pages (dev server): authenticate via `bun run scripts/browser-login.ts --inject` — never type credentials into a login form; the AI layer redacts emails and the submission fails Email validation. If `--inject` errors on daemon startup, fall back to `agent-browser cookies set --curl .browser-auth/playwright.cookies.json --domain localhost`.
- **Actor switching env keys:** `bun run` pre-loads `.env`; `dotenv` then no-ops for already-set
  keys, so a per-actor env file reusing the admin's key names (`ADMIN_EMAIL`) silently logs EVERY
  actor in as the admin. Pass distinct key names per actor via `--email-key/--password-key`.
- **Shared-profile sessions:** agent-browser sessions under one scope share one cookie jar — a
  "fresh session" inherits the previous actor. Sign out via UI (or overwrite cookies) and verify
  in-page identity (topbar user text) after every login switch.
- Storybook (`localhost:6006`): NO auth needed. Capture from the raw iframe URL, not the full manager UI:
  `http://localhost:6006/iframe.html?id=<story-id>&viewMode=story&globals=locale:en|ar`
- **Sandbox/process-reaper environments:** background dev servers die between tool-run calls, and a
  server started BEFORE file edits keeps serving the stale module graph (HMR churn → phantom console
  errors and stale page titles). Bundle server start + auth + all captures of one batch into a single
  foreground Bash call, and kill + fresh-start the server after every edit wave before recapturing.
  First launch may die silently — retry once.
- **Scheme pinning (dark-default apps):** record the color scheme per batch alongside locale — guard
  `document.documentElement.getAttribute('data-mui-color-scheme')` (or the app's equivalent) AND
  `getComputedStyle(document.body).backgroundColor`. A dark-default app silently renders every
  "light" capture dark; color/contrast judgments differ per scheme. Force-switch by setting BOTH the
  storage key (e.g. localStorage `theme`) and its cookie mirror (e.g. `theme-mode`), then reload.
- **Locale pinning:** apps with a default non-EN locale (cookie- or preference-driven) must have the
  locale explicitly pinned per batch (this app: `POST /api/set-locale` from the page context), and the
  precheck's `--expect-title` must match the pinned locale's title. Default-locale drift silently
  turns "EN" batches into AR captures.

## Viewports

- Per shot: `agent-browser set viewport <W> <H>`. Default trio: `1440 900`, `834 1112`, `390 844`. For tall pages needing the full form in frame, a taller viewport (e.g. `1440 1600`) is safer than `--full`.
- Re-set the viewport before every URL change when alternating sizes (viewport survives one page open but not sessions).

## State-verified capture (the loop-critical discipline)

Screenshots must not be trusted just because `screenshot` exited 0. Verify:

1. **Title guard** before accepting: `agent-browser eval "document.title"` must match the expected page (e.g. `"Student Credits | Siraj"` — not `"Login | Siraj"`). A stale/expired session turns everything after into login-page screenshots. Re-auth and recapture.
2. **State guard** for interaction-driven content (expanded banners, selected options, prefilled forms): run the interaction, then check the expected DOM marker twice — immediately before AND after the screenshot. If either check is off, redo.
3. Allow settle time: dev server + Suspense + apollo mocks need 10-15s on first open per bundle. Use a fixed short sleep then verify via DOM — never `waitForTimeout`-style blind sleeps inside tests; for captures a plain `sleep 10` + DOM verification is correct and sufficient.
   - **MUI Autocomplete open-state rig (added 2026-10-01):** synthetic events via eval
     (`el.focus()`, `dispatchEvent(new MouseEvent('mousedown'))`, `el.click()`) do NOT open the
     listbox; a real CDP click (`agent-browser click "input[role=combobox]"`) does. Gate on
     `[role=listbox]` + option count, and re-verify the listbox is still open after the screenshot.
4. **Data-state guard (added 2026-09-23):** Apollo refetch (e.g. after a locale re-pin) can hold a page in MUI skeletons past ANY fixed settle while `document.title` still passes. Gate every capture on a DATA marker — `document.querySelectorAll("[data-testid=…]").length > 0` with zero `.MuiSkeleton-root` — before shooting; retry up to 3×.

## `--full` screenshot pitfall (observed)

`agent-browser screenshot --full` can destabilize client state on authenticated SPA pages with scroll containers (observed: a store-driven section present in the DOM pre-capture was gone post-capture). Prefer:

- Plain viewport screenshot, plus `document.querySelector("<selector>").scrollIntoView({ block: "center", behavior: "instant" })` to frame a specific section.
- Reserve `--full` for stateless, fully-rendered pages, and even then verify DOM state after the shot.

## Batch capture discipline (added 2026-09-13; viewport-proofing 2026-10-01)

- Re-verify the ACTIVE tab + a content marker with `agent-browser eval` before EVERY screenshot in
  a viewport-marching batch — browser/session churn between commands has produced captures of the
  wrong tab's content.
- **Viewport-proof every shot (added 2026-10-01):** run `set viewport` + `eval window.innerWidth`
  immediately before EVERY screenshot (not once per batch), and after each batch audit every PNG's
  actual pixel size (e.g. PIL) against its label. Batch headers that skip `set viewport` inherit the
  previous batch's width silently, and CDP drops reset width mid-run — both produced captures
  labeled 1440 that were really 390, one of which was mis-inspected as "desktop".
- Re-pin `NEXT_LOCALE` + viewport after every re-login; the locale cookie silently reverts.
- The browser session console buffer persists across navigations: after fixing a console error,
  the gate can still see stale `[error]` entries. Gate on a FRESH session, or confirm the error
  count is 0 after a verified reload.
- If a fixed source still serves stale/broken output after a dev-server restart, the Turbopack
  `.next-dev` disk cache is poisoned (a transient syntax error got compiled in): stop the server,
  `rm -rf .next-dev`, restart. This is a dev build artifact — the "never clear caches" rule covers
  lint/quality-gate caches, not the dev bundle dir.

## Reading shots

The orchestrator NEVER calls ReadMediaFile on screenshots in its own loop. Images go to isolated inspector subagents; the main context receives text-only verdicts.

**VLM-CLI inspector mode**: when subagent image delivery is unavailable, inspectors run via the `z-ai vision` CLI in Bash — one image per call, rubric inlined in the prompt; the orchestrator aggregates text verdicts. Note (2026-09-13): subagent image delivery is FLAKY, not binary — the same files that one agent read fine returned "images are not available in sub-agent context" to 3 of 6 sibling agents. Treat any image-unavailable inspector result as a harness error (re-dispatch via VLM-CLI), never as a page verdict. Prototype comparisons work in VLM-CLI with two `-i` args (prototype first, implementation second).

## Version & environment gotchas (observed)

- Snapshot refs emit as `[ref=eN]`, not `@eN` — extract with `grep -oE 'ref=e[0-9]+' | cut -d= -f2`
  and re-prefix `@` for click; `grep -o '@e[0-9]*'` NEVER matches.
- Back-to-back agent-browser invocations inside `$(...)` can race (empty snapshot). Wrap interaction
  captures in retry loops gated on DOM state (evaluate the expected marker; retry up to 3×).
- The console dump is CUMULATIVE for the session — `agent-browser console --clear` after each
  navigation so the pre-check gate judges only the current page's entries.
- `document.title` may be PAGE-LOCAL (namespace-driven), not the brand string — the precheck
  `--expect-title` guard must target the page's own title ("المستخدمون", "Students", "سجل التدقيق"),
  else every capture fails the title gate spuriously. Read the actual title from a probe capture first.
- PGlite data dirs are EXCLUSIVE per process: mutating `db/pglite` through an external script while
  the dev server holds it FORKS the view — the server keeps serving its pre-boot page cache (rows
  inserted externally stayed invisible to GraphQL until a full server restart). Rule: server
  STOPPED → mutate → server RESTART (same discipline `reset-state.sh` already prescribes).
- Seed users share `ADMIN_PASSWORD` (`seed-config.defaultAdminCredential`) — changing the env's
  admin credentials silently changes every demo user's password; capture-run login failures may be
  seed-config drift, not a bug.
- In sandboxes where the HARNESS can flip the working tree back to the default branch between tool
  calls (check `git reflog` — a checkout seconds after yours is the tell): never assume HEAD across
  tool calls. Re-verify `git branch --show-current` immediately before every
  `git add`/`commit`/`push`, and treat the remote branch ref as authoritative for CI.

- Storybook iframes do NOT receive the app's `next/font` CSS variables — Arabic (and other webfont
  scripts) render in a fallback font. Never flag Arabic shaping/tracking from a Storybook capture
  without confirming computed styles (`letterSpacing`, `fontFamily`) via `agent-browser eval`.
- MUI `Rating` star a11y names live on the LABEL element TEXT ("Star 4 of 5" / "النجمة 4 من 5") and
  the radio's accessible name — NOT on the hidden input's `aria-label` attribute (null). Star-click
  rigs must match `label.textContent`, not `input[aria-label]` (observed 2026-09-20).
- One origin everywhere (host-scoped cookies, observed 2026-09-20): cookies injected for `localhost`
  are NOT sent to `127.0.0.1` — a guarded page navigated on the other host bounces to login exactly
  like an expired session. Unify `browser-login.ts --inject`, every capture URL, and the precheck on
  ONE origin before blaming auth.

## Useful DOM-first verifications (don't need pixels)

- `agent-browser snapshot -i -c` — interactive a11y tree: proves headings, fields, per-row actions, checkmarks.
- `agent-browser console --level error` — error log check before each capture round.
- `agent-browser network requests --filter "<pattern>"` — GraphQL traffic proof when mutation flows matter.

## Eval + daemon + memory gotchas (added 2026-09-14)

- Long multi-statement `eval` strings (arrow IIFE + many statements) can throw
  `SyntaxError: Unexpected identifier` despite being valid JS — rewrite as comma-joined `var`
  statements without braces and retry; bisect the string before blaming the page.
- A crashed browser daemon (`Resource temporarily unavailable` after 5 retries) poisons the reused
  session name: kill the daemons AND switch to a FRESH session name before continuing.
- In memory-tight sandboxes the full component suite OOM-kills silently mid-run (exit 137, zero
  fail lines, lock released normally) — run the affected component files targeted (same preloads)
  and free dev-server memory first.

## DB-provider gotcha (added 2026-09-19)

- When the app runs `DB_PROVIDER=pglite`, the dev server holds the default `./db/pglite` data dir
  exclusively (single-process by design). Per-file quality loops (sub-loop.ts) eagerly open a
  SECOND PGlite on the same dir → concurrent loops corrupt it (WAL panic `incorrect prev-link`).
  Run every quality loop with `PGLITE_DATA_DIR=/tmp/<unique-dir>`, serialize multi-agent fix-wave
  gates, and never let two processes initialize the same data dir. A corrupt dir is rebuilt:
  stop server → fresh dir → `bunx drizzle-kit push --force` with a pglite-driver config → re-seed.
- Double-start corruption (observed 2026-09-28): in supervisor/reaper sandboxes an orphaned
  `next-server` can survive a pkill round and race the respawned server onto the same PGlite dir —
  every GraphQL mutation then fails with `Aborted(). Build with -sASSERTIONS for more info.`
  After ANY server restart assert exactly ONE `next-server` process (`ps aux | grep next-server`);
  if aborts appear despite that, rebuild the data dir (bootstrap + seed) before debugging code.
- Locale pinning must be re-applied after EVERY re-login/cookie re-injection: fresh sessions drop
  NEXT_LOCALE and the stored user locale (fresh DBs default to the app locale), silently turning
  EN capture batches into AR. The `--expect-title` guard is LOCALE-DEPENDENT — pin locale and
  expected title as ONE pair per batch ("Academic Tracking" en / "التتبع الأكاديمي" ar), or AR
  batches fail the title gate spuriously (observed 2026-09-23).
## Provider-error arbitration (added 2026-09-19)

- When the objective pre-check's console gate surfaces provider-specific GraphQL
  INTERNAL_SERVER_ERRORs (e.g. PGlite: "Failed query: begin isolation level repeatable read"),
  arbitrate the provider's TRANSACTION semantics before touching styles — the classic shape is a
  second top-level `db.transaction(..., { isolationLevel })` opened inside an open
  `withTransaction` block: it hard-fails on single-connection providers (PGlite) and silently
  splits snapshots on pooled Postgres. Canonical fix: pass the LIVE tx handle down (drizzle nests
  via savepoints) and put the isolation level on `withTransaction`'s config argument (see
  `backend/services/billing/admin-financial-auditing.service.read.helpers.ts` for the landed shape).

## Nested-worktree dev server (added 2026-09-19)

- `next dev --turbopack` resolves packages only inside the project root, so a nested git worktree
  cannot reach the parent checkout's node_modules and fails with "Could not find the Next.js
  package (next/package.json)". Symlinks are banned in this sandbox — hardlink-copy instead:
  `cp -al <parent>/node_modules <worktree>/node_modules` (zero extra disk, symlinked .bin entries
  survive the copy).

## Gates and captures must not share the sandbox's memory (added 2026-09-19)

- In a ~4GB sandbox the running dev server (turbopack, 2GB heap cap) plus the per-file sub-loop's
  type-aware eslint child OOM-kill each other — eslint dies with SIGKILL/SIGABRT and zero lint
  findings, which the gate reports as a lint FAILURE. Stop the dev server before running sub-loop
  gates (`pkill -f next-server`), run the gates with `LINT_QUEUE_CONCURRENCY=1
  LINT_MAX_OLD_SPACE_MB=1536`, then restart the dev server for recapture.

## Inspector fallback (added 2026-09-23; CDP viewport drop 2026-09-28)

When task-subagents cannot render images (sandbox harness: `Read` in a subagent returns
"[1 image(s) omitted: images are not available in sub-agent context]"), inspect via the
`z-ai vision` CLI instead — ONE image per call, which mechanically preserves the one-image
golden rule. Always pass an ABSOLUTE output path (`-o /abs/dir/verdict.json`): relative
`-o` paths silently produce no file. Keep verdicts idempotent (skip images that already
have a verdict file) so recapture batches can reuse the same runner.
`agent-browser set viewport` can also CLOSE the CDP channel and silently reset the
viewport (observed 500px) after long sessions — after any CDP hiccup ("CDP response
channel closed"), re-set the viewport AND re-verify the title guard before the next
capture.

## Real-form capture drives (added 2026-09-23)

When the surface under capture has unique-constraint UX (emails, payment references,
idempotency tokens), driving a REAL submission during the capture pass doubles as free
denial-path E2E: resubmitting the same payload renders the localized inline error as part
of the flow. Capture the error state too — it is one of the states reviewers ask about.

## Locale re-assertion between batches (added 2026-09-23)

The per-user locale preference can silently re-assert between capture batches (the
switcher writes through to the account; the cookie API does not). Before EVERY batch:
re-set the locale cookie AND re-verify the page's toolbar button aria-label marker —
if the marker doesn't match the expected locale's label, the batch will marker-fail.
