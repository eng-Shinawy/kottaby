# Visual Scoring Outcome — admin password reset plan (post-implementation visual loop)

- Date: 2026-10-01
- Plan: ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/
- Capture rig: dev server @ localhost:3000 (PGlite provider, sandbox-local), agent-browser CLI sessions
- Inspector model: z-ai vision CLI (VLM-CLI fallback mode — subagent image delivery disabled in sandbox), ONE image per call
- Locales captured: en, ar
- Dark-mode pass: yes (dark IS the app default — `initialTheme ?? "dark"`; a dedicated light pass was added on top)

## Surfaces covered

| Surface | Route / component | Viewports | States |
|---|---|---|---|
| Forced /change-password page | `/change-password` → `ChangePasswordForm` (+ `useChangePasswordForm`) | 1440×900, 834×1112, 390×844 | initial (flagged, temporary-password notice), wrong-current-password inline error |
| Admin set/reset dialog | `/admin/users/[id]` → `ChangeUserPasswordDialog` + `ChangeUserPasswordFormFields` | 1440×900, 834×1112, 390×844 (mobile-first states) + AR desktop/mobile | empty, confirm-mismatch inline error, force-flag checked |
| Cross-user journey evidence | admin → teacher, admin → student | — | flag ON via dialog → forced redirect → denial path → successful change → role dashboard |

Viewport trio per skill default; tablet (834×1112) captured EN for both surfaces (mobile-first plan surfaces reflow continuously; AR spot-checked at the two extreme widths).

## Score history

Pass 1 = dark scheme (app default) pre-fix; Pass 2 = dark re-capture post-fix + full light-scheme pass. Totals are VLM means (integer-step plateau documented in rubric).

| Pass | Surface | Viewport | Total | Verdict |
|---|---|---|---|---|
| 1 | chpw desktop EN | 1440×900 | 9.2 | READY |
| 1 | chpw tablet EN | 834×1112 | 9.0 | READY |
| 1 | chpw mobile EN | 390×844 | 9.3 | READY |
| 1 | chpw desktop EN error | 1440×900 | 9.0 | READY |
| 1 | chpw mobile EN error | 390×844 | 9.2 | READY |
| 1 | chpw desktop AR | 1440×900 | 9.2 | READY |
| 1 | chpw mobile AR | 390×844 | 9.0 | READY |
| 1 | chpw mobile AR error | 390×844 | 9.7 | READY |
| 1 | dialog desktop EN | 1440×900 | 9.0 | READY |
| 1 | dialog tablet EN | 834×1112 | 8.8 | READY |
| 1 | dialog mobile EN | 390×844 | 9.0 | READY |
| 1 | dialog mobile EN error | 390×844 | 9.3 | READY |
| 1 | dialog mobile EN flagged | 390×844 | 9.2 | READY |
| 1 | dialog desktop AR | 1440×900 | 9.0 | READY |
| 1 | dialog mobile AR | 390×844 | 8.7 | READY |
| 2 | chpw desktop EN (light) | 1440×900 | 9.0 | READY |
| 2 | chpw tablet EN (light) | 834×1112 | 9.0 | READY |
| 2 | chpw mobile EN (light) | 390×844 | 9.2 | READY |
| 2 | chpw desktop EN error (light) | 1440×900 | 9.2 | READY |
| 2 | chpw mobile EN error (light) | 390×844 | 9.3 | READY |
| 2 | chpw desktop AR (light) | 1440×900 | 9.0 | READY |
| 2 | chpw mobile AR (light) | 390×844 | 9.2 | READY |
| 2 | chpw mobile AR error (light) | 390×844 | 9.5 | READY |
| 2 | dialog desktop EN (light) | 1440×900 | 9.2 | READY |
| 2 | dialog tablet EN (light) | 834×1112 | 9.2 | READY |
| 2 | dialog mobile EN (light) | 390×844 | 9.5 | READY |
| 2 | dialog mobile EN error (light) | 390×844 | 9.0 | READY |
| 2 | dialog mobile EN flagged (light) | 390×844 | 9.5 | READY |
| 2 | dialog desktop AR (light) | 1440×900 | 9.0 | READY |
| 2 | dialog mobile AR (light) | 390×844 | 9.0 | READY |
| 2 | chpw all 8 dark states re-inspected post-fix | trio | 8.8–9.5 | READY |

30/30 captures READY. Zero HIGH/MEDIUM findings remain.

## Pre-check gate failures found (and fixed)

None — every state (both passes, all viewports, both locales, both schemes) passed the objective gate first try: title guard, console clean, no horizontal overflow, no off-viewport bleed, a11y smoke (imgs/unnamed-icon-buttons = 0).

## Fix waves

| Wave | Files | Findings addressed | Per-file sub-loop | Tests |
|---|---|---|---|---|
| 1 | `frontend/components/AuthFormShared.tsx` | Auth CTA rode `secondary.main`; light-mode pairing `#FFFFFF` on `#B87333` computes to **3.79:1** — below the 4.5:1 WCAG AA text floor (16px bold is not "large text"). Swapped button background token to `secondary.dark` (uniform var, no mode branch): light 6.14:1, dark 4.99:1 — both AA. DOM-verified post-fix: light-mode computed `rgb(139,85,32)` = `#8B5520`. | `sub-loop.ts --lifecycle duplicates` exit 0 | UI journeys re-run live (see below) |
| 1 | `frontend/providers/theme/palette/lightPalette.ts` (doc comment only) | The palette header claimed `onSecondary` on `secondary.main` ≈ 4.6:1 — arithmetically wrong (actual 3.79:1). Comment corrected with measured numbers so the bad pairing cannot be re-adopted from the doc. | `sub-loop.ts --lifecycle duplicates` exit 0 | n/a (comment) |

