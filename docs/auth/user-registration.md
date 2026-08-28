# User Registration — Canonical Reference

**Domain:** Auth / Identity provisioning
**Specs:** `docs/specs/functional-requirements.md`
**Status:** Implemented and verified

This document is the single canonical reference for how the Kottaby / Draft Academy backend creates a new user identity. It consolidates the role→child mapping, the handshake-generation algorithm, the atomicity transaction pattern, the BOPLA/BFLA defenses, and the 23505→ConflictError translation rule. All layers (types, repos, service, GraphQL, frontend) MUST conform to the contracts described here.

---

## 1. Role → Child Table Mapping

When `RegistrationService.registerUser(input, locale, tx?)` runs, the `users` row is always inserted first; the role-specific child row is inserted **inside the same transaction**. The mapping is exhaustive — every `users.role` value has exactly one corresponding child table.

| `role` (public) | `users.role` enum value | Child table | Child-row contents | Public mutation? |
|---|---|---|---|---|
| `student` | `student` | `students` | `balance_hifz=0`, `balance_tajweed=0`, `balance_reviews=0`, `balance_trial=0` (default 0, granted once via the trial provisioning service), `trial_granted_at=NULL`, `parent_id=NULL`, server-generated `handshake_code` | ✓ `registerUser` |
| `teacher` | `teacher` | **`applicants`** (NOT `teacher`) | `status='pending'`, `verification_attempts=0`, `last_attempt_at=NULL`, `cooldown_until=NULL` | ✓ `registerUser` |
| `parent` | `parent` | `parents` | (PK only; extension columns added by later flows) | ✓ `registerUser` |
| `admin` | `admin` | `admin` | (PK only) | ✗ — service-only via `RegistrationService.createAdminUser` |

> **Teacher applicant flow:** A user registering as `teacher` receives an `applicants` row with `status='pending'` and **NO `teacher` row**. The `teacher` row is created only after the teacher verification pipeline approves the applicant. Granting teacher privileges before evaluation would compromise platform quality.
>
> **Applicant lifecycle (post-registration):** the `applicants` state machine, cooldown/attempt contracts, the `myApplicantProfile` query contract, and downstream consumer obligations are canonically documented in `docs/teachers/applicant-lifecycle.md`.

All child tables share the user's primary key (`child.id = users.id`, `ON DELETE CASCADE`).

---

## 2. Handshake Generation

Every `student` registration generates a unique `handshake_code` so a parent can later link to the student. The parent-link *consumption* workflow is out of scope here; this document covers only code generation.

### 2.1 Format

```
KSB-<8 uppercase alphanumeric chars>
```

The 8-char suffix is derived from `crypto.randomUUID()`:

```ts
function generateHandshakeCode(): string {
  const hex = randomUUID().replace(/-/g, "").toUpperCase();
  return `KSB-${hex.slice(0, 8)}`;
}
```

- The `varchar(50)` column constraint gives comfortable headroom (the code is 12 chars).
- Entropy: 16^8 ≈ 4.3 billion possible codes — collision probability is negligible at registration-scale load.

### 2.2 Bounded in-transaction retry

`StudentRepository.createForRegistration(userId, handshakeCode, tx)` inserts the `students` row. If the `handshake_code` unique constraint fires (`23505`), the service regenerates and retries **inside the same transaction**:

```ts
for (let attempt = 1; attempt <= HANDSHAKE_RETRY_LIMIT; attempt++) {
  const handshakeCode = generateHandshakeCode();
  try {
    await StudentRepository.createForRegistration(userId, handshakeCode, tx);
    return;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error; // non-collision — surface
    logger.logDomainError("Handshake code collision during registration", {
      code: "HANDSHAKE_COLLISION", entity: "students",
      entityId: userId, attempt: String(attempt),
    });
  }
}
throw new ConflictError("Handshake code generation failed after retries", { cause: lastError });
```

