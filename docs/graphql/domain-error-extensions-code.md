# DomainError → GraphQLError extensions.code Propagation

> **Superseded by reference (transport surface):** the canonical code↔HTTP-status taxonomy table, legacy alias normalization, masking pipeline, API envelopes, client mapping, and testing-convention matrix now live in [`docs/graphql/error-handling-contract.md`](./error-handling-contract.md). This document remains authoritative for producer-side throw conventions (subclass hierarchy, constructors, resolver/service patterns); do not duplicate its rules here.

## Why

Before this pattern, GraphQL errors were silently swallowed. Services and repositories threw plain `new Error("message")` which Apollo Server converted to `INTERNAL_SERVER_ERROR` with no structured error code. HTTP 400 responses appeared in logs with no resolver executed and no error trace. Clients had no way to distinguish "not found" from "unauthorized" from "validation failed" — every error was an opaque 500 or 400.

The `DomainError` class hierarchy solves this by extending `GraphQLError` with `extensions: { code }`, giving every error a machine-readable `SCREAMING_SNAKE_CASE` code that propagates through Apollo Server to the GraphQL response's `errors[].extensions.code` field.

## Pattern

`DomainError` extends `GraphQLError` and sets `extensions.code` in the constructor. All domain-specific error subclasses inherit this pattern.

```typescript
// backend/lib/errors.ts
import { GraphQLError } from "graphql";

export class DomainError extends GraphQLError {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, { ...options, extensions: { code } });
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

### Subclass Hierarchy

| Class | Code | Constructor |
|-------|------|-------------|
| `NotFoundError` | `${entity}_NOT_FOUND` | `(entity: string, message: string, options?)` |
| `UnauthorizedError` | `UNAUTHORIZED` | `(message: string, options?)` |
| `ForbiddenError` | `FORBIDDEN` | `(message: string, options?)` |
| `ValidationError` | `VALIDATION` or custom | `(codeOrMessage, messageOrOptions?, options?)` — overloaded |
| `ConflictError` | `CONFLICT` | `(message: string, options?)` |
| `QuotaNotFoundError` | `QUOTA_NOT_FOUND` | `(message: string)` — extends `NotFoundError` with entity `"QUOTA"` |
| `QuotaAlreadyDeletedError` | `QUOTA_ALREADY_DELETED` | `(message: string)` |
| `QuotaLedgerError` | `QUOTA_LEDGER_ERROR` | `(message: string)` |

### ValidationError Overloaded Constructor

`ValidationError` supports two call signatures:

```typescript
// (message) → code defaults to "VALIDATION"
throw new ValidationError(tErrors.invalidDuration);

// (code, message) → custom code
throw new ValidationError("RECURRING_CLASS_DAYS_REQUIRED", tErrors.recurringClassDaysRequired);
throw new ValidationError("INVALID_DURATION", tErrors.invalidDuration);
throw new ValidationError("SUBJECT_REQUIRED", tErrors.subjectRequired);
```

### NotFoundError Entity Convention

`NotFoundError` auto-generates the code as `${entity}_NOT_FOUND`. Pass the **entity name** (uppercase), NOT the full code:

```typescript
// ✅ Correct — entity name, code auto-generated as "SUGGESTION_NOT_FOUND"
throw new NotFoundError("SUGGESTION", tErrors.recordNotFound("suggestion"));

// ✅ Correct — "COMPLAINTS_NOT_FOUND"
throw new NotFoundError("COMPLAINTS", tErrors.complaintNotFound);

// ✅ Correct — "STUDENT_NOT_FOUND"
throw new NotFoundError("STUDENT", tErrors.studentNotFound(name));

