# Standing Review Context (for post-implementation review waves)

Branch: feat/no-phone-input-component (worktree /home/z/feat-wt). Baseline: origin/main (5a8369fe).

## Scope — the ONLY files this plan changed (26)
Source (20): shared/lib/phone.ts · shared/locale/{types,en,ar}/{auth,adminUsers,studentOnboarding}/index.ts (9) · backend/services/shared/{index.ts,phone-validation.helpers.ts} · backend/services/auth/registration.service.ts · backend/services/admin/user-management.helpers.ts · frontend/components/ui/PhoneInput.tsx · frontend/views/auth/register/RegisterIdentityFields.tsx · frontend/views/admin/users/dialogs/{CreateUserFormGrid,EditUserFormFields}.tsx · frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx
Tests (6): shared/lib/phone.test.ts · backend/services/shared/phone-validation.helpers.test.ts · backend/services/auth/registration.service.test.ts · backend/services/admin/user-management.helpers.test.ts · test/workflows/auth/registration-phone.journey.test.ts · frontend/graphql/test/auth/auth.test.ts · frontend/stories/ui/PhoneInput.stories.tsx

## Already-found & RESOLVED (do NOT re-report)
1. normalizePhone non-idempotent → FIXED (strip-then-trim, 48/48).
2. Journey-test plan-artifact comments + stale TEST-FIRST narration → FIXED (grep 0).
3. Wire-test adminCreateInput untyped → FIXED (generated AdminCreateUserInput).
4. MAX_PHONE_LENGTH=20 dead constant → REMOVED.
5. helpers/test files didn't pre-exist → CREATED (recorded drift).
6. normalizePhone no production consumer → DISPOSITIONED (plan-mandated API; 📋 deferred D-10).
7. Sub-checkboxes N.QL/TE/SEC/SR/IV remain [ ] → convention (outcome files carry evidence).
8. tests.instructions.md:29 vs test/workflows/AGENTS.md rule 6 contradiction → pre-existing doc drift (📋 D-10).

## Environment constraints (not findings)
- Full-repo tsgo/tsgolint OOM (4.1GB sandbox); scoped-tsgo + negative control = canonical type evidence.
- Pre-existing failures: getStats (seedless test DB), SessionAdminGovernance chaos-race flake.
- .env/.env.test untracked (gitignored); DB_PROVIDER=postgres; kottaby_test.

## Mandated green state
Journey 9/9 · wire 24/24 · phone suites 127/127 · biome 0 · lint-service clean · scoped-tsgo 0 diagnostics.
9. phonePatchError/validateUpdatePatch/buildUpdatePatch JSDoc semantics → FIXED R1 (absent=skip, null=clears SQL NULL, non-empty=validated, empty-string=stored verbatim wire-unreachable); test wording aligned, assertions untouched (28/28).
10. Story Default docblock overstatement → FIXED R1 (name-only mirror).
11. auth.test.ts BFLA denial assertions tightened (denial.errors length 1) → committed R1 (suite 24/24).
12. isValidPhone zero-consumer claim → FALSE POSITIVE (8 hits / 4 surfaces verified).
13. Update-patch wire reachability → FINAL docblock truth: absent=skip; wire ""/whitespace reachable & stored verbatim (gate skipped deliberately); wire null for phone normalized to absent; dateOfBirth null = clear (service layer); edit dialog omits phone key when cleared.
14. Duplication (isValidGender/MIN_PASSWORD_LENGTH/toUserRole) → pre-existing context lines, filtered.
15. Helper-line asymmetry + errorKey-as-discriminator → plan-mandated dispositions (noted for future passes).
16. validateUpdatePatch top-level-message clause → FIXED R3 (first-entry contract, test-pinned).
17. Task 17 (docs/validation/phone-validation.md + outcome/17-* + checkbox) intentionally pending → runs after R10 per SKILL.md sequencing (not a defect; ledgered at deferred-items.md:116).
18. PhoneErrorCode union suggestion → DISPOSITIONED (D2 frozen export surface; runtime guard + tests pin codes; noted as future hardening).
19. Helper-line asymmetry (former item 15 disposition) → RESOLVED by follow-up styling pass: all fields in CreateUserFormGrid / EditUserFormFields / OnboardStudentProfileSection now reserve the helper line (`helperText ?? " "`) matching PhoneInput — uniform row heights, no layout shift on error.
