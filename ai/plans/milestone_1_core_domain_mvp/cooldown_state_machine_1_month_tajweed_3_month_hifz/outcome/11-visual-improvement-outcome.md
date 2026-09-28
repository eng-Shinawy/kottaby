# 11 — Visual Improvement Loop Outcome (cooldown plan surfaces)

- Run: `visual-improvement-loop` SKILL.md, trace `1a0e7a0e9b9cfe91`, branch `feat/cooldown_state_machine_1_month_tajweed_3_month_hifz`
- Capture rig: dev server (real app, real seed data) — Storybook attempted first but its process dies silently in this sandbox (reaper + Chromatic watcher ENOSPC); the documented dev-server fallback was used with `browser-login.ts --inject` sessions.
- Locale set: EN (all plan surfaces × 1440/834/390) + AR spot passes (directory 1440/390, user detail 390, teacher dashboard 1440/390).
- Prototype comparison: SKIPPED — the plan has no `prototype/` dir (per Phase 0/7 skip rule).

## Score history (final pass, after 2 fix waves)

| Surface | 1440 | 834 | 390 | AR notes |
|---|---|---|---|---|
| Admin Dashboard | 9.5 READY | 9.7 READY | 9.5 READY (was 9.0) | — |
| Admin Users Directory | 9.0* | 9.2* | 8.9* | AR 1440/390: 9.0* |
| Admin User Detail | 9.0* | 9.5 READY (was 9.2) | 9.0* | AR 390: 9.3* |
| Teacher Dashboard (applicant) | 9.2* | 9.2* | 9.2* | AR: 9.0* |
| Notifications | 9.5 READY | — | 9.2* | — |
| Audit Trail | 9.2* | — | 9.7 READY | — |
| Landing | 9.5 READY | — | 9.0* | — |
| Profile | 9.2* | — | 9.5 READY | — |

`*` = every remaining finding is LOW-only AND (DOM-disproven OR contradicts an earlier pass OR environment-caused) — adjudicated as accepted debt per `references/rubric.md`'s calibration + accepted-debt clauses. No HIGH findings remain anywhere.

## Fix waves (16 files, all sub-loop `--lifecycle duplicates` exit 0)

Wave 1 (parallel disjoint fixers 5-a…5-d + 5-c2 completion by orchestrator):
- `teachers/dashboard/ApplicantStatusZones.tsx` — cooldown-branch disabled RE-APPLY affordance made explicit: dashed border, `cursor: not-allowed`, `action.disabled` color, `action.disabledBackground` fill, 0.72 opacity (state remains disabled BY DESIGN — the truthful unlock date sits above it).
- `teachers/dashboard/ApplicantStatusShell.tsx` — status accent bar 3→4px.
- `admin/users/directory/MobileUserCardList.tsx` — `paddingBlockEnd: 3→11` so the FAB never covers the last card (DOM-verified: last card bottom 732 vs FAB top 764 at scroll end).
- `admin/dashboard/AdminCooldownLifecyclePanel.tsx` — `textWrap: balance` on helper copy (kills the lonely "pre-filtered." wrap at 390) + shared `ROW_SHELL` constant for uniform row alignment.
- `admin/users/detail/AdminUserDetailContainer.tsx` — content maxWidth 840 centered (kills wide-viewport dead space).
- `admin/users/detail/GovernanceActionsSection.tsx` + `UserHeroActions.tsx` — destructive outlined buttons get `alpha(error.main, 0.08/0.12)` tint.
- `admin/users/detail/UserDetailPrimitives.tsx` — error tone lane → solid `error.main`/`onError` (Failed badge contrast) + DetailInfoStrip inline padding aligned to card grid.
- `admin/users/detail/UserHeroIdentity.tsx` — "Member Since" gets the same ContactItem icon treatment as siblings (EventOutlined).
- `notifications/ui/NotificationFilterChips.tsx` — FILTERS toggle gets a rotating ExpandMoreOutlined affordance.
- `dashboard/profile/cards/AccountStatusCard.tsx` — inactive status chips outlined+dim vs active solid (affordance).
- `dashboard/profile/cards/AccountInfoCard.tsx` — rows alignItems flex-start (no mid-cell icon shift).
- `admin/audit/AuditTrailFilterFields.tsx` — helper text pinned to the input's 14px inline inset + CLEAR button AA contrast via `outline`/`text.secondary` tokens.
- `landing/sections/hero/HeroCopy.tsx` — mobile subtitle bottom margin 12px. `landing/sections/floating/CookieConsentBanner.tsx` — legal copy line-height 1.55.

## DOM arbitrations (disproven findings — dismissed, never "fixed")

1. RE-APPLY "should be active" (pass 1 MEDIUM) — contradicts the cooldown domain: disabled while `canPurchaseVerification=false` is the plan's core behavior. Dismissed by design.
2. RE-APPLY "add lock icon / cursor-not-allowed / border / fill / dim" (passes 2-4, mutually contradictory on identical pixels) — all requested affordances DOM-verified present after wave 1. Rubric contradiction signature; loop closed at 4 passes.
3. Directory FAB "obscures content" — `getBoundingClientRect` at scroll end: clear=true after wave 1.
4. Directory "الكل" selected-chip contrast — white on rgb(61,107,160) ≈ 5.9:1 (AA pass); filled variant IS the selected state.
5. Detail "email truncated without tooltip" — ContactItem exposes `title` on truncate; at 1440 the value renders untruncated.
6. Audit "helper text misaligned" — computed `marginInlineStart: 14px` = MUI OutlinedInput text inset (aligned by definition).
7. "Member Since shows future date (2026)" / "recitation misspelled" / "ملاحظات textarea label" — sandbox clock is 2026 (system `date`); the word is spelled "recitation" in both pass and DOM; no such textarea exists on the directory page (hallucination).

## Accepted debt (both justifications per item)

- Teacher dashboard / directory / detail / notifications / audit / landing / profile LOW residuals (plateau 9.0-9.3): (a) cannot reach 10 because VLM inspectors plateau at 9.0-9.3 reserving 10 for "flawless" and regenerate rotating micro-findings ("increase padding"/"reduce padding") on unchanged pixels — documented contradiction signature; (b) acceptable because no remaining finding is HIGH, all are sub-pixel rhythm opinions or already-verified false positives, and the plan's functional journey (12/0/264) plus quality gates (tsgo/biome/lint/duplicates all green) are unaffected.
- Notifications MARK-ALL disabled at 390: state-driven (`unreadCount===0`) — correct behavior, explanatory empty-state copy present.
- BALANCE stat "—": honest i18n `statUnavailable` placeholder, same variant/weight/centering as numeric stats.

## Re-verification

- Per-file sub-loop `--lifecycle duplicates`: 16/16 exit 0.
- Plan journey test re-run after all edits: `cooldown-state-machine.test.ts` → **12 pass / 0 fail / 264 expects**.

## Capture lessons (promoted to the skill's evolution log)

1. Storybook is not survival-safe in this sandbox (silent death after "ready"); dev-server captures with `--inject` auth are the reliable rig — budget for session invalidation on every server restart.
2. PGlite double-start corruption: an orphaned `next-server` surviving pkill + a supervisor respawn = two WASM instances on one data dir = `Aborted()` login 500s. Always verify `servers=1` after restart; rebuild dir (bootstrap+seed) when aborts appear.
3. Score-script verdict caching must be cleared per recapture round or stale verdicts alias as new ones.