// ❌ Wrong — passing the full code as entity
throw new NotFoundError("SUGGESTION_NOT_FOUND", message); // → "SUGGESTION_NOT_FOUND_NOT_FOUND"
```

### Domain Code Registry

Flow-specific custom codes are registered here as they ship (the transport taxonomy in
[`error-handling-contract.md`](./error-handling-contract.md) stays category-only — custom
codes never resolve through it, ride the GraphQL error envelope, and clients branch on
`extensions.code` ONLY). Every registry row is bijective with its lowercase-camelCase key
in the compile-time `errors` namespace and carries a dedicated row in
`frontend/providers/apollo/error-link.map.ts`.

| Code | Meaning | Surface | GraphQL / HTTP semantics | i18n key (`errors`) |
|------|---------|---------|--------------------------|---------------------|
| `RUBRIC_SCORE_INVALID` | Score must be a whole number from 0 to 100 | `EvaluationRubricService.submitRubricEvaluation` pre-DB input validation (`backend/services/teachers/evaluation-rubric.service.ts`) | `ValidationError` (custom code); error-envelope pass-through (GraphQL over HTTP 200); non-retryable toast, dialog stays open | `rubricScoreInvalid` |
| `RUBRIC_NOTES_REQUIRED` | Observations are required (1–2000 characters after trim) | same pre-DB pass | `ValidationError` (custom code); same envelope/toast treatment | `rubricNotesRequired` |
| `RUBRIC_WEAKNESS_REQUIRED` | A weakness area is required for a score below 80 | same pre-DB pass (iff-rule, below-threshold arm) | `ValidationError` (custom code); same envelope/toast treatment | `rubricWeaknessRequired` |
| `RUBRIC_WEAKNESS_NOT_ALLOWED` | A weakness area applies only to scores below 80 | same pre-DB pass (iff-rule, at-or-above-threshold arm) | `ValidationError` (custom code); same envelope/toast treatment | `rubricWeaknessNotAllowed` |
| `RUBRIC_WEAKNESS_INVALID` | The weakness area must be Tajweed or Hifz (fail-closed vocabulary) | same pre-DB pass (`isRubricWeaknessArea` guard) | `ValidationError` (custom code); same envelope/toast treatment | `rubricWeaknessInvalid` |
| `RUBRIC_SESSION_NOT_COMPLETED` | This evaluation session is not completed yet | service completion gate (owned session, pre-quorum) | `ConflictError` (custom code); conflict-notice treatment (the `EVALUATION_SESSION_NOT_COMPLETED` sibling row) | `rubricSessionNotCompleted` |
| `APPLICANT_ALREADY_FINALIZED` | The application was already finalized — the verdict exists and cannot be re-issued | quorum finalization: zero-row `finalizeOnCertification` / zero-row `ApplicantRepository.transitionToFailed` (whole transaction rolls back) | `ConflictError` (custom code); conflict-notice treatment (the `EVALUATION_ALREADY_SUBMITTED` sibling row) | `applicantAlreadyFinalized` |

Canonical flow contract: `docs/teachers/evaluation-rubric-scoring.md`. Codes with
established meanings (`SESSION_NOT_FOUND`, `TEACHER_NOT_CERTIFIED`,
`APPLICANT_NOT_IN_EVALUATION`, `EVALUATION_ALREADY_SUBMITTED`) are reused unchanged by
this flow and keep their existing surfaces.

### Usage in Services and Repositories

```typescript
import { NotFoundError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";

// Repository layer — data access errors
if (!suggestion) {
  throw new NotFoundError("SUGGESTION", tErrors.recordNotFound("suggestion"));
}

// Service layer — authorization errors
if (!canViewMetrics) {
  throw new UnauthorizedError(tErrors.unauthorizedViewMetrics);
}

// Service layer — validation errors with custom codes
if (!input.days?.length) {
  throw new ValidationError("RECURRING_CLASS_DAYS_REQUIRED", tErrors.recurringClassDaysRequired);
}
```

### Pothos authScopes → UNAUTHORIZED vs FORBIDDEN

Pothos `authScopes` determines the error code for authorization failures:

- **Unauthenticated** (no session) → `UNAUTHORIZED` — thrown by `scopeAuth` in `gqlSchemaBuilder.ts`
- **Authenticated but unauthorized** (has session, lacks permission) → `FORBIDDEN` — thrown by Pothos `authScopes` check

```typescript
// authScopes: { superAdmin: true } → returns "FORBIDDEN" for authenticated non-superAdmin
// authScopes: { permission: AppPermission.X } → returns "FORBIDDEN" for authenticated users lacking the permission
```

### Testing Error Codes

GraphQL integration tests assert `extensions.code` via `CombinedGraphQLErrors` from Apollo Client v4:

```typescript
import { expectMutationError } from "@/test/helpers";

const { error } = await client.mutate({ mutation: SomeMutationDocument, variables });
// Asserts the error is a `CombinedGraphQLErrors` container carrying
// `extensions.code === "SUGGESTION_NOT_FOUND"` on its first item.
const gqlError = expectMutationError(error, "SUGGESTION_NOT_FOUND");
```

The `expectMutationError(result.error, expectedCode?)` helper lives in `test/helpers/expect-mutation-error.ts`
(re-exported through the `@/test/helpers` barrel), is built atop `CombinedGraphQLErrors.is()` +
`extractErrorCode`, and returns the narrowed container for item-level follow-up assertions.

## Rules

1. **All user-facing GraphQL errors MUST extend `DomainError`** — never throw plain `new Error("message")` in resolvers, services, or repositories. Plain `Error` produces `INTERNAL_SERVER_ERROR` with no structured code.

2. **Error codes MUST be `SCREAMING_SNAKE_CASE`** — e.g., `SUGGESTION_NOT_FOUND`, `UNAUTHORIZED`, `RECURRING_CLASS_DAYS_REQUIRED`.

3. **`NotFoundError(entity, message)`** — `entity` is the entity name (e.g., `"SUGGESTION"`, `"COMPLAINTS"`, `"STUDENT"`), NOT the full code. The code is auto-generated as `${entity}_NOT_FOUND`.

4. **`ValidationError` overloaded constructor** — `(message)` → code `"VALIDATION"`, or `(code, message)` → custom code. Use the custom form when the error needs a specific code (e.g., `"RECURRING_CLASS_DAYS_REQUIRED"`).

5. **Pothos `authScopes`** returns `"FORBIDDEN"` for authenticated-but-unauthorized, `"UNAUTHORIZED"` for unauthenticated. Tests must assert the correct code based on the auth state.

6. **`releaseQuotaIfDeducted`** returns `{ success, warning }` — callers should surface warnings to the GraphQL response, not just log them internally.

7. **`deleteClassInstance`** returns `DeleteClassInstanceResult` with `success` and `warnings` fields (not `Boolean`). The GraphQL mutation type must expose both fields.

8. **Notification dispatch** logs structured `WARN` with `droppedByChannel` (a `Record<string, number>` mapping channel type to dropped count) when notifications are dropped due to missing contact info.

9. **Rate limiting** uses `TEST_ENFORCE_RATE_LIMIT` env flag in dev mode. When set to `1`, rate limits are enforced even in dev (for testing). Without the flag, dev mode bypasses rate limits (backward compatible). Production always enforces.

10. **`bun:test` does NOT support `{ skip: true }`** options object — use the `testMaybe` pattern: `const testMaybe = isFlagEnabled ? test : test.skip;` then call `testMaybe(...)`. If all tests in a file are skipped, add at least one non-skipped test to satisfy `sonarjs/no-empty-test-file`.

## Anti-patterns

### Throwing plain `new Error("message")` in resolvers

```typescript
// ❌ No extensions.code — Apollo returns INTERNAL_SERVER_ERROR
throw new Error(tErrors.complaintNotFound);

// ✅ DomainError subclass — structured code propagates
throw new NotFoundError("COMPLAINTS", tErrors.complaintNotFound);
```

### `try/catch` that swallows GraphQL errors silently

```typescript
// ❌ Swallows 400 responses — test passes but mutation failed
try {
  await authenticatedRequest(cleanupMutation, { id });
} catch {
  // silently ignored
}

// ✅ Assert the result — 400 becomes a loud test failure
const result = await authenticatedRequest(cleanupMutation, { id });
expect(result.cleanupTestEntities).toBe(true);
```

### Returning `Boolean` from mutations that need to surface warnings

```typescript
// ❌ Warnings are lost — caller can't see quota release was skipped
async deleteClassInstance(id: string): Promise<boolean> { ... }

// ✅ Structured result — warnings propagate to GraphQL client
async deleteClassInstance(id: string): Promise<{ success: boolean; warnings: string[] }> { ... }
```

### Using `expect(...).rejects.toThrow()` inside `runInRollback`

```typescript
// ❌ Causes deadlocks inside runInRollback
await expect(repo.findById("nonexistent", tx)).rejects.toThrow();

// ✅ Use try/catch helper pattern
let errorCaught: unknown;
try {
  await repo.findById("nonexistent", tx);
} catch (e) {
  errorCaught = e;
}
expect(errorCaught).toBeInstanceOf(NotFoundError);
expect((errorCaught as NotFoundError).code).toBe("SUGGESTION_NOT_FOUND");
```

### Not asserting cleanup mutation results

Cleanup helpers in test files must assert their results. Unasserted cleanup mutations silently produce 400s that mask real failures.

## Rollout Summary

The following was implemented across the codebase:

- **`backend/lib/errors.ts`** — `DomainError` class hierarchy extending `GraphQLError` with `extensions: { code }`. Subclasses: `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ValidationError` (overloaded), `ConflictError`, `QuotaNotFoundError`, `QuotaAlreadyDeletedError`, `QuotaLedgerError`.

- **All services updated** to throw `DomainError` subclasses instead of plain `Error`:
  - `suggestion.repository.ts` → `NotFoundError("SUGGESTION", ...)`
  - `schedule.service.ts` → `UnauthorizedError(...)` (7 throw sites)
  - `recurring-class.service.ts` → `ValidationError` with custom codes (`RECURRING_CLASS_DAYS_REQUIRED`, `INVALID_DURATION`, `SUBJECT_REQUIRED`)
  - `complaint.service.ts` → `NotFoundError`, `UnauthorizedError`, `ValidationError` (6 replacements)
  - `complaintResponses.service.ts` → `NotFoundError`, `UnauthorizedError`

- **Pothos `authScopes`** configured for proper `UNAUTHORIZED`/`FORBIDDEN` codes. `scopeAuth` throws `UNAUTHORIZED` for unauthenticated; `authScopes` returns `FORBIDDEN` for authenticated-but-unauthorized.

- **`deleteClassInstance`** returns `DeleteClassInstanceResult` with `success` and `warnings` fields. `releaseQuotaIfDeducted` returns `{ success, warning }` — warnings surface to the GraphQL response.

- **Notification dispatch** logs structured `WARN` with `droppedByChannel` map when contactless payloads are dropped. `UserDispatchOutcome` includes `skippedContactless` per-user and `skippedContactlessByChannel` aggregated.

- **Rate limit test-enforceable bypass** via `TEST_ENFORCE_RATE_LIMIT` env flag in `backend/lib/ratelimit.ts`. Dev mode bypasses unless flag is set; production always enforces.

- **GraphQL integration tests** for all error paths — `expectMutationError` helper upgraded with optional `expectedCode` parameter using `CombinedGraphQLErrors.is()` pattern.

- **Test helper cleanup assertions** — `cleanupTestEntities` and `cleanupTestSuperAdmin` now assert `result === true`, converting silent 400s into loud test failures.

## Related Documents

- [Pothos Field Factories](./pothos-field-factories.md) — shared field helper extraction patterns
- [Service Base Pattern](../backend/service-base-pattern.md) — service base class, shared resolvers, auth session helpers
- [Types Consolidation](../backend/types-consolidation.md) — moving `.types.ts` to `backend/types/`, split rules
- [Import/Export Conventions](../architecture/import-export-conventions.md) — barrel file conventions, `export *` rules
- [Linting Rules](../quality/linting-rules.md) — Oxlint & ESLint/sonarjs fix recipes
