# Task 10 Outcome — `/change-password` top-level page + form/hook + shared auth document

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `10. /change-password page + form/hook (D7, REQ-005, REQ-006)` (Phase 4 — frontend)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project` (plan docs cite `/home/ahmed/Projects/kottaby_kottaby/`; paths resolve 1:1)
> **Result:** 1 shared mutation document added (codegen green), NEW top-level page + NEW form view + NEW hook (+ barrel), dev-server DOM smoke green (guard redirect + render + 3 client-validation branches + a REAL server `CURRENT_PASSWORD_INVALID` round-trip projected inline), auth wire suite **14 pass / 0 fail / 48 expect()**, sub-loop `--lifecycle duplicates` **exit 0 on 5/5 files**, full-repo `bun tsgo` **0 errors / exit 0**. `navItems.ts` and the profile `ChangePasswordCard` byte-unchanged. No commits made.

## 1. What Was Implemented

### 1.1 Shared document (`frontend/graphql/sharedDocuments/auth/auth.documents.ts`, MODIFIED)

`changeMyPasswordMutationDocument` added immediately after the byte-untouched `updateMyLocaleMutationDocument` (the mutation's backend home is beside `updateMyLocale`, so the document mirrors that placement), exactly the plan §4.2 shape:

```typescript
export const changeMyPasswordMutationDocument: TypedDocumentNode<
  ChangeMyPasswordMutation,
  ChangeMyPasswordMutationVariables
