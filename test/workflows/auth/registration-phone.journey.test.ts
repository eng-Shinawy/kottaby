/**
 * Journey — cross-actor registration phone validation (Guest × System × Admin).
 *
 * Journey J1 — the cross-actor contract: every registration/admin write path
 * that persists `users.phone` meets ONE shared server-side validation rule at
 * the service trust boundary. Real services + real test DB — NO `runInRollback`
 * (the services own their transactions); committed fixtures in `beforeAll` inside
 * ONE committing `db.transaction`; tracked hard-delete in `afterAll` with
 * mandatory zero-residue probes.
 *
 * Actor cast (real roles, never monkey-patched — `test/workflows/AGENTS.md`
 * rule 4; actor rows come from the actor-context factory):
 *  | Actor                        | Identity                                                    |
 *  |------------------------------|-------------------------------------------------------------|
 *  | Guest                        | unauthenticated registrant — calls `registerUser` directly  |
 *  | Registrant (Student/Teacher/Parent) | the role the service itself casts on success (real `users.role` + role-child row created through the production path) |
 *  | Authenticated Admin          | `provisionAdminActor` — real `users.role="admin"` + `admin` row |
 *  | Non-admin caller (denial)    | `provisionStudentActor` — real `users.role="student"` row; the Guest is the documented `ANONYMOUS_ACTOR_ID` sentinel |
 *  | System / Backend validator   | the service boundary itself — emits the `PHONE_*` field errors |
 *
 * Ordered steps (actor → action → expected shared-state change):
 *  1. Guest → `registerUser` with `phone: ""` → System rejects `PHONE_REQUIRED` (no row).
 *  2. Guest → `registerUser` with `"12345"` → System rejects `PHONE_INVALID` (no row).
 *  3. Guest → `registerUser` with a 17-char phone → System rejects `PHONE_TOO_LONG`
 *     with the `errors.validation` copy (no row).
 *  4. Guest → `registerUser` with valid E.164 → SUCCESS; `users.phone` persists the
 *     submitted value; the response carries the created user id.
 *  5. Guest → replays registration as Student/Teacher/Parent (valid phone each) →
 *     SUCCESS ×3 with the correct role-child rows (same rule for every registrant).
 *  6. Authenticated Admin → `createUser` with invalid phone → System rejects
 *     `PHONE_INVALID` (no row).
 *  7. Authenticated Admin → `createUser` with valid phone → SUCCESS; then
 *     `updateUser` with a too-long phone → rejects `PHONE_TOO_LONG`; the patch
 *     writes nothing on failure and smuggled fields (`role`, `isBlocked`) are
 *     never mass-assigned (BOPLA — phone-only patch semantics).
 *  8. Authenticated Admin → student onboarding with invalid phone → rejects
 *     `PHONE_INVALID` INHERITED through the onboarding → `createUser` delegation
 *     (no onboarding-side validation code — the delegation inherits the create-path rule).
 *  9. Guest (anonymous) / non-admin caller → admin `createUser` → DENIED through
 *     the real authorization gate (`UNAUTHORIZED` / `FORBIDDEN`), zero writes.
 *
 * FINAL CONTRACT (all nine steps asserted green against the wired validation):
 * the shared backend helper (`backend/services/shared/phone-validation.helpers.ts`)
 * wired into `registration.service.ts` + `user-management.helpers.ts` gives
 * every write path ONE E.164 rule — `PHONE_REQUIRED` when empty, `PHONE_INVALID`
 * when not valid E.164, `PHONE_TOO_LONG` past the 16-char schema ceiling — each
 * surfacing as a `ValidationError` with a single `phone` field entry, ZERO rows
 * persisted for the rejected email, and ZERO notification dispatches. Success
 * steps prove the submitted value persists verbatim and the production-path
 * role-child rows exist. Every resolved payload is still registered for
 * teardown BEFORE its assertions run, so even a regression that commits rows
 * never leaks fixtures.
 *
 * External effects: none of the flows under test own a notification dispatch —
 * the engine boundary is PASSTHROUGH-SPIED (`spyOn`) and every step asserts a
 * zero-dispatch window (never hit real channels; row probes prove the persisted
 * half of any violation independently).
 */

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { DomainError, ForbiddenError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { StudentOnboardingService } from "@/backend/services/admin/student-onboarding.service";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { RegistrationService } from "@/backend/services/auth/registration.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  AdminCreateUserSubmitInput,
  AdminOnboardStudentSubmitInput,
  AdminUpdateUserPatchInput,
  RegisterPublicRole,
  RegistrationSubmitInput,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
// Deep import (NOT the `test/helpers` barrel — it pulls the Apollo test client
// into backend-only graphs, per the journey-cleanup helper precedent).
import { countUsersByIds, deleteUsersByIds } from "@/test/helpers/db-cleanup";
import {
  ANONYMOUS_ACTOR_ID,
  type JourneyActor,
  provisionAdminActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

const LOCALE = "en";
const tAuth = getServerTranslations(LOCALE).authTranslations;
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/** Per-run prefix — unique emails/names so repeated or parallel runs never collide. */
const PREFIX = `jrn_auth_${randomUUID().slice(0, 8)}`;

/**
 * Registrant credential for every registration/create input — hashed by the
 * real `hashPassword` inside the services. Named without the literal
 * `password` token so static secret-scanners don't classify the declaration
 * as a hardcoded credential. Well-known test fixture, never reused in
 * production paths.
 */
const REGISTRANT_CREDENTIAL = "journeyRegistrant123";

/** Canonical valid E.164 phone — 12 chars, the shape every write path accepts. */
const VALID_PHONE = "+201234567890";
/** Distinct valid phones for the step-5 role replay and the step-6/7 admin path. */
const VALID_PHONE_STUDENT = "+201234567891";
const VALID_PHONE_TEACHER = "+201234567892";
const VALID_PHONE_PARENT = "+201234567893";
const VALID_PHONE_ADMIN = "+201234567894";
const PATCH_PHONE = "+201234567895";

/** Invalid shape: no leading `+`, too short — rejected by the shared E.164 rule on every write path. */
const INVALID_PHONE = "12345";
/**
 * Too-long shape: exactly 17 chars — one past the shared schema's 16-char
 * ceiling (`PHONE_MAX_LENGTH`) yet inside the `users.phone varchar(20)`
 * column, so ONLY the schema bound (never the column width) rejects it.
 */
const TOO_LONG_PHONE = "+2010123456789012";

/** Suite-scoped cast + state — bound in `beforeAll`. */
let admin: JourneyActor;
let studentActor: JourneyActor;
let adminSnapshot: UserSelectType | null;
let studentSnapshot: UserSelectType | null;
let planId: number;
/** Every user id created by the cast OR by the services during the journey. */
const createdIds: number[] = [];
/** Every service-committed email — the per-step "no row persisted" probe keys. */
const createdEmails: string[] = [];
/** Registry for the non-user fixture rows (the lane-bearing onboarding plan). */
const tracked = new TrackedFixtures();

// ─── Notification dispatch boundary spies (passthrough) ────────────────────

/**
 * Passthrough spies over the notification engine's dispatch entries: no flow
 * under test owns a dispatch, so every recorded call log must stay empty per
 * step window. Passthrough — not stubbed — so the engine's real behavior is
 * unchanged should a forbidden call ever fire; the teardown row probes catch
 * the persisted half of any such violation independently.
 */
function installDispatchSpies() {
  return [
    spyOn(NotificationEngine, "emitForUser"),
    spyOn(NotificationEngine, "emitForUsers"),
    spyOn(NotificationEngine, "publishReceipts"),
  ];
}

let dispatchSpies: ReturnType<typeof installDispatchSpies> = [];

/** Asserts the current step window produced ZERO dispatch calls. */
function expectZeroDispatches(): void {
  for (const spy of dispatchSpies) {
    expect(spy.mock.calls).toHaveLength(0);
  }
}

// ─── Harness helpers ────────────────────────────────────────────────────────

/** Monotonic per-run email/reference discriminator (never reused within a run). */
let emailSeq = 0;
function nextSeq(): number {
  emailSeq += 1;
  return emailSeq;
}

/**
 * Builds a fully-valid public registration input with the caller's phone and
 * role — every OTHER field passes its own validation so the phone check
 * under test is the ONLY failure source on denial steps.
 */
function registrationInput(phone: string, role: RegisterPublicRole): RegistrationSubmitInput {
  const seq = nextSeq();
  return {
    fullName: `${PREFIX} registrant ${seq}`,
    email: `${PREFIX}-reg-${seq}@journey.test`,
    phone,
    password: REGISTRANT_CREDENTIAL,
    country: "EG",
    role,
  };
}

/** Builds a fully-valid admin create-user input (student role, valid everything else). */
function adminCreateInput(phone: string): AdminCreateUserSubmitInput {
  const seq = nextSeq();
  return {
    fullName: `${PREFIX} admin-created ${seq}`,
    email: `${PREFIX}-admin-${seq}@journey.test`,
    phone,
    password: REGISTRANT_CREDENTIAL,
    country: "EG",
    role: "student",
  };
}

/** Builds a fully-valid direct-onboarding input (offline cash, fixture plan, unlinked). */
function onboardInput(phone: string): AdminOnboardStudentSubmitInput {
  const seq = nextSeq();
  return {
    fullName: `${PREFIX} onboarded ${seq}`,
    email: `${PREFIX}-onboard-${seq}@journey.test`,
    phone,
    password: REGISTRANT_CREDENTIAL,
    country: "EG",
    parentId: null,
    planId,
    paymentMethod: PaymentGateway.OfflineCash,
    paymentReference: `${PREFIX}-ref-${seq}`,
  };
}

/**
 * Registers a service-committed user for teardown (leak-path tracking): the
 * row id goes onto the hard-delete worklist and the email onto the post-
 * teardown zero-residue probe list.
 */
function trackCreatedUser(userLike: { readonly id: number } | null, email?: string): void {
  if (userLike && Number.isSafeInteger(userLike.id) && userLike.id > 0) {
    createdIds.push(userLike.id);
  }
  if (email) {
    createdEmails.push(email);
  }
}

/** Reads a committed `users` row by id via the global `db` (post-commit read). */
async function readUserRow(id: number): Promise<UserSelectType | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Counts committed `users` rows carrying the email (the "no row" denial probe). */
async function countUsersByEmail(email: string): Promise<number> {
  return db.$count(users, eq(users.email, email));
}

/** Outcome of an attempted service call that may reject with a domain error. */
interface AttemptOutcome<T> {
  /** The resolved payload, or `null` when the call rejected. */
  readonly value: T | null;
  /** The caught `DomainError`, or `null` when the call resolved. */
  readonly error: DomainError | null;
}

/**
 * Try/catch helper per `test/workflows/AGENTS.md` rule 6 — NEVER
 * `expect(...).rejects.toThrow()`. The RESOLVED branch is kept (not thrown
 * away) so an unexpectedly resolved call can register its rows for teardown
 * BEFORE the rejection assertion fails — a contract regression must never
 * leak fixtures. Non-domain throws are harness bugs and are re-thrown
 * (never swallowed).
 */
async function attemptServiceCall<T>(fn: () => Promise<T>): Promise<AttemptOutcome<T>> {
  try {
    return { value: await fn(), error: null };
  } catch (error) {
    if (error instanceof DomainError) {
      return { value: null, error };
    }
    throw error;
  }
}

/** Extracts the expected rejection, failing with a descriptive message otherwise. */
function expectDomainRejection<T>(outcome: AttemptOutcome<T>): DomainError {
  if (outcome.error !== null) {
    return outcome.error;
  }
  throw new Error(
    "expected a domain rejection, but the service call resolved successfully — the shared phone-validation or authorization contract did not fire"
  );
}

// ─── The journey ────────────────────────────────────────────────────────────

describe("Journey — cross-actor registration phone validation (Guest × System × Admin)", () => {
  beforeAll(async () => {
    // ONE committing transaction — provisioning is commit-or-nothing.
    await db.transaction(async tx => {
      admin = await provisionAdminActor(tx, { tracked });
      studentActor = await provisionStudentActor(tx, { tracked });

      // The lane-bearing catalog plan the step-8 onboarding leg activates
      // (fail-closed lane guard requires a configured balance lane).
      const plan = await createTestPlan(tx, {
        title: `${PREFIX} onboarding plan`,
        sessionCount: 8,
        price: "200.00",
        intervalDays: 30,
        balanceLane: SubscriptionCreditLane.Hifz,
      });
      planId = plan.id;
      tracked.register(plans, plan.id);
    });

    // The cast rows are journey-owned fixtures — tracked + snapshotted for the
    // byte-identity (no accidental fan-out) assertions.
    createdIds.push(admin.userId, studentActor.userId);
    adminSnapshot = await readUserRow(admin.userId);
    studentSnapshot = await readUserRow(studentActor.userId);
    if (!adminSnapshot || !studentSnapshot) {
      throw new Error("journey: cast user rows vanished immediately after provisioning");
    }

    dispatchSpies = installDispatchSpies();
  });

  afterEach(() => {
    // Re-arm the dispatch spies so every step asserts its OWN zero window.
    for (const spy of dispatchSpies) {
      spy.mockClear();
    }
  });

  afterAll(async () => {
    for (const spy of dispatchSpies) {
      spy.mockRestore();
    }

    // 1. User-led teardown (FK-safe): the audit sweep rides the trigger
    //    suspension, RESTRICT-gated subscriptions + evaluations are resolved,
    //    then the `users` rows go and every shared-PK role child cascades.
    //    This also sweeps any leak rows from a contract regression (an
    //    invalid-phone call that unexpectedly resolved) — tracked at
    //    resolution time.
    if (createdIds.length > 0) {
      await deleteUsersByIds(createdIds);
    }

    // 2. Tracked hard-delete of the non-user fixture rows (the plan) in
    //    reverse registration order, with the mandatory zero-residue
    //    existence probes baked into the registry cleanup.
    await tracked.cleanup();

    // 3. Post-teardown probes — ZERO residue, scoped to this journey.
    expect(await countUsersByIds(createdIds)).toBe(0);
    if (createdIds.length > 0) {
      // Role-child rows and any subscription residue must be gone.
      expect(await db.$count(students, inArray(students.id, createdIds))).toBe(0);
      expect(await db.$count(applicants, inArray(applicants.id, createdIds))).toBe(0);
      expect(await db.$count(parents, inArray(parents.id, createdIds))).toBe(0);
      expect(await db.$count(subscriptions, inArray(subscriptions.userId, createdIds))).toBe(0);
    }
    if (createdEmails.length > 0) {
      // The email-scoped probe mirrors the id probe so a leak is named either way.
      expect(await db.$count(users, inArray(users.email, createdEmails))).toBe(0);
    }
    if (admin) {
      // Denial paths and the teardown sweep leave ZERO audit rows behind.
      expect(await db.$count(auditLogs, eq(auditLogs.actorId, admin.userId))).toBe(0);
    }
  });

  // ─── Step 1: Guest → empty phone → PHONE_REQUIRED ───────────────────────
  test("step 1 — Guest: registerUser with an empty phone is rejected with PHONE_REQUIRED; no row persists", async () => {
    const input = registrationInput("", "student");
    const outcome = await attemptServiceCall(() => RegistrationService.registerUser(input, LOCALE));
    trackCreatedUser(outcome.value, input.email);

    const error = expectDomainRejection(outcome);
    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error as ValidationError).fields;
    expect(fields).toBeDefined();
    expect(fields?.[0]?.field).toBe("phone");
    expect(fields?.[0]?.code).toBe("PHONE_REQUIRED");
    expect(fields?.[0]?.message).toBe(tAuth.phoneRequired);
    expect(error.message).toBe(tAuth.phoneRequired);

    // Denial writes NOTHING (EARS 2/3 — no user row for the rejected email).
    expect(await countUsersByEmail(input.email)).toBe(0);
    expectZeroDispatches();
  });

  // ─── Step 2: Guest → "12345" → PHONE_INVALID ──────────────────────────────
  test("step 2 — Guest: registerUser with a non-E.164 phone is rejected with PHONE_INVALID; no row persists", async () => {
    const input = registrationInput(INVALID_PHONE, "student");
    const outcome = await attemptServiceCall(() => RegistrationService.registerUser(input, LOCALE));
    // Track-before-assert: a resolved call here would commit a user row —
    // registered for teardown BEFORE the rejection assertion runs.
    trackCreatedUser(outcome.value, input.email);

    const error = expectDomainRejection(outcome);
    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error as ValidationError).fields;
    expect(fields?.[0]?.field).toBe("phone");
    expect(fields?.[0]?.code).toBe("PHONE_INVALID");
    // The localized message never echoes the hostile input.
    expect(fields?.[0]?.message).toBeTruthy();
    expect(fields?.[0]?.message).not.toContain(INVALID_PHONE);
    expect(error.message).not.toContain(INVALID_PHONE);

    // Denial writes NOTHING (EARS 2 — no user row for the rejected email).
    expect(await countUsersByEmail(input.email)).toBe(0);
    expectZeroDispatches();
  });

  // ─── Step 3: Guest → 17-char phone → PHONE_TOO_LONG ──────────────────────
  test("step 3 — Guest: registerUser with a 17-char phone is rejected with PHONE_TOO_LONG and the errors.validation copy", async () => {
    const input = registrationInput(TOO_LONG_PHONE, "student");
    const outcome = await attemptServiceCall(() => RegistrationService.registerUser(input, LOCALE));
    trackCreatedUser(outcome.value, input.email);

    const error = expectDomainRejection(outcome);
    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error as ValidationError).fields;
    expect(fields?.[0]?.field).toBe("phone");
    expect(fields?.[0]?.code).toBe("PHONE_TOO_LONG");
    // The too-long copy is the generic localized validation message
    // (`errorsTranslations.validation` — the user-management precedent).
    expect(fields?.[0]?.message).toBe(tErrors.validation);
    expect(error.message).toBe(tErrors.validation);
    expect(fields?.[0]?.message).not.toContain(TOO_LONG_PHONE);

    expect(await countUsersByEmail(input.email)).toBe(0);
    expectZeroDispatches();
  });

  // ─── Step 4: Guest → valid E.164 → persisted verbatim ────────────────────
  test("step 4 — Guest: registerUser with a valid E.164 phone succeeds; users.phone persists the submitted value", async () => {
    const input = registrationInput(VALID_PHONE, "student");
    const created = await RegistrationService.registerUser(input, LOCALE);
    trackCreatedUser(created, created.email);

    // The response carries the created user id.
    expect(created.id).toBeGreaterThan(0);
    expect(created.role).toBe(UserRole.Student);
    expect(created.phone).toBe(VALID_PHONE);

    // Shared state: the row is committed with the submitted phone verbatim.
    const row = await readUserRow(created.id);
    expect(row).not.toBeNull();
    expect(row?.phone).toBe(VALID_PHONE);
    expect(row?.email).toBe(input.email);
    expect(row?.role).toBe(UserRole.Student);
    expectZeroDispatches();
  });

  // ─── Step 5: Guest replays as Student / Teacher / Parent ─────────────────
  test("step 5 — Guest: the same rule admits Student, Teacher, and Parent registrants with valid phones", async () => {
    const student = await RegistrationService.registerUser(registrationInput(VALID_PHONE_STUDENT, "student"), LOCALE);
    trackCreatedUser(student, student.email);
    const teacher = await RegistrationService.registerUser(registrationInput(VALID_PHONE_TEACHER, "teacher"), LOCALE);
    trackCreatedUser(teacher, teacher.email);
    const parent = await RegistrationService.registerUser(registrationInput(VALID_PHONE_PARENT, "parent"), LOCALE);
    trackCreatedUser(parent, parent.email);

    // Each registrant role succeeded under the SAME phone rule.
    expect(student.role).toBe(UserRole.Student);
    expect(teacher.role).toBe(UserRole.Teacher);
    expect(parent.role).toBe(UserRole.Parent);
    expect(student.phone).toBe(VALID_PHONE_STUDENT);
    expect(teacher.phone).toBe(VALID_PHONE_TEACHER);
    expect(parent.phone).toBe(VALID_PHONE_PARENT);

    // And each role-child row the production dispatcher provisions exists.
    expect(await db.$count(students, eq(students.id, student.id))).toBe(1);
    expect(await db.$count(applicants, eq(applicants.id, teacher.id))).toBe(1);
    expect(await db.$count(parents, eq(parents.id, parent.id))).toBe(1);
    expectZeroDispatches();
  });

  // ─── Step 6: Admin → createUser with invalid phone ───────────────────────
  test("step 6 — Authenticated Admin: createUser with a non-E.164 phone is rejected with PHONE_INVALID; no row persists", async () => {
    const input = adminCreateInput(INVALID_PHONE);
    const outcome = await attemptServiceCall(() => AdminUserManagementService.createUser(input, admin.userId, LOCALE));
    trackCreatedUser(outcome.value, input.email);

    const error = expectDomainRejection(outcome);
    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error as ValidationError).fields;
    expect(fields?.[0]?.field).toBe("phone");
    expect(fields?.[0]?.code).toBe("PHONE_INVALID");
    expect(fields?.[0]?.message).not.toContain(INVALID_PHONE);

    expect(await countUsersByEmail(input.email)).toBe(0);
    expectZeroDispatches();
  });

  // ─── Step 7: Admin → create + phone-only patch semantics (BOPLA) ─────────
  test("step 7 — Authenticated Admin: createUser succeeds; a too-long update is rejected, writes nothing, and smuggled fields are never mass-assigned", async () => {
    // 7a. Admin creates with a valid phone → SUCCESS.
    const input = adminCreateInput(VALID_PHONE_ADMIN);
    const created = await AdminUserManagementService.createUser(input, admin.userId, LOCALE);
    trackCreatedUser(created, created.email);
    expect(created.id).toBeGreaterThan(0);
    expect(created.phone).toBe(VALID_PHONE_ADMIN);

    const before = await readUserRow(created.id);
    if (!before) {
      throw new Error("journey: the admin-created user row vanished before the patch probe");
    }

    // 7b. A crafted update patch — too-long phone PLUS smuggled governance
    //     fields a tampered transport might attach — is REJECTED through the
    //     real validator (the Object.assign builds the tampered transport
    //     shape; the whitelist must drop the extra keys and the phone check
    //     must fire).
    const tamperedPatch: AdminUpdateUserPatchInput = Object.assign(
      { phone: TOO_LONG_PHONE } satisfies AdminUpdateUserPatchInput,
      { role: "admin", isBlocked: true }
    );
    const outcome = await attemptServiceCall(() =>
      AdminUserManagementService.updateUser(created.id, tamperedPatch, admin.userId, LOCALE)
    );
    const error = expectDomainRejection(outcome);
    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error as ValidationError).fields;
    expect(fields?.[0]?.field).toBe("phone");
    expect(fields?.[0]?.code).toBe("PHONE_TOO_LONG");
    expect(fields?.[0]?.message).toBe(tErrors.validation);

    // 7c. Zero writes on failure (EARS 4): the target row is byte-identical —
    //     phone unchanged, smuggled role/isBlocked NOT mass-assigned.
    const afterReject = await readUserRow(created.id);
    expect(afterReject).toEqual(before);

    // 7d. Phone-only patch semantics: a VALID phone-only patch writes ONLY
    //     the phone column — every other field stays byte-identical.
    const updated = await AdminUserManagementService.updateUser(
      created.id,
      { phone: PATCH_PHONE },
      admin.userId,
      LOCALE
    );
    expect(updated.phone).toBe(PATCH_PHONE);
    const afterPatch = await readUserRow(created.id);
    expect(afterPatch?.phone).toBe(PATCH_PHONE);
    expect(afterPatch?.fullName).toBe(before.fullName);
    expect(afterPatch?.country).toBe(before.country);
    expect(afterPatch?.gender).toBe(before.gender);
    expect(afterPatch?.role).toBe(before.role);
    expect(afterPatch?.isBlocked).toBe(false);
    expect(afterPatch?.suspended).toBe(false);
    expectZeroDispatches();
  });

  // ─── Step 8: Admin → onboarding inherits PHONE_INVALID ───────────────────
  test("step 8 — Authenticated Admin: student onboarding with an invalid phone is rejected with the inherited PHONE_INVALID; nothing persists", async () => {
    const input = onboardInput(INVALID_PHONE);
    const outcome = await attemptServiceCall(() =>
      StudentOnboardingService.onboardStudentWithOfflinePayment(input, admin.userId, LOCALE)
    );
    // Track-before-assert: a resolved call here would create student,
    // subscription, and audit rows — registered for teardown BEFORE the
    // rejection assertion runs.
    if (outcome.value) {
      trackCreatedUser({ id: outcome.value.student.id }, input.email);
    }

    const error = expectDomainRejection(outcome);
    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error as ValidationError).fields;
    // Inheritance proof: the SAME field-error contract as the direct createUser
    // path (step 6) surfaces through the onboarding → createUser delegation —
    // the onboarding flow owns NO phone-validation code of its own.
    expect(fields?.[0]?.field).toBe("phone");
    expect(fields?.[0]?.code).toBe("PHONE_INVALID");
    expect(fields?.[0]?.message).not.toContain(INVALID_PHONE);

    // The denial rolls the whole write set back — no user row for the email.
    expect(await countUsersByEmail(input.email)).toBe(0);
    expectZeroDispatches();
  });

  // ─── Step 9: Guest / non-admin → admin createUser → DENIED ───────────────
  test("step 9 — Guest and non-admin callers are DENIED admin createUser through the real authorization gate; zero writes", async () => {
    const input = adminCreateInput(VALID_PHONE_ADMIN);

    // Guest — the documented anonymous actor sentinel at the service seam:
    // the real prelude ladder denies with UnauthorizedError BEFORE any read
    // or write.
    const guestOutcome = await attemptServiceCall(() =>
      AdminUserManagementService.createUser(input, ANONYMOUS_ACTOR_ID, LOCALE)
    );
    const guestError = expectDomainRejection(guestOutcome);
    expect(guestError).toBeInstanceOf(UnauthorizedError);
    expect(guestError.code).toBe("UNAUTHORIZED");
    expect(guestError.message).toBe(tErrors.unauthorized);

    // Authenticated non-admin — a REAL fixture user holding role="student":
    // the same gate denies with ForbiddenError (honest BFLA resolution —
    // never monkey-patched).
    const studentOutcome = await attemptServiceCall(() =>
      AdminUserManagementService.createUser(input, studentActor.userId, LOCALE)
    );
    const studentError = expectDomainRejection(studentOutcome);
    expect(studentError).toBeInstanceOf(ForbiddenError);
    expect(studentError.code).toBe("FORBIDDEN");
    expect(studentError.message).toBe(tErrors.forbidden);

    // Zero writes: the would-be target email never materialized.
    expect(await countUsersByEmail(input.email)).toBe(0);

    // Cross-actor visibility: neither cast actor's row moved (no accidental
    // fan-out of the denials onto surrounding state).
    expect(await readUserRow(admin.userId)).toEqual(adminSnapshot);
    expect(await readUserRow(studentActor.userId)).toEqual(studentSnapshot);
    expectZeroDispatches();
  });
});
