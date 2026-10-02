# Post-Implementation Review — Round R2

Independent reviewers (fresh context): lens A types+backend, lens B frontend, lens C pentester. Catalog: review-context.md (items 1-11 excluded).

## Findings & dispositions
| # | Sev | Where | Finding | Disposition |
|---|---|---|---|---|
| 1 | MEDIUM→FALSE POSITIVE | shared/lib/phone.ts:42 | "isValidPhone has zero production consumers" | **REBUTTED with evidence**: `rg -c isValidPhone` → 8 hits, 2 per file × 4 surfaces (RegisterIdentityFields:2, CreateUserFormGrid:2, EditUserFormFields:2, OnboardStudentProfileSection:2). Reviewer cwd error. No action. |
| 2 | LOW | user-management.helpers.ts:287-288 | docblock clause "input whitelist types them as string?" false for dateOfBirth (string\|null, null signals clear) | FIXED R2-fix (scoped clause; noted resolver `?? undefined` mapping) |
| 3 | LOW | user-management.helpers.ts:193,32,351 | duplication isValidGender/MIN_PASSWORD_LENGTH/toUserRole vs registration.service | **FILTERED pre-existing**: git diff proves these are context lines (only MAX_PHONE_LENGTH removal is ours) |
| 4 | LOW | PhoneInput.stories.tsx:11-13 | header docblock still overstates RHF coverage | FIXED R2-fix |
| 5 | LOW | PhoneInput.tsx:103 + admin grids | helper-line reservation one-sided (phone row taller) | DISPOSITIONED: D4 mandates component reservation; non-phone fields pre-existing pattern; future UI-consistency pass (noted for #230) |
| 6 | LOW | OnboardStudentProfileSection.tsx:126 | errorKey doubles as input-kind discriminator | DISPOSITIONED: exact keying mandated by plan Task 13; latent fragility noted |
| 7 | LOW | user-management.helpers.ts:268-297 | rewritten docblock inverted wire reachability ("" reachable+stored verbatim; null normalized to absent) | FIXED R2-fix (docblocks + test header sentence corrected; zero behavior change) |
| — | — | EditUserFormFields.tsx:50-55 | empty-phone payload traced: dialog OMITS phone key when cleared (`form.phone || undefined` at EditUserDialog.tsx:83) → server leaves column untouched | Comment corrected to actual behavior (R2-fix; flagged deviation, revertible) |

## Pentest probes (re-derived): BOLA/IDOR ✅ BFLA ✅ ReDoS ✅ injection/echo ✅ BOPLA ✅ (doc understatement fixed) oracle ✅ secrets ✅ authz-independence ✅

## Totals
New: 3 fixed (items 2,4,7 + comment), 1 false positive, 2 filtered pre-existing, 2 dispositioned plan-mandated. Carried into R3: none blocking.