> = gql`
  mutation ChangeMyPassword($input: ChangeMyPasswordInput!) {
    changeMyPassword(input: $input) {
      id
      email
      fullName
      role
      mustChangePassword
    }
  }
`;
```

Style matches the file's existing documents (`gql` + `type TypedDocumentNode` from `@apollo/client`, generated types imported as type-only from `@/frontend/graphql/generated/gql/graphql`, `id` FIRST for Apollo cache normalization per `sharedDocuments/AGENTS.md`, JSDoc in the file's voice). The auth barrel (`frontend/graphql/sharedDocuments/auth/index.ts`) re-exports via `export *` — **zero barrel edits**.

### 1.2 Codegen (generated artifacts via the commands ONLY)

```
bun run generate:gqlSchema → wrote frontend/graphql/generated/schema.graphql (62395 bytes — deterministic re-emission, SDL unchanged since Task 6)
bun codegen               → ✔ Generate to ./frontend/graphql/generated/gql/graphql.ts
```

`ChangeMyPasswordMutation` / `ChangeMyPasswordMutationVariables` now generate exactly as Task 6's carry-forward predicted (`variables: { input: { currentPassword: string; newPassword: string } }` — both REQUIRED, no optional members). Generated files never hand-edited.

### 1.3 Page (`app/change-password/page.tsx`, NEW — TOP-LEVEL, outside `(dashboard)`)

Mirrors the `app/(dashboard)/admin/users/page.tsx` page-guard shape (async Server Component + `generateMetadata` from the cookie locale):

- `await withPageAuth({ allowMustChangePassword: true, redirectTo: "/change-password" })` — **the only sanctioned `allowMustChangePassword: true` site** (REQ-005.3): any authenticated role passes (no role whitelist — a flagged user must act here regardless of role; un-flagged users may change voluntarily), and the exemption keeps the page out of its own SSR fence (loop prevention). `redirectTo: "/change-password"` returns anonymous visitors here after login.
- Metadata title from `getTranslations(locale).authTranslations.changePassword.title` (the login page's `authTranslations` precedent).
- Renders `<ChangePasswordForm />` label-free — the form resolves its own `Auth` namespace client-side, mirroring the login/register pages.

### 1.4 Hook (`frontend/views/auth/change-password/useChangePasswordForm.ts`, NEW)

The auth-views pattern separates hook from view (`useLoginForm.ts` beside `LoginForm.tsx`), so the mutation hook lives beside the form ("use client"; returns plain state, no JSX):

- `useMutation(changeMyPasswordMutationDocument)` imported from `@apollo/client/react`; document deep-imported from `@/frontend/graphql/sharedDocuments/auth/auth.documents` (the `useRegisterSubmit.ts` auth-view precedent).
- **Client validation BEFORE the round-trip** (same policy the server enforces): current required (`t.passwordRequired`), new required + `< 8` chars (`t.passwordTooShort`; local `MIN_CREDENTIAL_LENGTH = 8` — the `ChangeUserPasswordDialog` Task-9 precedent), confirm mismatch (`t.changePassword.mismatch`).
- **Server denials via the shared Apollo error-mapping seam** (`frontend/lib/graphql-error-utils.ts`): `extractFieldErrors(err)` reads the pre-localized `extensions.fields[]` payload; a module-level pure `projectServerFieldErrors` renames server field keys onto the form's input names — `currentPassword` → current field (`CURRENT_PASSWORD_INVALID`), `newPassword` → new field (`NEW_PASSWORD_SAME_AS_CURRENT`), and the shared policy's `password`-tagged length/empty denials → the NEW-password field (verified against `AuthService.changeMyPassword`'s `validatePasswordPolicy` field naming). Field-less denials fall back to `extractErrorMessage` into the top-level Alert (an expired session additionally trips the existing global error-link redirect). **Zero bespoke toast plumbing; no listener registration** (the `GraphQLErrorSurfaceHost` seam stays untouched).
- **Success path:** clears errors, sets `succeeded` (renders `auth.changePassword.success`), then after `REDIRECT_DELAY_MS = 1500` (the `useRegisterSubmit` success-beat precedent) `router.replace(roleDashboardPath(user?.role))` — `replace` keeps the forced gate out of the history stack, and `roleDashboardPath` (`frontend/lib/auth/roleDashboardRoute.ts`) never targets the loop-prone bare `/dashboard`; the role comes from the auth context hook the login flow uses (`useAuth()`).
- Submit disabled while pending or succeeded (`AuthSubmitButton disabled` + early return) — no double-submit during the redirect beat.

### 1.5 View (`frontend/views/auth/change-password/ChangePasswordForm.tsx` + `index.ts`, NEW)

Small centered form (self-contained `Box component="main"` centering shell — deliberately NOT the `(auth)` layout, whose authenticated-bounce effect would fight the forced gate):

- Reuses the shared auth building blocks verbatim: `AuthFormHeader` (`LockResetOutlined` icon + `changePassword.title`/`.description`), `PasswordField` ×3 (current `autoComplete="current-password"`, new/confirm `"new-password"`, each with its own localized show/hide toggle), `AuthSubmitButton` — the exact trio `LoginForm` renders.
- Persistent info `Alert` with `auth.changePassword.temporaryPasswordNotice` (the flagged user's context) above the form; error/success `Alert`s inline below the fields.
- Client + server field errors merge per field at render (`validationErrors.x ?? fieldErrors.x`) into `error`/`helperText`/`aria-invalid` (the AGENTS.md accessibility pattern).
- Labels ONLY via the `Auth` namespace handle through the hook's `useAppTranslation(Auth)` — no `Translation.` enum, no `t('key')`.
- MUI v9 sx discipline (layout/colors only in `sx`, CSS-var palette access like the auth shared components), `*Outlined` icons, no `console.*`.

### 1.6 Dev-server smoke (agent-browser, DOM-first) — what was proven and how

`bun run dev` on port 3000 (stopped cleanly afterwards; browser sessions closed):

| Check | Result |
|---|---|
| Anonymous guard (curl) | `GET /change-password` → **307 → `/login?redirect=%2Fchange-password`** (the SSR fence hands off to login with a return path) |
| Anonymous guard (browser) | fresh session → login page renders fully (AR locale), URL confirmed `/login?redirect=%2Fchange-password`, no crash/white screen |
| Authenticated render | admin session injected via `scripts/browser-login.ts` (`AGENT_BROWSER_SESSION=… --inject`; credentials never enter agent context) → `/change-password` renders: heading, description, temporaryPasswordNotice alert, 3 labeled fields with toggles, submit — all AR-localized |
| Client validation branches | submit with empty current + `abc` new + `xyz` confirm → inline helper texts: password-required (current), at-least-8 (new), mismatch (confirm) — no round-trip |
| Server denial on the real wire | current = a WRONG password, new/confirm valid → `CURRENT_PASSWORD_INVALID` field error projected inline under the current-password field, AR-localized ("كلمة المرور الحالية غير صحيحة."), no form-level alert, no console errors — a genuine page→form→hook→`changeMyPassword`→service round-trip on the denial path (zero writes; the injected account's credential was untouched by construction) |
| Screenshots | `scratch/screenshots/task10-change-password-authenticated.png`, `task10-change-password-client-validation.png`, `task10-change-password-server-denial.png`, `task10-anonymous-login-redirect.png` |

**Honestly NOT exercised in the browser:** the full flagged-user journey (admin sets a temp password WITH the flag → flagged login → dashboard nav redirects to `/change-password` → successful submit → dashboard hand-off). Two reasons: (a) exercising it requires a flagged login, i.e. mutating a real dev-DB account's credential + flag from the browser session — Task 11's journey owns exactly that shared-state transition against tracked fixtures with cleanup; (b) the success leg would rotate the injected account's password. Compensating coverage, per the task brief: the flagged-gate SSR fence is unit-locked (`withPageAuth.test.ts`, Task 7) and was proven live here (the 307 + the page rendering under the exemption), the success leg (flag cleared, new hash verifies) is wire-proven (`auth.test.ts` — Task 6: `mustChangePassword: false` echo, old credential denied / new authorizes) and service-tested (Task 4), and the deny-then-inline mapping was proven live end-to-end on this page. Smoke observation (not a defect): the very first clicks landed before React finished hydrating (dev-mode first-compile latency); after hydration the identical interactions worked — recorded here so the human reviewer isn't surprised.

## 2. Files Created / Modified / NOT Modified

**Created (3):**

| File | Content |
|---|---|
| `app/change-password/page.tsx` | Top-level guarded page (`allowMustChangePassword: true` + `redirectTo`) |
| `frontend/views/auth/change-password/useChangePasswordForm.ts` | Validation + mutation + error-seam + success-routing hook |
| `frontend/views/auth/change-password/ChangePasswordForm.tsx` + `index.ts` | Centered form view + barrel (2 files; counted as 3 new modules + barrel) |

**Modified (2):**

| File | Change |
|---|---|
| `frontend/graphql/sharedDocuments/auth/auth.documents.ts` | +`ChangeMyPasswordMutation(Variables)` type imports; +`changeMyPasswordMutationDocument` (§4.2 shape) with JSDoc. All existing documents byte-identical. |
| `frontend/graphql/generated/gql/graphql.ts` | Regenerated by `bun codegen` (both steps exit 0) — `ChangeMyPasswordMutation`/`Variables` now emitted; machine-touched only |

**Process artifacts:** `outcome/10-outcome.md` (this file), tasks.md Task 10 flips, worklog append.

**Deliberately NOT modified (and why):**

- `frontend/views/dashboard/nav/navItems.ts` — **byte-unchanged** (`git diff` empty; REQ-011.6 / 10.SR — `/change-password` is a forced gate reached by redirect, never a nav item).
- `frontend/views/dashboard/profile/cards/ChangePasswordCard.tsx` — untouched (D4 deferral; REQ-011.3).
- `frontend/views/dashboard/layout/DashboardLayout.tsx` — the client mirror (D6c) is already shipped (Task 7) and reads the flag STRUCTURALLY; it stays inert until the `me`/`login` selections add `mustChangePassword` (carry-forward §5).
- `auth.documents.ts`'s `me`/`login` selections — NOT in this task's file boundary and not required by it (the form's role comes from the existing `me` selection via `useAuth()`); the flag-selection ripple is documented as carry-forward, not smuggled in.
- `frontend/graphql/test/auth/auth.test.ts` — outside this task's boundary; its local probe document still passes green (14/0/48). Swapping it for the shared document (single-source discipline, the Task-9 admin-suite precedent) is left as a carry-forward note.
- `shared/locale/**` — Task 8 already shipped every key consumed (`changePassword.*` ×9, `passwordRequired`, `passwordTooShort`); zero keys minted, zero pin edits.
- No `app/api/**` routes; no new barrels beyond the consumed view barrel; no generated-file hand edits.

## 3. Verification Results

### 3.1 10.QL — sub-loop `--lifecycle duplicates` (tsgo → oxlint → biome → lint → check:duplicates)

| File | Exit | Log |
|---|---|---|
| `frontend/graphql/sharedDocuments/auth/auth.documents.ts` | **0** (5/5 stages) | `/tmp/subloop-t10-docs.log` |
| `app/change-password/page.tsx` | **0** | `/tmp/subloop-t10-page.log` |
| `frontend/views/auth/change-password/useChangePasswordForm.ts` | **0** | `/tmp/subloop-t10-hook.log` |
| `frontend/views/auth/change-password/ChangePasswordForm.tsx` | **0** | `/tmp/subloop-t10-view.log` |
| `frontend/views/auth/change-password/index.ts` | **0** | `/tmp/subloop-t10-index.log` |

(Generated `graphql.ts` excluded from lint scope by the toolchain's ignore patterns — the Task-5/6/9 convention; machine-touched only by the two codegen commands.)

### 3.2 10.TE — tests + smoke

- `bun run test/scripts/run-test.ts frontend/graphql/test/auth/auth.test.ts` → **14 pass / 0 fail / 48 expect()** (green first-run this pass; the recurring orphaned-`next-server`-on-3066 + stale-lock environment trap was pre-empted by killing the orphan and removing `.next-test-dev/dev/lock` BEFORE the run — same incident as Tasks 6/9, zero code relation).
- `bun tsgo` (full repo) → **0 "error TS" lines, exit 0** — zero NEW errors vs the Task-0 baseline.
- Validation branches: mismatch / too-short / required proven in the live DOM (§1.6); wrong-current server denial proven live on the wire through the page's own mutation path. Flagged-happy-path browser limitation documented honestly (§1.6) with its compensating wire/service/unit coverage.

### 3.3 Boundary sweep

- `git diff --stat -- frontend/views/dashboard/nav/navItems.ts frontend/views/dashboard/profile/cards/ChangePasswordCard.tsx` → **empty** (both byte-unchanged).
- `rg "console\."` on all 5 touched/created files → **0 matches**; no plan-artifact references (`D7`, `REQ-…`, `Task 10`, `tasks.md`, `plan.md`) in any code comment (JSDoc describes surfaces only).

## 4. Subtask Pipeline

- **10.QL** ✅ — §3.1: 5/5 files exit 0 (all five stages each).
- **10.TE** ✅ — §3.2: client branches (mismatch, too-short, required) + wrong-current server denial covered, the last proven live end-to-end in the browser; success leg carried by the wire/service suites; flagged-flow browser limitation documented (§1.6).
- **10.SEC** ✅ — page is authenticated (anonymous → 307 login, proven); `allowMustChangePassword: true` appears in EXACTLY ONE file (`app/change-password/page.tsx` — grep-swept); the mutation takes no identity argument and the response is the password-stripped User (`RegistrationReturnType` projection — no `passwordHash` anywhere; deep-walked by the Task-6 wire suite); passwords never logged; client error surfacing is the shared seam only.
- **10.SR** ✅ — page is TOP-LEVEL (outside `(dashboard)`; no loop with the SSR fence, the client mirror, or the login redirect); `navItems.ts` byte-unchanged; no `console.*`; MUI v9 sx discipline, `*Outlined` icons, theme/CSS-var colors; mutation hook from `@apollo/client/react`; deep document import; no member-local type definitions; success routing via `roleDashboardPath` (never bare `/dashboard`).
- **10.IV** ✅ — read in full BEFORE editing: `app/AGENTS.md`, `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md`, root `AGENTS.md`, `.agents/instructions/frontend.instructions.md` (sub-loop re-printed the same set). Honored rules of note: Server Component page with no hooks/browser APIs; client i18n via `useAppTranslation(Auth)`; server metadata via `getTranslations(locale)` property-chain; hooks from `@apollo/client/react` + `gql`/`TypedDocumentNode` from `@apollo/client`; `React.SubmitEvent` (never `FormEvent`); `aria-invalid` on error fields; no nested ternaries; no `useLazyQuery`; no oxlint-disable comments.
- **Semantic-review checklist (protocol rule 3):** tenancy/BOLA — the form sends no identity; the server derives it from the verified context. Race conditions — none introduced client-side; the double-submit window is closed by `loading`/`succeeded` disabling + early return; the server serializes the verify-then-write. Enums-as-values — none touched. Cross-layer imports — the page imports the backend-backed `withPageAuth` (the established app→frontend-lib seam the admin page already uses); the view imports the shared document barrel file + error utils only. Dead code — none. Deferred items — D4 (profile `ChangePasswordCard`) untouched as mandated.

## 5. tasks.md Checkbox State

Task 10 main line + `10.QL` + `10.TE` + `10.SEC` + `10.SR` + `10.IV` flipped `[ ]` → `[x]`. No other checkbox touched (Tasks 0–9 stay as found; Tasks 11–15 remain `[ ]`).

## 6. Carry-Forward Knowledge (for Tasks 11/13/14)

- **Route-path literals must stay equal in three places:** the physical route `app/change-password/page.tsx` (outside `(dashboard)`), the SSR constant `CHANGE_PASSWORD_PAGE_PATH` (`frontend/lib/auth/withPageAuth.ts:74`), and the client mirror `CHANGE_PASSWORD_ROUTE` (`DashboardLayout.tsx`) — the server-only module cannot be imported client-side, hence the documented mirror.
- **`me`/`login` document ripple (unowned so far):** `DashboardLayout.hasForcedPasswordResetFlag` reads the session user STRUCTURALLY and stays inert until the shared `me`/`login` selections add `mustChangePassword` (then re-run BOTH codegen steps; zero layout changes). The mutation document added here does NOT activate it. Whichever task takes the ripple must also keep `AuthUser = NonNullable<MeQuery["me"]>` consumers type-green.
- **Auth wire-suite probe swap (optional, pre-Task-14):** `frontend/graphql/test/auth/auth.test.ts` still uses its locally `parse`d probe document (Task 6's documented swappable design). The shared `changeMyPasswordMutationDocument` now exists and compiles; the swap is the Task-9 admin-suite precedent (`local parse` block deleted, shared import). This task left the test byte-untouched (outside the declared file boundary) — it is green either way.
- **Success-hand-off contract:** the page shows `auth.changePassword.success` for ~1.5s then `router.replace(roleDashboardPath(user?.role))` — the dashboard handed to is role-specific and NEVER bare `/dashboard` (preview-gateway loop). If Task 11's journey or Task 13 stories need the flow, the state seam is `useChangePasswordForm()` (`succeeded`, `validationErrors`, `fieldErrors`, `formError`, `loading`, `handleSubmit`).
- **Server field-name mapping is load-bearing:** the shared password policy tags length/empty denials with field `password`, while `CURRENT_PASSWORD_INVALID` uses `currentPassword` and `NEW_PASSWORD_SAME_AS_CURRENT` uses `newPassword` — the hook's `projectServerFieldErrors` folds `password` → the new-password input. Any future consumer of `changeMyPassword` field errors must repeat that fold.
- **Browser-smoke mechanics that worked:** `scripts/browser-login.ts --inject` into a NAMED agent-browser session (credentials stay out of agent context); a WRONG-current-password submit is a safe live test of the deny path (zero writes by construction); first-click-before-hydration on a cold dev compile is a false negative — re-verify after hydration before diagnosing.
- Shared-worktree note: `git status` also carries the pre-existing Task 0–9 artifacts and the baseline `Caddyfile` edit; this task's own diff is exactly the 3 new view files + 1 new page + the documents file + the regenerated `graphql.ts` + plan-dir/worklog writes listed in §2.