- **`HANDSHAKE_RETRY_LIMIT = 5`** (sufficient given the 4.3B-code space).
- On exhaustion, throws `ConflictError` and logs via `logger.logDomainError` — **never `console.*`**.
- Non-collision errors are surfaced immediately (the outer `translateDbError` decides whether it's a 23505 on email or another failure).

---

## 3. Atomicity Transaction Pattern

All registration writes occur inside a **single `db.transaction`**. Atomicity is non-negotiable — partial accounts corrupt every downstream state machine.

### 3.1 Production path

```ts
return await db.transaction(async tx => {
  const created = await createUserRow(input, passwordHash, tx);
  await createRoleChild(created.id, input.role, tx);
  return toReturnType(created);
});
```

- `createUserRow` calls `UserRepository.create(insert, tx)`.
- `createRoleChild` dispatches by role to `StudentRepository.createForRegistration` / `ApplicantRepository.create` / `ParentRepository.createForRegistration`.
- If **any** insert fails, the entire transaction rolls back — zero residual rows.

### 3.2 Test path (SAVEPOINT isolation)

`RegistrationService.registerUser(input, locale, outerTx?)` accepts an optional `outerTx`. When provided (by `runInRollback` in tests), the service opens a **SAVEPOINT** on the outer transaction instead of a new top-level transaction:

```ts
async function withTransaction<T>(outerTx, fn) {
  if (outerTx) return outerTx.transaction(fn); // SAVEPOINT
  return db.transaction(fn);                   // top-level
}
```

This enables `runInRollback` isolation for service-level tests without leaking committed data.

### 3.3 Repository contract

Every registration repo method takes `tx: DBTransaction` as its **last** parameter:

| Repo | Method signature |
|---|---|
| `UserRepository` | `create(insert: UserInsertType, tx: DBTransaction)` |
| `StudentRepository` | `createForRegistration(userId: number, handshakeCode: string, tx: DBTransaction)` |
| `ApplicantRepository` | `create(userId: number, tx: DBTransaction)` |
| `ParentRepository` | `createForRegistration(userId: number, tx: DBTransaction)` |
| `AdminRepository` | `create(userId: number, tx: DBTransaction)` |

**All five MUST receive the same `tx`** — never call them with `db` directly inside a registration flow.

### 3.4 Free-trial grant on the student branch

After `createStudentWithHandshakeRetry` resolves on the `student` branch of `createRoleChild`, the registration transaction invokes the trial provisioning service:

```ts
case "student": {
  await createStudentWithHandshakeRetry(userId, tx);
  await StudentTrialService.grantFreeTrial(userId, locale, tx);
  return;
}
```

The grant is issued through `StudentTrialService.grantFreeTrial(studentId, locale, tx?)` — the single canonical provisioning entry point — which delegates to a single guarded conditional `UPDATE … WHERE trial_granted_at IS NULL … RETURNING id` on the `students` table. The grant shares the surrounding `withTransaction(outerTx)` SAVEPOINT-aware scope, so if any later step in registration throws, the user row, student row, and trial grant all roll back atomically. The teacher (`applicants`), parent, and admin (`createAdminUser`) paths do NOT receive the grant — it is structurally unreachable outside the `student` branch. The full grant-once atomicity argument, the dedicated `balance_trial` lane rationale, the DEV3 booking-eligibility & decrement contract, and the canonical anti-patterns are documented in [`docs/students/free-trial-provisioning.md`](../students/free-trial-provisioning.md).

---

## 4. BOPLA Whitelist (Mass-Assignment Defense)

The service maps the public input to the insert payload **field-by-field** — never spreads `{ ...input }`:

```ts
const insert: UserInsertType = {
  fullName: input.fullName,
  email: input.email,
  phone: input.phone,
  passwordHash,
  role,
  gender: input.gender ?? null,
  country: input.country,
  // Governance defaults — server-set, never client-controlled.
  isDeleted: false,
  deletedAt: null,
  suspended: false,
  suspendedAt: null,
  suspendedPeriodDays: null,
  isBlocked: false,
  blockedAt: null,
  lastActiveAt: new Date(),
};
```

### 4.1 Structural defense at the type level

`RegistrationSubmitInput` is the **public** contract submitted by the register form. It structurally omits every field a client must never control:

| Omitted field | Reason |
|---|---|
| `id` | Server-generated |
| `handshakeCode` | Server-generated for students |
| `balanceHifz`, `balanceTajweed`, `balanceReviews` | Server-zeroed for students |
| `balanceTrial`, `trialGrantedAt` | Server-set by the trial provisioning service (`StudentTrialService.grantFreeTrial`) on the student branch only — never client-controlled. See `docs/students/free-trial-provisioning.md` |
| `parentId` | Server-set during the parent handshake flow |
| `isDeleted`, `deletedAt` | Governance — server-controlled |
| `suspended`, `suspendedAt`, `suspendedPeriodDays` | Governance — server-controlled |
| `isBlocked`, `blockedAt` | Governance — server-controlled |
| `lastActiveAt` | Server-set to `now()` on registration, updated on each authenticated request |
| `createdAt`, `updatedAt` | Drizzle defaults |

A client that submits `isDeleted: true`, `handshakeCode: "X"`, or `id: 999` is **structurally rejected** by the TS type (compile-time) and, even if transport tamper bypasses the type, the explicit field-by-field mapping ignores the extra fields (runtime).

### 4.2 `RegistrationReturnType` omits `passwordHash`

```ts
export type RegistrationReturnType = Omit<UserSelectType, "passwordHash">;
```

The hash can never leak to a resolver payload, log, or GraphQL response.

---

## 5. BFLA Public-Resolver Gate (Function-Level Authorization)

`admin` is a privileged role reserved for super-admin onboarding. The public registration mutation MUST NOT accept `role=admin`. The defense is layered:

### 5.1 Type-level gate (compile-time)

```ts
export type RegisterPublicRole = "student" | "teacher" | "parent";
// "admin" is intentionally absent.
```

### 5.2 GraphQL schema gate

The `RegisterPublicRolePothosEnum` exposes only `STUDENT`, `TEACHER`, `PARENT`. A client submitting `role: ADMIN` receives a GraphQL validation error before any resolver runs.

### 5.3 Runtime service gate

```ts
if (input.role !== "student" && input.role !== "teacher" && input.role !== "parent") {
  throw new ValidationError("ROLE_FORBIDDEN", t.roleForbidden);
}
```

This defends against transport-layer tamper (e.g., a hand-crafted POST that bypasses the GraphQL schema validator).

### 5.4 Privileged path

`RegistrationService.createAdminUser(input: AdminRegistrationSubmitInput, locale, outerTx?)` is a separate service method that accepts `role: "admin"`. It is **service-only** — not exposed via any Pothos mutation. A future permission-gated admin onboarding surface will call it explicitly.

---

## 6. 23505 → ConflictError Translation

The DB unique constraint on `users.email` is the authoritative guard against duplicate accounts. There is **no pre-check** (avoids TOCTOU). When the constraint fires, PostgreSQL raises error code `23505`.

### 6.1 Drizzle wraps PG errors on `.cause`

Drizzle wraps the original PostgreSQL error inside a `DrizzleQueryError` instance, with the actual PG error attached as `.cause`. The `23505` code lives on the inner `.cause`, **not** on the top-level `DrizzleQueryError`.

### 6.2 Cause-chain traversal

`translateDbError` and `isUniqueViolation` (in `backend/lib/errors.ts`) walk the `Error.cause` chain:

```ts
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: string }).code === "23505") return true;
    if (current.message.includes("UNIQUE constraint failed")) return true; // SQLite parity
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
```

### 6.3 Localized ConflictError

`translateDbError(error, localizedMessage)`:

- If `isUniqueViolation(error)` → `throw new ConflictError(localizedMessage)` with `extensions.code = "CONFLICT"`.
- Otherwise → re-throw the original error.

The `localizedMessage` is `t.emailAlreadyExists` from `getServerTranslations(locale).authTranslations` — never a hardcoded string.

> **Gotcha (recurring):** Every service translating DB-constraint violations to domain errors MUST traverse the `DrizzleQueryError.cause` chain. Reading `(error as { code?: string }).code` directly off the top-level error will miss `23505`. This pattern is captured here for propagation to future service implementations.

---

## 7. JWT Auth Flow

Registration ships with a complete JWT auth vertical slice. The flow:

### 7.1 Registration

`POST /api/graphql` → `mutation registerUser(input)` → `RegistrationService.registerUser` → returns `{ id, email, fullName, role }` (no tokens). The client redirects to `/login`.

### 7.2 Login

`mutation login(input: { email, password })` → `AuthService.login`:
1. `UserRepository.findByEmail(email)` — case-insensitive collation.
2. `comparePassword(plaintext, hash)` — bcrypt.
3. Governance check: `isDeleted || isBlocked || suspended` → `UnauthorizedError` (generic — never discloses which).
4. Sign `access_token` (15min, HS256) + `refresh_token` (7day, HS256).
5. Return `{ user, accessToken, refreshToken }`.

The `refresh_token` is also set as an **httpOnly cookie** by the Next.js route handler (never visible to JS). The `access_token` is returned in the response body and held in **React memory only** by `AuthProvider` (XSS mitigation — never set as a cookie).

### 7.3 `me` query

`query me` → `AuthService.getMe(ctx)`:
- Reads `ctx.user` (populated by `gqlContextFactory` from the `Authorization: Bearer <access_token>` header).
- Returns the authenticated user shape or `null` if anonymous.

### 7.4 `refreshToken` mutation

`mutation refreshToken` → `AuthService.refreshToken(ctx)`:
1. Reads the `refresh_token` from the httpOnly cookie.
2. `verifyRefreshToken(token)` → `{ userId, sessionId }` (returns `null` on any failure — never throws).
3. Signs a new `access_token` (and optionally rotates the refresh token).
4. Returns `{ accessToken, refreshToken }`.

### 7.5 Secrets

- Production: set `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` env vars separately (distinct 32-byte secrets).
- Dev fallback: derive both from `DATABASE_ENCRYPTION_KEY` via `SHA-256(base + ":access"|"refresh")` — keeps dev bootstrapping to a single secret while remaining cryptographically distinct.
- `isUsingDevFallbackSecret()` lets the GraphQL route log a one-time warning in non-production.

> **Deferred:** Session store for refresh-token revocation — currently stateless JWT. The `sessionId` claim is already present on refresh tokens, so adding a server-side `sessions` table is additive (no token-shape change).

---

## 8. i18n

All user-facing error messages resolve through the **compile-time TypeScript translation system** in `shared/locale/`:

- Services: `getServerTranslations(locale).authTranslations` from `@/shared/locale/server-graphql`.
- Resolvers: `ctx.t("auth")` (already bound to `ctx.locale`).
- Client components: `useAppTranslation("auth")` from `@/shared/locale/client`.

The `auth` and `errors` namespaces live in the standard four files per locale:

```
shared/locale/types/auth/index.ts    (MessageSchema — source of truth)
shared/locale/en/auth/index.ts       (English implementation)
shared/locale/ar/auth/index.ts       (Arabic implementation)
shared/locale/namespace-paths.ts     (registered namespace path)
```

Keys used by registration:

| Key | Purpose |
|---|---|
| `nameRequired` | Validation: full name missing |
| `emailRequired` | Validation: email missing |
| `emailInvalid` | Validation: email shape |
| `emailAlreadyExists` | Conflict (23505 on `users.email`) |
| `phoneRequired` | Validation: phone missing |
| `passwordRequired` | Validation: password missing |
| `passwordTooShort` | Validation: password < 8 chars |
| `countryRequired` | Validation: country missing |
| `roleRequired` | Validation: role missing |
| `roleForbidden` | BFLA: role outside public union |
| `loginTitle`, `loginSubmit`, `invalidCredentials`, `welcomeBack`, … | Login UI |

Never hardcode error strings — always use typed translation functions.

---

## 9. File Layout and Tests

### 9.1 Files

**Backend:**
- `backend/types/users/registration.types.ts`
- `backend/services/auth/registration.service.ts`
- `backend/services/auth/auth.service.ts`
- `backend/lib/auth/jwt.ts`, `backend/lib/auth/cookies.ts`, `backend/lib/auth/password.ts`
- `backend/lib/ratelimit.ts` (stub)
- `backend/db/repo/users/user.repository.ts`, `admin.repository.ts`
- `backend/db/repo/students/student.repository.ts`
- `backend/db/repo/parents/parent.repository.ts`
- `backend/db/repo/applicants/applicant.repository.ts` (+ sub-barrel)
- `backend/graphql/builder.ts`, `gqlContextFactory.ts`, `gqlSchema.ts`
- `backend/graphql/mutation/auth.mutation.ts`, `query/auth.query.ts`, `query/index.ts`
- `backend/graphql/pothos/enum.pothos.ts`, `users/user.pothos.ts`, `auth/register-input.pothos.ts`, `auth/auth-payload.pothos.ts`
- `backend/services/auth/registration.service.test.ts`
- `backend/db/test/test-utils.ts`, `logger-mock.ts`, `ensure-env.ts` (+ `entity-setup.ts` extended with `createTestApplicant`)
- `backend/graphql/codegen.ts`, `scripts/generate-gql-schema.ts`

**Frontend:**
- `frontend/graphql/sharedDocuments/auth/auth.documents.ts` (+ barrel) — `registerUserMutationDocument`, `loginMutationDocument`, `meQueryDocument`, `refreshTokenMutationDocument`
- `frontend/context/AuthContext.ts` — user shape is `NonNullable<MeQuery["me"]>`
- `frontend/providers/apollo/AuthProvider.tsx` (login, session restore, refresh-before-redirect, logout)
- `frontend/providers/apollo/useAuthRecoveryRegistration.ts`
- `frontend/lib/auth/refreshMemoryToken.ts`
- Frontend provider/infra modules: logger, safeRedirect, dedupedRefreshToken, emotion caches, theme-detection, ViewportContext, NetworkConnectivityContext, useNetworkConnectivity hook, etc.
- `app/(auth)/login/{page.tsx,LoginForm.tsx}`, `app/(auth)/register/{page.tsx,RegisterForm.tsx}`, `app/(auth)/layout.tsx`
- `app/_components/auth-header.tsx`, `app/layout.tsx` (mounts AppClientProviders)

**i18n:**
- `shared/locale/types/auth/*`, `shared/locale/en/auth/*`, `shared/locale/ar/auth/*`
- `shared/locale/types/errors/*`, `shared/locale/en/errors/*`, `shared/locale/ar/errors/*`
- `shared/locale/server-graphql.ts`

### 9.2 Tests

- `backend/services/auth/registration.service.test.ts` — role matrix, duplicate email, forced child-insert failure → rollback, handshake collision retry + budget exhaustion, validation matrix, password hash verification. DB-bound runs require `.env.test` plus the bunfig preload.

### 9.3 Deferred and future work

- Recitation (Qira'ah) record creation tied to student registration.
- Session store for refresh-token revocation and a real rate limiter (the current `backend/lib/ratelimit.ts` is a stub).
- Teacher verification pipeline (applicants → teacher row) — see `docs/teachers/applicant-lifecycle.md`.
- Parent handshake consumption (linking a parent via `handshake_code`).
- Admin onboarding mutation that wires `createAdminUser` to a permission-gated surface.

---

## 10. References

- Specs: `docs/specs/functional-requirements.md`
- Related docs: `docs/auth/REDIRECT_LOOP_FIX.md`, `docs/graphql/error-handling-contract.md`, `docs/graphql/domain-error-extensions-code.md`
- Service entry points: `backend/services/auth/registration.service.ts`, `backend/services/auth/auth.service.ts`
- Key infra: `backend/lib/auth/jwt.ts`, `backend/lib/auth/cookies.ts`, `backend/lib/auth/password.ts`, `backend/lib/errors.ts`
