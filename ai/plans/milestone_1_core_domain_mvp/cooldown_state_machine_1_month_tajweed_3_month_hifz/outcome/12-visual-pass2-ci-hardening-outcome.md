# 12 — Visual Improvement Loop Pass 2 + CI Gate Hardening (cooldown plan surfaces)

- Run: `visual-improvement-loop` SKILL.md pass 2, traces `1a0e7a0e9b9cfe91` / `1a0e8492e3485ca1`, branch `feat/cooldown_state_machine_1_month_tajweed_3_month_hifz`, commits 452c34f → 5839c40.
- Capture rig: dev server (real app, PGlite seed data, `admin@test.com` / `teacher@draftacademy.local` logins) — Storybook skipped per pass-1 lesson.
- Locale set: EN all surfaces × {1440, 834, 390} + AR spot pass (directory 390, RTL checklist applied).
- Prototype comparison: SKIPPED — plan has no `prototype/` dir (Phase 0/7 skip rule).

## Score history (pass 2, after 3 fix waves)

| Surface | 1440 | 834 | 390 | AR notes |
|---|---|---|---|---|
| Admin Users Directory | 8.0 READY (was 7.0) | 9.0 READY | 9.0 READY (zero findings) | AR 390: 9.33 READY |
| Teacher Dashboard | 9.3 READY | 9.4 READY | 9.5 READY | — |
| Admin User Detail (teacher) | 9.3 READY | — | 10 READY (zero findings) | — |
| Admin User Detail (student) | 9.5 READY | 9.67 READY | 9.7 READY | — |
| Notifications | 9.8 READY | — | 10 READY (was 9.2) | — |
| Audit Trail (route `/audit`) | 9.7 READY | — | — | — |
| Profile | 9.5 READY (was 9.2) | — | 9.8 READY | — |
| Landing | — | — | 9.0 READY (LOW-only after arbitration) | — |

No HIGH findings remain anywhere. Residuals are LOW-only or DOM-disproven → accepted debt per `references/rubric.md` calibration (VLM plateau) + accepted-debt clauses.

## Fix waves (pass 2)

Wave 1 — directory (4 files, all sub-loop `--lifecycle duplicates` exit 0):
- `DirectoryToolbar.tsx`: Country filter grows on the md–lg wrapped line (`flex: sm 1 1 220px`) — kills the 456px dead band before the right-aligned actions (pass-2 HIGH; DOM-verified: field 262→718px, remaining gap = COPY LINK button + standard 16px).
- `DirectoryStatusDetails.tsx`: admin "System User" line → neutral `TonalChip` (one component rhythm in the STATUS/DETAILS column); restructured to a single-return shape (sonarjs/function-return-type).
- `MobileUserCardList.tsx`: mid-list 88px FAB inset removed (double clearance read as a dead band at 834/390 — the MEDIUM); FAB clearance lives in the container's `pb: { xs: 12 }` BELOW the pagination card (DOM-verified at scroll end: FAB top 1032 vs card bottom 992 → zero overlap).
- `DirectoryPagination.tsx`: rows-per-page + page pills spread full card width below `md` (`flexGrow: { xs: 1, md: 0 }`) — desktop untouched.

Wave 2 — toolbar column rhythm:
- `DirectoryToolbar.tsx`: `columnGap: 2` — the 150px selects sat butt-joined with shared 1px seams (MEDIUM; DOM-verified gaps 0 → [16,16,16]).

Wave 3 — governance dialog dedup (CI-driven):
- New `GovernanceDialogPrimitives.tsx` (`GovernanceDialogBody` scalar-prop contract + `GovernanceDialogDaysField`/`Alert`/`Actions`): the three user-detail confirm dialogs previously carried 3 verbatim blocks → repo-wide jscpd `-t 0` reports **0 clones**; `role="status"` → native `<output>` in the panel chrome.

## CI quality gate hardening (the branch's first full CI exposed 5 downstream gates the per-file sub-loop cannot see)

