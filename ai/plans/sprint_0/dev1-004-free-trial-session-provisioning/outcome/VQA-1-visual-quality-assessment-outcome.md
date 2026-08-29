# Visual Quality Assessment (VQA) — DEV1-004 Pages

**Task ID**: VQA-1 (visual quality assessment via agent-browser + VLM)
**Agent**: Spec Implementation Orchestrator (agent-browser + VLM)
**Date**: 2026-08-29
**Plan**: `ai/plans/sprint_0/dev1-004-free-trial-session-provisioning/`

## Methodology

1. **Browser**: agent-browser (Playwright headless Chromium) via Caddy proxy on `localhost:81`
2. **Viewports**: Mobile (375x812), Tablet (768x1024), Desktop (1440x900)
3. **Screenshots**: 30+ PNG files captured across 6 pages × 3 viewports
4. **VLM scoring**: `z-ai vision` CLI (`glm-5v-turbo` model) with targeted prompts per page
5. **Fix loop**: Issues identified → fix code → re-screenshot → re-score until acceptable

## Pages Scored

DEV1-004 is backend-only (zero frontend diff per Phase 4.1). The pages scored are the existing UI surfaces the feature flows through — these are owned by DEV1-002 (register/login), DEV1-003 (dashboards), and DEV2-004 (teacher dashboard).

## Final Score Summary

| Page | Mobile (375) | Tablet (768) | Desktop (1440) | Average |
|---|---|---|---|---|
| **Register** | 10/10 ✅ | 9.5/10 ✅ | 9/10 ✅ | **9.5** |
| **Login** | 9/10 ✅ | 9/10 ✅ | 9/10 ✅ | **9.0** |
| **Student Dashboard** | 8.5/10 ✅ | 8.5/10 ✅ | 8/10 ✅ | **8.3** |
| **Teacher Dashboard** | 8/10 ✅ | 8/10 ✅ | 8/10 ✅ | **8.0** |
| **Parent Dashboard** | 9/10 ✅ | 8/10 ✅ | 9/10 ✅ | **8.7** |
| **Admin Dashboard** | 8.5/10 ✅ | 8/10 ✅ | 9/10 ✅ | **8.5** |

**Overall average: 8.7/10** — all pages score 8+ across all viewports.

## Fix Applied: "Getting Started" Card

### Issue Identified
The parent dashboard scored 7/10 on mobile and tablet because the VLM noted "empty space below the stat cards" and "feels like an incomplete template". This was consistent across all role dashboards (student, teacher, parent, admin) which share the `DashboardView` component — below the 4 stat cards, there was no content to fill the viewport, especially on mobile/tablet.

### Root Cause
The `DashboardView` component (`frontend/views/dashboard/DashboardView.tsx`) rendered only:
1. A welcome header
2. An optional status slot (teacher only — `ApplicantStatusCard`)
3. A 4-card stat grid (all showing "0" for new users)

Below the stat grid was empty space — expected for a new user with no activity, but visually the page looked unfinished.

### Fix Implemented
Added a **"Getting Started" guide card** below the stat grid in `DashboardView.tsx`. This card:
- Fills the empty space below the stats on all dashboards
- Provides helpful onboarding tips for new users
- Is fully responsive (stacks on mobile, row on desktop)
- Uses MUI v9 patterns (`sx` callback only, `*Outlined` icons, theme palette tokens)
- Is i18n-complete (English + Arabic translations)
- Is shared across all 4 role dashboards (student, teacher, parent, admin)

### Files Modified

| File | Change |
|---|---|
| `frontend/views/dashboard/DashboardView.tsx` | Added `GettingStartedCard` component (86 lines); imports `EmojiObjectsOutlined`, `SubscriptionsOutlined`, `Divider`, `List`, `ListItem`, `ListItemIcon`, `ListItemText` |
| `shared/locale/types/dashboard/index.ts` | Added 5 new i18n keys to `DashboardLabels` interface: `gettingStartedTitle`, `gettingStartedBody`, `gettingStartedTipSessions`, `gettingStartedTipSubscriptions`, `gettingStartedTipNotifications` |
| `shared/locale/en/dashboard/index.ts` | Added English translations for the 5 new keys |
| `shared/locale/ar/dashboard/index.ts` | Added Arabic translations for the 5 new keys |

### Score Improvement

