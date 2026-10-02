# R3-fix — `validateUpdatePatch` docblock clause correction

Plan: `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component`
Branch: `feat/no-phone-input-component` · File: `backend/services/admin/user-management.helpers.ts` (~:311) · Comment-only change.

## Clause diff (before/after)

**Before:**

```
 * top-level message stays the canonical `tErrors.validation` string while the
 * `fields` payload identifies the offending fields for inline helperText
 * projection (same contract as `validateCreateInput` above).
```

**After:**

```
 * top-level message is the FIRST entry's message (so a phone-only
 * PHONE_INVALID failure throws `authTranslations.phoneInvalid`, not
 * `errors.validation`) while the `fields` payload identifies the offending
 * fields for inline helperText projection.
```

Rationale: the thrown `ValidationError`'s top-level message is `entries[0].message` — the FIRST entry's message — as pinned by `user-management.helpers.test.ts:226,610` (e.g. phone-only PHONE_INVALID → `authTranslations.phoneInvalid`). The false "same as `validateCreateInput`" comparison was dropped; that sibling's docblock already documents first-entry semantics. Nothing else touched; no plan artifacts in comments.

## Verification

1. `bun run scripts/health/sub-loop.ts backend/services/admin/user-management.helpers.ts --lifecycle duplicates` → ✅ all checks passed (tsgo, oxlint, biome:check, lint:type-aware, check:duplicates), exit 0.
2. `bun run test/scripts/run-test.ts backend/services/admin/user-management.helpers.test.ts` → ✅ 28 pass / 0 fail (168 expect() calls), exit 0.

No git writes performed.