Note: the dark (default) scheme's original CTA pairing (#1A0E05 on #E0985C = 7.94:1) already passed AA; the uniform `secondary.dark` token keeps dark AA-compliant (4.99:1) while repairing light. The first-pass inspector's "white text at ~2.8:1" framing was a hallucination (text is near-black on dark scheme) — the REAL defect it surfaced was light-mode 3.79:1, fixed above.

## DOM arbitration record

- **DISPROVEN — RTL checkbox misalignment** (dialog-mobile-390-ar): inspector claimed "checkbox pushed far right, text left-aligned, wide awkward gap". Measured rects: checkbox right edge == row right edge (349==349, inline-start in RTL), label block spans 68→307 flush against it, `align-items:center`, `textAlign:start`. Correct MUI RTL mirroring; dismissed.
- **DISPROVEN — contrast hallucination** (first pass): "very light orange/peach with white text ~2.8:1" — dark scheme renders near-black text on copper (7.94:1). Arbitrated via computed styles + WCAG math; superseded by the real light-mode defect (fixed).
- **DISPROVEN — "labels sit on the field's top border"**: MUI outlined/notched-label convention shared with the login/register surfaces (`PasswordField` in `AuthFormShared`); design-system behavior, not a defect.
- **DISPROVEN — "form block sits high, excessive bottom space" (mobile)**: deliberate centered layout (`minHeight:100dvh`, `alignItems:center` on the page main).

## Accepted cosmetic debt

| Item | Current score impact | Why it can't reach 10 | Why acceptable |
|---|---|---|---|
| VLM integer-step plateau (totals 8.7–9.7, all findings LOW) | ≥9 per axis on average | VLMs reserve 10 for "flawless" and estimate ±4px spacing from pixels; findings are mutually contradictory across passes (e.g. desktop spacing flagged "too tight" round 1 and "too generous" round 2 on unchanged pixels) | Every actionable claim was fixed or DOM-arbitrated; no user-visible defect remains |
| Confirm-password field has no visibility toggle (dialog) | affordance 8–9 on 2 captures | Deliberate code convention: only the primary credential field gets the `CreateUserCredentialField` show/hide recipe; confirm fields stay masked app-wide (and on `/change-password` all three DO have toggles — different shared component, same per-surface consistency) | Consistent within each surface; industry-standard practice |
| Info-notice text wrap produces a one-word orphan line (AR desktop) | typography 9 | Copy length is fixed by the translation; fixing would need ad-hoc max-width/text-wrap on the shared Alert | Single orphan word in a helper notice; no task-comprehension impact |
| Error-text margin rhythm "±4px vs 8px" claims | spacing 8–9 | Pixel-estimation noise at the MUI FormHelperText default offset; DOM shows the standard component spacing | Standard MUI rhythm, identical to login/register |

## Prototype comparison

Skipped — the plan has no `prototype/` directory (never invent comparison targets).

## Journey re-verification (live, PGlite)

- admin (admin@test.com) → teacher (id 2): dialog submit with force-flag → detail Governance shows "PASSWORD RESET PENDING / Required on next login".
- teacher login with admin-set password → forced `/change-password`; wrong-current-password denial (EN + AR, field-mapped, constant shape); successful change → `/teacher/dashboard`.
- admin → student (id 4): same dialog leg; student forced flow → change → `/student/dashboard`. Old-password rejection and flag clearing verified in the prior session's E2E (Task 2) and unchanged backend.
- DB left at seed defaults (all passwords `12345678`-equivalent seed credential, all flags false).

## Capture lessons → evolution-log candidates

- **Theme-scheme awareness of captures**: this app defaults to DARK (`initialTheme ?? "dark"`); the first capture batch was dark-scheme without the orchestrator realizing. Inspectors (and humans) reason differently about color/contrast per scheme — pin and RECORD the scheme per batch exactly like locale (`data-mui-color-scheme` + `getComputedStyle(document.body).backgroundColor` guard). Scheme persists via localStorage `theme` + `theme-mode` cookie; set BOTH and reload.
- **Contrast findings must be computed, never eyeballed**: the VLM invented "white text ~2.8:1". Any contrast finding → read `getComputedStyle` bg/color from DOM + compute the WCAG ratio before accepting; VLMs frequently misidentify text color on tinted buttons.
- **`.env` autoload defeats dotenv-based credential switching**: `bun run` loads `.env` first; `dotenv.config` then no-ops for already-set keys, so a per-actor env file using the SAME key names silently logs everyone in as the admin. Use distinct key names (`--email-key/--password-key`) for actor switching.
- **Shared-profile sessions**: agent-browser sessions under one scope share one browser cookie jar — "fresh session" does NOT log you out; sign out via UI or overwrite cookies deliberately, and verify identity in-page (topbar text) after every login switch.
- **PGlite `Aborted()` after restart** re-confirmed the documented double-start corruption; rebuild = stop → `rm -rf db/pglite` → bootstrap → `drizzle-kit push --force` (for TS-only schema deltas like `must_change_password` which have no SQL migration) → seed → restart.

## Artifacts

- Screenshots + verdicts: `scratch/screenshots/*.png` (30), `scratch/verdicts/*.verdict.txt` (30) — sandbox-ephemeral, not committed (binary capture rig output).
- Fix commit: `fix(frontend): AA-compliant auth CTA token (secondary.dark) + palette contrast doc correction` on `feat/admin_can_t_change_users_password-admin_password_reset`.