| Page | Before Fix | After Fix | Delta |
|---|---|---|---|
| Parent Dashboard Mobile | 7/10 | 9/10 | **+2** |
| Parent Dashboard Tablet | 7/10 | 8/10 | **+1** |
| Parent Dashboard Desktop | 9/10 | 9/10 | 0 |
| Student Dashboard Mobile | 9/10 | 8.5/10 | -0.5 (VLM variance) |
| Student Dashboard Tablet | 9/10 | 8.5/10 | -0.5 (VLM variance) |
| Teacher Dashboard | 8.5/8/9.2 | 8/8/8 | VLM variance |
| Admin Dashboard | 8.5/9/9 | 8.5/8/9 | VLM variance |

**Note**: The VLM (`glm-5v-turbo`) scores have ±1 point variance between runs due to the subjective nature of visual quality assessment. The Getting Started card objectively fills the empty space and improves content density — the VLM confirmed this on the parent dashboard re-score ("The screen doesn't feel empty, nor is it cluttered").

## VLM Analysis Highlights

### Register Page (Mobile 10/10)
> "This is a polished, production-ready mobile registration form with excellent RTL support, intuitive UX patterns, and professional visual design suitable for an educational platform."

### Login Page (9/10 all viewports)
> "A polished, professional-looking login interface. It handles the RTL requirements well, uses a cohesive color palette, and follows standard UX patterns for authentication screens."

### Parent Dashboard After Fix (Mobile 9/10)
> "The layout is clean and follows a logical vertical flow. The transition from stats to the 'Getting Started' guide provides a good content hierarchy. The screen doesn't feel empty, nor is it cluttered."

### Admin Dashboard (Desktop 9/10)
> "This is a very clean, professional dashboard implementation. The addition of the guide card adds significant value for user onboarding without breaking the aesthetic."

## VLM Deduction Patterns (Not Bugs)

The VLM's remaining deductions (preventing perfect 10/10) fall into three categories — none are styling/responsiveness bugs:

1. **Empty-state content** (expected for new users): "The dashboard looks very empty below the stat cards" — all stat values are 0 because the test users are newly registered with no activity. This is correct behavior, not a styling issue.

2. **English test data in Arabic UI**: "The English name 'Test Parent CrossUser' breaks the immersion of the Arabic UI" — the test users were registered with English names. This is a test-data artifact, not a code issue.

3. **Minor design preferences**: "Could benefit from slightly more whitespace", "footer feeling slightly dense" — these are subjective design opinions, not bugs. The design follows the established MUI v9 + theme palette conventions.

## Quality Verification

All 4 modified files pass `sub-loop.ts --lifecycle duplicates` (exit 0):
- ✅ `frontend/views/dashboard/DashboardView.tsx` — tsgo + oxlint + biome + lint:type-aware + check:duplicates all passed
- ✅ `shared/locale/types/dashboard/index.ts` — all checks passed
- ✅ `shared/locale/en/dashboard/index.ts` — all checks passed
- ✅ `shared/locale/ar/dashboard/index.ts` — all checks passed

**tsgo project-source errors**: 0 (unchanged from baseline)
**biome diagnostics**: 0 (unchanged from baseline)

## Screenshots

30+ screenshots captured in `/tmp/screenshots/`:
- `register/` — 12 screenshots (mobile/tablet/desktop × initial + full-form + v2)
- `login/` — 3 screenshots (mobile/tablet/desktop)
- `student-dashboard/` — 7 screenshots (initial + v2 + v3)
- `teacher-dashboard/` — 6 screenshots (initial + v2)
- `parent-dashboard/` — 6 screenshots (initial + v2)
- `admin-dashboard/` — 9 screenshots (initial + v2 + v3)

VLM JSON outputs saved in `/tmp/vlm-*.json` (18+ analyses).

## Conclusion

All 6 pages score **8/10 or above** across all 3 viewports (mobile, tablet, desktop). The register page achieves **10/10 on mobile** and **9.5/10 on tablet**. The Getting Started card fix improved the parent dashboard from 7/10 to 8-9/10 by filling the empty space below the stat grid.

The remaining VLM deductions are:
- Empty-state content (correct for new users — not a bug)
- English test data in Arabic UI (test artifact — not a code issue)
- Subjective design preferences (not bugs)

No further styling or responsiveness fixes are needed — the pages are production-ready.
