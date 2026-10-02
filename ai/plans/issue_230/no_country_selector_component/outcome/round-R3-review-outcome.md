# Round R3 Review — backend-services lens

**Plan:** `ai/plans/issue_230/no_country_selector_component/` · **Base:** `5a8369fe` → **Branch:** `feat/no_country_selector_component`
**Reviewer:** R3 (independent, backend/services + db lens) · **Date:** 2026-10-01 · **Mode:** read-only source review

**Method:** per-file `git diff 5a8369fe..feat/no_country_selector_component -- <path>`; all content assertions re-verified race-free via `git show` / `git grep` on the branch commit (initial worktree reads were stale — concurrent agents switch branches in this sandbox; every quoted line below is commit-pinned). `bun tsgo --noEmit` → **0 `error TS`**.

**Files reviewed:** `backend/services/auth/registration.service.ts`, `backend/services/admin/user-management.helpers.ts`, `user-management.mappers.ts`, `backend/db/repo/users/user.repository.ts`, `backend/db/repo/admin/admin-user-query-helpers.ts`, `admin-user-row-types.ts`, `backend/db/schema/users/users.ts` (+ support reads: `shared/lib/country-code.ts`, `shared/constants/countries.ts`, `shared/locale/{en,ar}/auth`, `backend/types/users/{user,registration}.types.ts`, `backend/types/admin/admin-user.types.ts`, `userFieldHelpers.ts`, `admin-user.pothos.ts`, `scalar.pothos.ts`, `user-management.service.ts`, `admin-user.repository.ts`).

---

## Lens checklist verdicts

| # | Check | Verdict | Evidence (branch commit) |
|---|---|---|---|
| 1 | Validation parity registration ↔ admin-create; update patch untouched | ✅ PASS | Registration `registration.service.ts:226-235`: non-string/blank → `COUNTRY_CODE_REQUIRED`/`t.countryCodeRequired`, else `countryCodeSchema.safeParse` fail → `COUNTRY_CODE_INVALID`/`t.countryCodeInvalid`, path `country`. Admin `user-management.helpers.ts:247-257`: identical partition, identical codes, identical typed keys (`tAuth` = same `authTranslations`). `validateUpdatePatch` byte-untouched (free-text `country`, `COUNTRY_INVALID` @ :289-294) — D-4 respected. |
| 2 | Write-path correctness (normalized member + `COUNTRIES[code].en`, guarded lookup, no spread) | ✅ PASS | Registration `createUserRow`: `normalizeCountryCode` → `isValidCountryCode` narrowing → `country: countryCode === null ? null : COUNTRIES[countryCode].en`, `countryCode` persisted; explicit field-by-field insert (BOPLA comment intact, no spread). Admin `buildCreateUserInsert`: `countryCodeSchema.safeParse` → `COUNTRIES[countryCode].en` guarded by null check. `COUNTRIES: Record<CountryCode, {en, ar, flag}>`; `countryCodeSchema` output type is `CountryCode` (normalize→`z.enum(COUNTRY_CODES)` pipe) so both indexes are member-safe. |
| 3 | Race/atomicity | ✅ PASS | Pure validation before single INSERT both paths (`validateInput` → `UserRepository.create` single `tx.insert().returning()`; `user-management.service.ts:324` validate → :331 build → repo). No read-then-write added; no new module-level mutable state (imports only). Password hash still pre-transaction. |
| 4 | Dead code | ✅ PASS (1 informational) | `COUNTRY_TOO_LONG` gone from backend (grep: 0 hits in code). `MAX_COUNTRY_LENGTH` live at `user-management.helpers.ts:303` inside `validateUpdatePatch` — kept, not orphaned. All new imports consumed (`COUNTRIES`, `countryCodeSchema`, `isValidCountryCode`, `normalizeCountryCode`). No unreachable branches (registration null-arm + admin fallback-arm are documented defensive arms). F2 below covers the now-consumer-less `countryRequired` locale key (deliberate). |
| 5 | Layer rules | ✅ PASS | New imports are `@/shared/constants/countries`, `@/shared/lib/country-code` (shared tier — same modules the frontend imports; no cross-layer leak). i18n strictly via `getServerTranslations` typed keys; no literal messages; no `console.*`; `ValidationError` entries envelope (`{field, code, message}`) unchanged. |
| 6 | Repo raw-SQL | ✅ PASS | `user.repository.ts` `findByEmail`/`findById`: `country_code AS "countryCode"` matches `$inferSelect` naming (schema column `countryCode`; `UserSelectType = typeof users.$inferSelect` so it flows automatically); parameterized (`$1` + `[email]`/`[id]`), no interpolation. Transactional arms use Drizzle select (auto-includes new column). Admin detail path is Drizzle (`...SAFE_USER_SELECT` @ `admin-user.repository.ts:321`) → `AdminUserDetailRow.countryCode` populated; `AdminUserDetailReturnType extends AdminUserSafeSelect = Omit<UserSelectType,"passwordHash">` so `assembleDetail`'s new `countryCode` field type-checks. |
| 7 | i18n keys from 4.2, both locales | ✅ PASS | `shared/locale/en/auth/index.ts:29-30` + `shared/locale/ar/auth/index.ts:29-30` define `countryCodeRequired`/`countryCodeInvalid`; typed at `shared/locale/types/auth/index.ts:41-42`; consumed by both services (and pinned by `registration.service.test.ts:671/679`, `user-management.service.test.ts:1172/1212`, frontend tests). |