1. oxlint max-lines/function caps (12 errors, 8 files) — extraction-only refactors: `DirectoryToolbarFilters`, `useDirectoryFilters`, `LifecyclePanelRows`/`Chrome`/`lifecycleBucketViews`, `activityTimelineEntry`, `admin-user.repository.helpers`, `applicant-lifecycle.helpers`/`override-arms` (service 508→255 counted lines, normalized-diff 0, public signatures unchanged); hook 98→71; `role=status` fix.
2. oxlint `--deny-warnings` (13 warnings) — `Object.assign` over spread-in-map, `Promise.all` over await-in-loop, module-level no-capture helpers, type guards replacing unsafe assertions.
3. jscpd cross-file clones (3) — see wave 3.
4. ESLint `import-x/no-duplicates` — merged type+value `@mui/material` import.
5. knip `--treat-config-hints-as-errors` (4 unused exports) — dead `isApplicantOverrideAction` guard deleted, stale `AdminCooldownLifecycleRow` re-export removed, internal-only primitives un-exported.

## Real bug found by CI tests (fixed, verified)

- **`applicant_outcome` pgEnum value missing from the migrate path**: the plan's notifications insert it, the drizzle schema carried it, but no committed SQL migration added it — fresh CI databases fail every lifecycle notification insert (`invalid input value for enum notification_type`). Fixed with `backend/db/migration/10-applicant-outcome-notification.sql` (idempotent guard pattern of migration 7) + auto-bundled drizzle folder; local verification: `bun db migrate` applies `custom_10`, enum query lists all 10 values. Also registered the two plan mutations in the warning-surfacing contract lock (`KNOWN_LIVE_MUTATION_FIELDS`).

## Final CI state

Run 36458632104 (commit 5839c40): **quality ✓ tests-db ✓ tests-graphql ✓ tests-services ✓ CodeRabbit ✓** — PR #262 MERGEABLE.

## DOM arbitrations (disproven findings — dismissed, never "fixed")

1. Directory 390 "Deleted chip off-viewport" — inside a genuine `overflow-x: auto` scroll ancestor (scrollWidth 404 > clientWidth 326; page sw=iw=390): designed scroll affordance per objective-prechecks false-positive note.
2. Directory 834 "FAB grazes pagination card" — fullPage-capture artifact; at real scroll end FAB top 1032 vs card bottom 992, overlap 0.
3. Detail "email truncated without tooltip" (1440) — hero email renders untruncated (sw=cw=190); only the compact audit row truncates (146/193) WITH `title` tooltip — pass-1 arbitration pattern holds.
4. Landing 390 "cookie legal copy cramped" — computed line-height 20.15px / 13px font = exactly 1.55 (the wave-1 fix is live).
5. Directory AR 390 "FAB must anchor bottom-right" — direction-confused; MUI mirrors the FAB to bottom-left in RTL (fabLeft=16, correct); pagination chevrons swap via theme direction (rtl confirmed).

## Accepted debt (both justifications per item)

- Plateau residuals (8.0–9.8 READY band): (a) VLM inspectors reserve 10 for "flawless" and regenerate rotating micro-findings on unchanged pixels (documented contradiction signature); (b) no HIGH findings, all LOWs are sub-pixel rhythm opinions, platform caveats (touch tooltips), or already-verified false positives — functional journeys and CI are green.
- Search placeholder tone vs selects (MUI default tokens app-wide — diverging the shared primitive for one surface would create inconsistency).
- Page title outdent vs card-internal padding (nested page/card grid, consistent app-wide pattern).
- Audit chip padding micro-drift, kebab proximity (subjective, sub-pixel).

## Capture lessons (promoted to the skill evolution log)

1. Inspector-image subagent channel can degrade mid-run ("images are not available in sub-agent context", persistent across retries) — the `z-ai vision` CLI with the same rubric prompt is a reliable fallback inspector (used for 9 of 16 pass-2 inspections).
2. `agent-browser set viewport` can drop the CDP channel and reset the viewport (500px) after long sessions — re-set viewport AND re-verify the title guard after any CDP hiccup.
3. A branch that passed per-file sub-loop gates can still fail CI's whole-repo gates (knip unused exports, cross-file jscpd, eslint full, `--deny-warnings`): run `bun run check:unused`, repo-wide `bun run check:duplicates`, `bun run biome:check` (a WRITER — commit its diff) and `bunx tsgo -b --noEmit` before pushing.
4. New pgEnum VALUES need a committed `backend/db/migration/*.sql` (drizzle schema arrays only cover the push path); `bun db migrate` auto-bundles them — verify with a direct enum-space query on a freshly rebuilt dir.
5. The quality job's trailing "Verify clean working directory" step fails when any check writes — run every writing check locally and commit the result before pushing.
