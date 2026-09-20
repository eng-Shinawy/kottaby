# Visual Scoring Outcome — Admin Subscription Management

- Date: 2026-09-19
- Plan: ai/plans/milestone_1_core_domain_mvp/Admin Subscription Management-admin-subscription-management/
- Capture rig: dev server @ 127.0.0.1:3000 (PGlite in-process, DB_PROVIDER=pglite)
- Inspector model: z-ai vision (VLM CLI), one image per call
- Locales captured: ar (default), en
- Dark-mode pass: no (app ships a single dark-first theme; light theme exists via the topbar toggle but the plan's surfaces were scored in the shipped default)

## Surfaces covered

| Surface | Story id / route | Viewports | States |
|---|---|---|---|
| Students directory (plan host page) | /students | 1440x900, 834x1112, 390x844 | list, AR + EN |
| Student details drawer — subscriptions region | /students (row click) | 1440x900, 390x844 | stats + filter chips + 5 rows (active/expired/cancelled/suspended/pending), AR + EN |
| Extend dialog | drawer → تمديد | 1440x900 | open state, AR |
| Cancel dialog | drawer → إلغاء الاشتراك | 1440x900 | open state + reason field, AR |
| Renew dialog | drawer → تجديد (expired row) | 1440x900 | open state, AR |
| Audit trail page | /audit | 1440x900, 390x844 | filters + entity chips + rows, AR + EN |
| Student subscriptions portal (downstream cross-user view) | /subscriptions | 1440x900, 390x844 | 5 plan cards, AR |

QA data: 5 subscriptions seeded on the demo student (payment_reference `qa-seed-%`) covering every lifecycle status; admin@test.com / seeded demo users; PGlite data dir `db/pglite`.

## Score history

| Pass | Surface | Viewport | Hier | Spacing | Typo | Color | Afford | Resp | Total(/6) | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | directory AR | 1440x900 | 9 | 9 | 10 | 9 | 10 | 10 | 9.5 | NEEDS FIXES (email truncation HIGH) |
| 1 | directory AR | 834x1112 | 9 | 9 | 9 | 9 | 10 | 8 | 9.0 | NEEDS FIXES |
| 1 | directory AR | 390x844 | 9 | 9 | 9 | 9 | 9 | 10 | 9.17 | NEEDS FIXES |
| 1 | drawer AR | 1440x900 | 9 | 9 | 10 | 8 | 9 | 9 | 9.0 | NEEDS FIXES (finding DOM-disproven) |
| 1 | drawer AR | 390x844 | 9 | 9 | 8 | 10 | 10 | 9 | 9.17 | NEEDS FIXES (email wrap — by-design debt) |
| 1 | extend dialog AR | 1440x900 | 9 | 9 | 9 | 9 | 9 | 10 | 9.17 | READY |
| 1 | cancel dialog AR | 1440x900 | 8 | 9 | 10 | 9 | 9 | 9 | 9.0 | NEEDS FIXES |
| 1 | renew dialog AR | 1440x900 | 8 | 8 | 9 | 9 | 9 | 8 | 8.5 | NEEDS FIXES (finding DOM-disproven) |
| 1 | audit AR | 1440x900 | 9 | 9 | 8 | 10 | 10 | 10 | 9.33 | NEEDS FIXES (bidi claim DOM-disproven) |
| 1 | audit AR | 390x844 | 9 | 9 | 8.5 | 10 | 9 | 9 | 9.08 | NEEDS FIXES |
| 1 | directory EN | 1440x900 | 9 | 9 | 8 | 10 | 9 | 9 | 9.0 | NEEDS FIXES (same email finding) |
| 1 | drawer EN | 1440x900 | 8 | 9 | 8 | 10 | 9 | 7 | 8.5 | NEEDS FIXES (drawer-overlay "overflow" = expected overlay) |
| 1 | drawer EN | 390x844 | 9 | 9 | 8 | 9 | 10 | 9 | 9.0 | NEEDS FIXES |
| 1 | audit EN | 1440x900 | 9 | 9 | 10 | 9 | 8 | 9 | 9.0 | NEEDS FIXES (CLEAR outlined = standard hierarchy) |
| 1 | audit EN | 390x844 | 8 | 9 | 8 | 8 | 9 | 9 | 8.5 | NEEDS FIXES |
| 1 | student portal AR | 1440x900 | 9 | 9 | 10 | 8 | 9 | 9 | 9.0 | NEEDS FIXES |
| 1 | student portal AR | 390x844 | 9 | 9 | 10 | 10 | 8 | 9 | 9.17 | NEEDS FIXES |
| 2 | drawer rows AR (post-fix) | 1440x900 | 9 | 9 | 9 | 9 | 10 | 10 | 9.33 | **READY** |
| 2 | drawer rows AR (post-fix) | 390x844 | 9 | 9 | 10 | 9 | 10 | 8 | 9.17 | NEEDS FIXES (LOW-only → accepted debt) |

Pass-2 rescoring focused on the fixed surface (drawer rows) — the region the plan actually builds; the directory/audit/dialogs already carried no HIGH findings after DOM adjudication (see accepted debt).

## Pre-check gate failures found (and fixed)

| Surface | Check | Script output line | Fix |
|---|---|---|---|
| directory captures (first attempt) | title guard | `expected substring "أكاديمية درافت", got "المستخدمون"` | capture harness title-substring corrected to the page title (harness fix, not a page defect) |
| All captures | console/overflow/offscreen/a11y | PASS (0 error-level console entries; no horizontal overflow at 1440/834/390; imgs alt ok; icon buttons named) | — |

## Fix waves

| Wave | Files | Findings addressed | Per-file sub-loop | Tests |
|---|---|---|---|---|
| 1 | `frontend/views/admin/students/subscriptions/SubscriptionPlanFactsLine.tsx` | AR bidi scramble: price/sessions/cycle fragments joined into ONE mixed-direction string let the bidi algorithm interleave runs (price digits visually collided with the session count in RTL). Now each fragment renders as its own `unicodeBidi: isolate` span inside the mirroring flex row; price pinned `dir="ltr"`. Verified geometrically (DOM rect x-order per row: price rightmost → cycle leftmost in AR). | sub-loop `--lifecycle duplicates` exit 0 | subscriptionAdmin.helpers 24/24 |
| 1 | `frontend/views/admin/students/AdminStudentIdentityCell.tsx` | Directory identity email truncates mid-address ("student@draftacad...") with only a bare native `title`. Now wrapped in a visible MUI Tooltip (arrow, 350ms delay). | sub-loop exit 0 | — |
| 1 | `backend/db/test/logic/audit/audit-immutability.test.ts` | NOT a visual finding — full db suite run (Phase 8) exposed a pre-existing red on this branch: the Phase-5 journey file `subscription-admin-lifecycle.journey.test.ts` (commit c80ae80) performs a guarded audit teardown but was never registered in `TEARDOWN_ALLOWLIST_PATHS`, breaking the bijection assertion. Added to the allowlist. | sub-loop exit 0 | audit-immutability 14 pass / 0 fail; test:db 819/819; test:graphql 243/243; test:services 1620/1620 |

## Accepted cosmetic debt

| Item | Current score impact | Why it can't reach 10 | Why acceptable |
|---|---|---|---|
| Long-email wrapping on the mobile drawer identity ("lo/cal" break) | −0.5 typography (one inspector pass) | A 26-char unbroken Latin email at 390px must wrap somewhere; `overflowWrap: "anywhere"` is the correct pathological-address fallback | Standard bidi-safe behavior; full address stays visible; copy action + tooltip cover retrieval |
| Native date inputs render browser-locale "mm/dd/yyyy" placeholders LTR inside the RTL audit filter | −0.5 typography | Browser-rendered placeholder, not authorable DOM (`<input type=date>`) | Values display localized once chosen; labels are RTL-aligned; platform limitation |
| MUI Dialog backdrop subtlety behind drawer dialogs | −0.5 hierarchy (single inspector) | MUI default elevation/backdrop; heavier overlay would fight the app's dark theme tokens | Dialogs are modal and focus-trapped; underlying content is dimmed and pointer-blocked |
| Apply (contained) vs Clear (outlined) button hierarchy on /audit | 0 (DOM-verified standard MUI pattern) | Deliberate primary/secondary hierarchy | Matches the app-wide button idiom |
| Sparse-content dead space below 1-row tables at 900px height | −0.5 responsive | Single demo student in the seeded dataset; table height follows row count | Real datasets fill the space; pagination row anchors the card |
| Inspector-hallucinated findings (Lectures/Curriculum cards, delete button, modal offset) | 0 | — | DOM/geometry checks disproved each; recorded as inspector-noise calibration per the rubric note |

## Prototype comparison

Skipped — the plan ships no `prototype/` directory (recorded per skill rule; no comparison targets invented).

## Capture lessons → evolution-log candidates

- PGlite data dir is EXCLUSIVE: seeding `db/pglite` through `pglite-sql.ts` while the dev server holds it produces a forked view (the server's in-process instance saw only the pre-boot rows; two of five seed rows were invisible to GraphQL until a server restart). Always stop the server, mutate, restart. (Logged to evolution-log.md)
- The sandbox harness itself can flip the working tree back to `main` between tool calls (observed twice via reflog, seconds after an explicit `git checkout feat/...`). Defense: never assume HEAD across tool calls — re-verify `git branch --show-current` immediately before every `git add`/`commit`/`push`, and treat the remote branch ref as the source of truth.
- Seed users all share `ADMIN_PASSWORD` (seed-config `defaultAdminCredential`) — when the env's ADMIN_EMAIL/ADMIN_PASSWORD change, the demo student/teacher/parent passwords change with them.
- `document.title` is page-local ("المستخدمون" / "Students" / "سجل التدقيق") — the capture harness's `--expect-title` must match the page title, not the brand title.