**Schema:** `users.countryCode = varchar("country_code", { length: 2 })` nullable + docblock; migration `backend/drizzle/20260930202253_add_users_country_code` present; legacy `country varchar(100)` untouched (REQ-8 dual-write, D-2 legacy rows stay null — seeds confirmed not writing `countryCode`). Typecheck clean.

**Pre-existing filter (P1–P5):** P1 (`COUNTRY_TOO_LONG`/`MAX_COUNTRY_LENGTH` reconciliation) is **resolved by this branch** exactly as P1 anticipated — create path on `countryCodeSchema`, update patch retains `MAX_COUNTRY_LENGTH` (no unused constant). P2 (pothos `country` output String) and P3 (broadcasts free-text) confirmed untouched. P4/P5 not in these files' scope. No regression of any P-item observed.

---

## Findings

### F1 — Stale admin-create integration test: fixture + pinned error code no longer reachable (Medium, must-fix)
`frontend/graphql/test/admin/admin-users.integration.test.ts` is **unchanged** by the branch (`git log 5a8369fe..branch -- <file>` empty) but its "admin createUser multi-field rejection → VALIDATION + extensions.fields" test is invalidated by two contract changes this branch makes:
1. **Fixture:** sends `country: ""` (variables in `adminCreateUserMutationDocument` mutation). `AdminCreateUserInput` now spreads `userRegistrationInputFields` where `country: t.field({ type: "CountryCode", required: true })` (`userFieldHelpers.ts:105`) → `graphql-scalars` `CountryCodeResolver` rejects `""` at wire coercion, so the request dies before `validateCreateInput` and `extensions.fields` (asserted at :788-791) is never produced.
2. **Assertion:** `expect(byField.get("country")).toBe("COUNTRY_REQUIRED")` (:792) pins the removed code; backend now emits `COUNTRY_CODE_REQUIRED` (`user-management.helpers.ts:252`).

Not a backend-code defect — the service behavior is correct and correctly covered by `user-management.service.test.ts:1160-1212` — but the suite breaks as-is. **Fix (frontend/test owner):** rework the scenario for the scalar-typed input (e.g., drop `country` for the required-field wire failure, or exercise a curated-out member via the service test only) and re-pin the country code to `COUNTRY_CODE_REQUIRED`.

### F2 — `countryRequired` auth key is now runtime-orphaned in backend (Low, informational — deliberate)
Both former consumers (`t.countryRequired` in registration, `tAuth.countryRequired` in admin create) switched to `countryCodeRequired`; the key remains in `shared/locale/{en,ar}/auth/index.ts:28` + types. Retention is intentional per `frontend/lib/mutationFieldErrors.test.ts:301-312` (`REUSE_SET` — "EXISTING keys only: reuse set for consumer fallback copy", parity-pinned in both locales). No action required; flagged so the final quality gate records it as deliberate, not drift.

---

## Next actions
1. F1 → hand to frontend/test lens (R2) or a fix-up task: update `admin-users.integration.test.ts` fixture + assertion to the `CountryCode`-scalar + `COUNTRY_CODE_REQUIRED` contract.
2. Final quality gate: re-point deferred-items **P1** note at this outcome (P1 resolved); record F2 as deliberate retention alongside the 4.2 outcome.
3. No backend source changes required for R3 scope — all 7 checklist items pass; `bun tsgo` clean.
