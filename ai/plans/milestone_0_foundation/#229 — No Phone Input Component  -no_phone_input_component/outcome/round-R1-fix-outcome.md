# Round R1 fix — comment accuracy only (Task: R1-fix)

Plan dir: ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component

## Finding 1 [MEDIUM] — update-patch phone semantics misstated in JSDoc
- Where: backend/services/admin/user-management.helpers.ts (phonePatchError + validateUpdatePatch docblocks); wording aligned in user-management.helpers.test.ts.
- Was: doc claimed absent/undefined/null all leave the stored phone alone and that an empty/whitespace string clears it.
- Actual (re-verified): buildUpdatePatch copies every non-undefined member verbatim and the repo updateProfileFields applies .set({...patch}) — absent key = column untouched; explicit null = SQL NULL = clears the stored phone; non-empty string = E.164-validated then stored verbatim; empty/whitespace string = stored verbatim (NOT cleared) and currently unreachable from the wire (GraphQL input non-nullable + input.phone ?? undefined at admin-users.mutation.ts:114, which buildUpdatePatch drops).
- Fix: rewrote both docblocks into one consistent contract; extended buildUpdatePatch doc (null copied verbatim → SQL NULL). Test header + 4 test titles + 1 inline comment reworded only — all assertions untouched (the empty-string DB test still asserts toBe("")).
- Verification: sub-loop duplicates exit 0 (helpers + stories); helpers suite 28/28 pass, 0 fail; rg "REQ-[0-9]|tasks.md|plan" → 0 matches in both edited files.

## Finding 2 [LOW] — PhoneInput Default story docblock overclaims RHF wiring
- Where: frontend/stories/ui/PhoneInput.stories.tsx (~line 38).
- Was: claimed the story is wired the way the register form spreads {...register("phone")} including handlers/ref.
- Actual: args carry only name/label/fullWidth/startAdornment.
- Fix: docblock now states it mirrors the name-only member of the RHF spread; change/blur handlers and ref cannot be expressed as Storybook args. No handlers added.

## Proof of comment-only changes
- Edits touched only /** */ docblocks, one // comment, and test title strings. No executable statements, args, signatures, or assertions changed.
