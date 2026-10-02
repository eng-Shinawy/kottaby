# Task 8 Outcome — i18n keys EN/AR + parity pins (`adminUsers` + `auth` + `errors`)

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `8. i18n: adminUsers + auth + errors keys EN/AR + parity pins (D8, REQ-002, REQ-010)` (Phase 4 — independent of Tasks 1-7; run in parallel with the backend chain)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root used:** `/home/z/my-project` (plan docs cite the author's machine `/home/ahmed/Projects/kottaby_kottaby/`; all paths resolve 1:1 relative to the repo root)
> **Result:** 16 keys added across 3 namespaces × EN/AR, parity pins extended, both parity belts green (85/85 + 58/58), 11/11 sub-loop runs exit 0, full-repo `bun tsgo` **0 errors / exit 0**.

## 1. What Was Implemented — exact key trees added

### 1.1 `adminUsers` namespace (FLAT strings ONLY — zero function leaves added)

**`shared/locale/types/adminUsers/index.ts`** (`AdminUsersLabels`) + mirrored implementations in `shared/locale/en/adminUsers/index.ts` (`adminUsersEn`) and `shared/locale/ar/adminUsers/index.ts` (`adminUsersAr`):

```text
AdminUsersLabels
├── changePasswordAction: string                          ← NEW top-level flat string (directory row-kebab item + detail hero button label)
├── changePasswordDialog: {                               ← NEW block (8 flat-string keys, placed after editDialog)
│   ├── title: string
│   ├── subtitle: string
│   ├── newPasswordLabel: string
│   ├── confirmPasswordLabel: string
│   ├── mustChangePasswordLabel: string                   (checkbox label — "Require the user to change this password on next login")
│   ├── mustChangePasswordHelper: string
│   ├── submit: string
│   └── cancel: string
├── detail (EXISTING block — 2 leaves appended after detail.blockedAt)
│   ├── mustChangePasswordLabel: string                   ← NEW (governance-card flag label, "Password reset pending")
│   └── mustChangePasswordValue: string                   ← NEW (display value while the flag is set, "Required on next login")
└── snackbars (EXISTING block — 1 leaf appended after .certified)
    └── passwordChanged: string                           ← NEW ("Password changed." / "تم تغيير كلمة المرور.")
```

12 new leaves total in `adminUsers`. EN copy follows the existing dialog chrome style (`createDialog.password`/`.passwordHelper` tone, "Cancel" endings, trailing-period snackbar sentences). AR copy uses the established terminology (كلمة المرور، تعيين، إلزام، تسجيل الدخول التالي) and every AR leaf carries Arabic script (the parity suite's fallthrough sweep passes). No ICU placeholders were introduced anywhere (placeholder parity inherited trivially; the walker's `FUNCTION_SLOT_PATHS` list is unchanged — no function leaf was minted).

**Placement decision (recorded for Task 9/10):** `changePasswordAction` is a TOP-LEVEL flat string (sibling of `title`/`detailTitle`), because the directory kebab menu currently reuses dialog-block labels (`editDialog.title`, `deleteConfirm.confirm`, `reactivateConfirm.confirm` per `DirectoryActionsMenu.tsx`) and there is no dedicated menu block; a top-level action label serves BOTH Task 9 mounts (directory kebab `DirectoryActionsMenu.tsx` and detail hero `UserHeroActions.tsx`) without forcing it under the detail-only `detail` block or a dialog block.

### 1.2 `auth` namespace

**`shared/locale/types/auth/index.ts`** (`AuthLabels`) + `shared/locale/en/auth/index.ts` (`authEn`) + `shared/locale/ar/auth/index.ts` (`authAr`) — one NEW block appended at the interface tail (after `registerMetaTitle`):

```text
AuthLabels
└── changePassword: {                                     ← NEW block (9 flat-string keys; first grouped block in AuthLabels)
    ├── title: string
    ├── description: string
    ├── currentPasswordLabel: string
    ├── newPasswordLabel: string
    ├── confirmPasswordLabel: string
    ├── submit: string
    ├── mismatch: string
    ├── success: string                                   (follows the registrationSuccess "…successfully! Redirecting…" pattern)
    └── temporaryPasswordNotice: string
}
```

9 new leaves in `auth`. No parity belt exists for `auth` in the repo (verified by listing `shared/locale/*parity.test.ts` — there is no `auth-namespace.parity.test.ts`), so the compile-time `AuthLabels` typing of both leaf consts is the parity gate and it passes (`bun tsgo` 0). No pin file was created — nothing to keep consistent with.

### 1.3 `errors` namespace

**`shared/locale/types/errors/labels.ts`** (`ErrorsLabels`) + `shared/locale/en/errors/index.ts` (`errorsEn`) + `shared/locale/ar/errors/index.ts` (`errorsAr`) — three NEW top-level flat-string keys appended after `forbiddenRole` (grouped with the governance/login denial keys):

```text
ErrorsLabels
├── passwordChangeRequired: string     ← gate deny (FORBIDDEN + PASSWORD_CHANGE_REQUIRED)
├── currentPasswordInvalid: string     ← ValidationError("CURRENT_PASSWORD_INVALID")
└── newPasswordSameAsCurrent: string   ← ValidationError("NEW_PASSWORD_SAME_AS_CURRENT")
```

3 new leaves in `errors` (REQ-002.5 names them exactly; `ErrorMessageKey` derives automatically — no edit needed). All three are flat sentences with zero ICU placeholders and no identifiers, matching the suite's static-copy discipline.

## 2. Files Modified

| File | Change |
|---|---|
| `shared/locale/types/adminUsers/index.ts` | +`changePasswordAction` (top-level), +`changePasswordDialog` block (8 keys), +`detail.mustChangePasswordLabel`/`detail.mustChangePasswordValue`, +`snackbars.passwordChanged` — with JSDoc in the file's existing style |
| `shared/locale/en/adminUsers/index.ts` | EN values for all 12 new leaves (same block order as the interface) |
| `shared/locale/ar/adminUsers/index.ts` | AR values for all 12 new leaves |
| `shared/locale/types/auth/index.ts` | +`changePassword` block (9 keys) in `AuthLabels` |
| `shared/locale/en/auth/index.ts` | EN values for the 9 new leaves |
| `shared/locale/ar/auth/index.ts` | AR values for the 9 new leaves |
| `shared/locale/types/errors/labels.ts` | +3 top-level keys in `ErrorsLabels` (with denial-code JSDoc) |
| `shared/locale/en/errors/index.ts` | EN values for the 3 keys |
| `shared/locale/ar/errors/index.ts` | AR values for the 3 keys |
| `shared/locale/adminUsers-namespace.parity.test.ts` | +pin: `CHANGE_PASSWORD_DIALOG_LEAF_PATHS` (8) + `CHANGE_PASSWORD_FLAT_PATHS` (4) + describe block (exact leaf-path set on both locales, per-key non-empty resolution, 12-leaf flat-string/no-function-leaf sweep) + header doc item 7 |
| `shared/locale/errors-namespace.parity.test.ts` | +pin: `PASSWORD_SURFACE_KEYS` (3) + describe block (non-empty in both locales, `Object.hasOwn` on both maps, zero-ICU-placeholder sweep) + header doc item 7 |
| `ai/plans/.../outcome/8-outcome.md` | This file |
| `ai/plans/.../tasks.md` | Task 8 checkbox flips only (§5) |
| `worklog.md` | Appended Task 8 record |

**Files NOT modified:** every other file in the repo. No `messages.ts` changes needed (the `adminUsersTranslations`/`authTranslations`/`errorsTranslations` bundle slices already carry the whole namespace consts). No namespace-handle/registry changes (D8 extends existing namespaces; no new `defineNamespace`). No auth parity test created (none exists to extend — see §1.2).

## 3. Verification Results

### 3.1 8.TE — parity belts

- `bun run test/scripts/run-test.ts shared/locale/adminUsers-namespace.parity.test.ts` → **85 pass / 0 fail / 891 expect() calls** (was 68 tests before this task; the +17 are the change-password pin rows). Identical depth-first leaf-path sets EN/AR hold (the primary depth-first walker), zero dead keys, no English fallthrough in AR, and the new pin fails if any of the 12 change-password leaves is dropped from BOTH maps simultaneously.
- `bun run test/scripts/run-test.ts shared/locale/errors-namespace.parity.test.ts` → **58 pass / 0 fail / 430 expect() calls** (was 55 tests; +3 pinned keys). Top-level key sets identical EN/AR; the three new denials pinned with zero placeholders.
- `auth` belt: does not exist in the repo (grep of `shared/locale/*.parity.test.ts`); auth parity is enforced by compile-time `AuthLabels` typing — proven green by `bun tsgo`.
- **No function leaves in `adminUsers`:** all 12 new leaves are flat strings; the walker's `FUNCTION_SLOT_PATHS` stays `[activity.captionCooldownDays, activity.captionCooldownExtended]`; the new pin asserts flatness on the surface explicitly.

### 3.2 8.QL — sub-loop (`--lifecycle duplicates` = tsgo → oxlint → biome → lint → duplicates)

All 11 touched files → **exit 0** (logs `/tmp/subloop-<parent>-<file>.log`):

| File | Exit |
|---|---|
| `shared/locale/types/adminUsers/index.ts` | 0 |
| `shared/locale/en/adminUsers/index.ts` | 0 |
| `shared/locale/ar/adminUsers/index.ts` | 0 |
| `shared/locale/types/auth/index.ts` | 0 |
| `shared/locale/en/auth/index.ts` | 0 |
| `shared/locale/ar/auth/index.ts` | 0 |
| `shared/locale/types/errors/labels.ts` | 0 |
| `shared/locale/en/errors/index.ts` | 0 |
| `shared/locale/ar/errors/index.ts` | 0 |
| `shared/locale/adminUsers-namespace.parity.test.ts` | 0 |
| `shared/locale/errors-namespace.parity.test.ts` | 0 |

### 3.3 `bun tsgo`

Full-repo → **0 "error TS" lines, tool exit 0** (before edits: 0/exit 0 baseline re-verified; after edits: 0/exit 0 — `/tmp/task8-tsgo.txt`). No NEW errors introduced; the Task-1-fix zero-error parity holds.

## 4. Subtask Pipeline Satisfaction

- **8.QL** ✅ — sub-loop `--lifecycle duplicates` exit 0 on all 9 locale files + 2 parity tests (§3.2).
- **8.TE** ✅ — adminUsers + errors parity belts green (§3.1); identical key sets EN/AR (compile-time typing of all six leaf consts against their `*Labels` interfaces + runtime depth-first walker / top-level key-set assertion); no function leaves added to `adminUsers`.
- **8.SEC** ✅ — copy contains no identifiers, emails, ids, or credential-shaped values (only generic chrome copy; the audit-log mention in the dialog subtitle is generic); the three `errors` denials are pure server-denial sentences with zero placeholders, designed to be surfaced by backend consumers via `ctx.t("errorsTranslations")` / `getServerTranslations(locale).errorsTranslations` (Tasks 4/6/7 wire them; the pin enforces they exist on both locales before those tasks run). No secrets read.
- **8.SR** ✅ — namespace handles only: no `Translation.` enum, no `t('key')` calls anywhere in the diff (all six implementations are property-access leaf consts; the tests use dotted-path traversal helpers only on the leaf consts); every import inside `shared/locale/**` uses the `@/shared/...` alias (`@/shared/locale/types/...` in the leaf files); leaf modules contain zero logic (plain object literals only); no new namespace registered.
- **8.IV** ✅ — read in full before editing: root `AGENTS.md`, `shared/AGENTS.md`, `shared/locale/AGENTS.md` (compile-time system, `@/shared/...` alias discipline, leaf modules = no logic, ICU `{var}` interpolation, namespace registration rules); sub-loop printed rule files read. Every rule honored.
- **Semantic-review checklist (protocol rule 3):** tenancy/BOLA — n/a (labels only); race conditions — n/a; enums-as-values — n/a (no enums touched); cross-layer imports — none added (types reference nothing outside `shared/locale`); dead code — none; deferred items — D6 (directory row-level pending-reset chip) untouched: `detail.mustChangePasswordLabel/Value` serve the detail page indicator (REQ-004.3) and are reusable by D6 later.

## 5. tasks.md Checkbox State

Task 8 main line + `8.QL`, `8.TE`, `8.SEC`, `8.SR`, `8.IV` all flipped `[ ]` → `[x]`. No other checkbox touched (Tasks 0-7/9-15 lines left exactly as found).

## 6. Carry-Forward Knowledge — exact keys Tasks 9/10 consume

### Task 9 (admin dialog + mounts)
| Consumer point | Key path |
|---|---|
| Directory kebab item (`DirectoryActionsMenu.tsx`) + detail hero button (`UserHeroActions.tsx`) | `adminUsersEn/adminUsersAr.changePasswordAction` (thread it through the same `labels: Pick<AdminUsersLabels, …>` prop pattern — add `"changePasswordAction"` to the Picks at `DirectoryActionsMenu.tsx:21` and the hero actions) |
| `ChangeUserPasswordDialog.tsx` | `changePasswordDialog.title` / `.subtitle` / `.newPasswordLabel` / `.confirmPasswordLabel` / `.mustChangePasswordLabel` (checkbox) / `.mustChangePasswordHelper` (helper under the checkbox) / `.submit` / `.cancel` |
| Success snackbar after `adminSetUserPassword` | `snackbars.passwordChanged` |
| Detail governance/profile card flag indicator (REQ-004.3) | `detail.mustChangePasswordLabel` (label) + `detail.mustChangePasswordValue` (value shown while the flag is true) |

### Task 10 (`/change-password` page)
| Consumer point | Key path |
|---|---|
| Page heading + description | `authEn/authAr.changePassword.title` / `.description` |
| Form fields | `.currentPasswordLabel` / `.newPasswordLabel` / `.confirmPasswordLabel` |
| Submit button | `.submit` |
| Client-side confirm mismatch error | `.mismatch` |
| Success message before routing to the dashboard | `.success` |
| Notice that a temporary password was issued | `.temporaryPasswordNotice` |

### Tasks 4/6/7 (backend — denial messages)
| Consumer point | Key path (via `ctx.t("errorsTranslations")` / `getServerTranslations(locale).errorsTranslations`) |
|---|---|
| Gate plugin deny (FORBIDDEN + code `PASSWORD_CHANGE_REQUIRED`, REQ-005.1) | `.passwordChangeRequired` |
| `changeMyPassword` current-password verify reject (REQ-006.2) | `.currentPasswordInvalid` |
| `changeMyPassword` no-op change reject (REQ-006.4) | `.newPasswordSameAsCurrent` |

Notes for downstream tasks:
- **REQ-003.2/.3 + REQ-006.3 reuse EXISTING keys** — do NOT mint new ones: `authTranslations.passwordTooShort` / `authTranslations.passwordRequired` (per specs) for length/empty validation.
- The `changePasswordDialog.submit` EN copy is "Set password" (matches the `adminSetUserPassword` mutation semantics); Task 9's stories/field-error mapping can rely on `changePasswordDialog.*` only — no new keys may be minted without extending the pin arrays (`CHANGE_PASSWORD_DIALOG_LEAF_PATHS` / `CHANGE_PASSWORD_FLAT_PATHS`).
- The errors pin block (`PASSWORD_SURFACE_KEYS`) asserts ZERO ICU placeholders on the three denial keys — backend messages that interpolate identifiers are structurally prohibited on this surface.
- `changePasswordDialog` sits between `editDialog` and `deleteConfirm` in all three files (types/en/ar order-mirrored); `detail.mustChangePassword*` sits between `detail.blockedAt` and `detail.memberSince`.

## 7. Cross-File Dependencies

- **Tasks 4/6/7 (backend) depend on this task for the denial strings**: `errorsTranslations.passwordChangeRequired` / `currentPasswordInvalid` / `newPasswordSameAsCurrent` exist on both locales and are pinned — backend code can consume them immediately via property access on `ctx.t("errorsTranslations")` (never `t('key')`).
- **Task 9 depends on `changePasswordAction` + `changePasswordDialog.*` + `snackbars.passwordChanged` + `detail.mustChangePassword*`** — all present on both locales; Task 9 must add the keys to its `Pick<AdminUsersLabels, …>` prop slices.
- **Task 10 depends on `auth.changePassword.*`** — present on both locales.
- No dependency on Tasks 1-7 exists in the other direction: this task compiles standalone (`bun tsgo` 0 with only Tasks 0/1/1-fix/2 landed).
- Parity-suite maintenance: any future key added to `changePasswordDialog` or the change-password flat leaves must be appended to the pin arrays in `adminUsers-namespace.parity.test.ts`, and any new password-surface denial to `PASSWORD_SURFACE_KEYS` in `errors-namespace.parity.test.ts` — otherwise the exact-set pins fail (by design).

## 8. Git / Protocol Notes

- No `git add`/`git commit` performed; no `console.*` added; no plan-artifact references in code comments (JSDoc comments describe the surface only). Expected `git status` after this task: the 11 shared/locale files modified, `tasks.md` modified (Task 8 flips), worklog appended, this outcome file new — plus pre-existing Task 0/1/1-fix/2 artifacts from the parallel stream (untouched).
