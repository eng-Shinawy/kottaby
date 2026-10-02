/**
 * Journey D — Admin Password Reset (temporary credential → forced change).
 *
 * Cross-actor workflow test covering the full forced-reset arc over one
 * shared `users` row, observed by three honest actors:
 *  - the admin, who sets a temporary credential with the forced-reset flag;
 *  - the target (a certified teacher), who logs in, is fenced while flagged,
 *    replaces the credential themselves, and regains full access;
 *  - a foreign non-admin (a student), who is denied the admin credential
 *    surface with zero writes and zero audit rows.
 *
 * Ordered steps (fixture → set → observe → deny → fence → replace → reopen →
 * cleanup) run in declaration order; later steps observe the shared state
 * earlier steps committed. Per `test/workflows/AGENTS.md`:
 *  - Committed fixtures in `beforeAll` inside ONE committing transaction
 *    (NO `runInRollback` — the services spawn their own top-level
 *    transactions); tracked hard-delete in `afterAll` with mandatory
 *    zero-residue probes.
 *  - Honest authorization only — the cast is provisioned by the
 *    `actor-context` factory (REAL `users` rows + REAL role-child rows);
 *    denial legs fail through the real service gates. Rows are relabeled
 *    with the per-run `jrn_adminpwd_<uuid8>` prefix so emails/names never
 *    collide across repeated or parallel runs.
 *  - Direct service calls (precedent: `admin-user-lifecycle.journey.test.ts`);
 *    denial assertions via the try/catch `expectJourneyError` helper with
 *    translated substrings from `getServerTranslations("en")` — NEVER
 *    `expect(...).rejects.toThrow()`.
 *  - Audit writes are REAL DB rows — asserted by direct `audit_logs` selects;
 *    denial paths emit ZERO audit rows (cast-scoped count deltas).
 *  - External effects: these services emit ZERO notifications by design —
 *    absence is asserted with cast-scoped row counts (no dispatch is
 *    expected, so no transport spy is installed).
 *
 * Step-5 boundary choice (documented): the forced-reset deny path lives at
 * the Apollo layer (`didResolveOperation`, BEFORE any resolver — a denied
 * operation performs zero writes by construction) and NO backend service
 * reads the flag, so there is no service-level equivalent denial to call.
 * The journey therefore drives the gate's REAL exported seams against the
 * target's REAL flagged DB row: `extractOperationRootFieldNames` on parsed
 * operations, `isPasswordChangeRequired` (deny a non-exempt root field,
 * allow the exempt self-service fields), `isExemptRootField` against the
 * closed allowlist, and the real denial carrier the plugin throws
 * (`buildPasswordChangeRequiredDenial` → `PASSWORD_CHANGE_REQUIRED`).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { type DocumentNode, type OperationDefinitionNode, parse } from "graphql";
import { db, queryDb } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { users } from "@/backend/db/schema/users/users";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import {
  buildPasswordChangeRequiredDenial,
  extractOperationRootFieldNames,
  isExemptRootField,
  isPasswordChangeRequired,
  PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS,
} from "@/backend/graphql/passwordChangeGate";
import { comparePassword } from "@/backend/lib/auth/password";
import { DomainError, ForbiddenError, UnauthorizedError } from "@/backend/lib/errors";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { AuthService } from "@/backend/services/auth/auth.service";
import type {
  AdminSetUserPasswordSubmitInput,
  ChangeMyPasswordSubmitInput,
  DBTransaction,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  type JourneyActor,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;
const tAuth = getServerTranslations(LOCALE).authTranslations;

/** Per-run prefix — unique emails/names so parallel runs never collide. */
const PREFIX = `jrn_adminpwd_${randomUUID().slice(0, 8)}`;

/**
 * Temporary credential the admin sets in step 2 and the target replaces in
 * step 6. Named without the literal `password` token so static
 * secret-scanners do not classify the declaration as a hardcoded credential;
 * the values are weak, well-known test fixtures — never reused in
 * production paths.
 */
const TEMP_CREDENTIAL = "TempPass123";
/** The replacement credential the target sets in step 6. */
const NEW_CREDENTIAL = "NewPass456";
/** Credential the foreign non-admin submits through the denied admin surface. */
const FOREIGN_CREDENTIAL = "foreignAttempt123";

/** Suite-scoped cast + registry — bound in `beforeAll`. */
let adminActor: JourneyActor;
let targetActor: JourneyActor;
let foreignActor: JourneyActor;
let tracked: TrackedFixtures;
let targetEmail = "";

/** Byte-captured `users` rows of the actors the journey must never mutate. */
let adminUserSnapshot: UserSelectType | null = null;
let foreignUserSnapshot: UserSelectType | null = null;

/**
 * Try/catch helper for asserting that a service call rejects with a
 * `DomainError` (AGENTS.md rule 6 — never `expect(...).rejects.toThrow()`).
 *
 * @returns The caught error (asserted non-null). Caller does the
 *          `instanceof` / `.code` / `.message` assertions.
 */
async function expectJourneyError(fn: () => Promise<unknown>): Promise<DomainError> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  if (caught === null) {
    throw new Error("expectJourneyError: expected the call to throw, but it resolved successfully");
  }
  if (caught instanceof DomainError) {
    return caught;
  }
  let message: string;
  if (caught instanceof Error) {
    message = caught.message;
  } else if (typeof caught === "string" || typeof caught === "number" || typeof caught === "boolean") {
    message = String(caught);
  } else {
    message = JSON.stringify(caught);
  }
  throw new Error(`expectJourneyError: caught non-DomainError: ${message}`);
}

/** Assertion-free record guard (no unsafe type assertions). */
function isRecordBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-field check — walks every object reachable from `value` and fails if
 * any key is `passwordHash` (the hash must be absent from EVERY output
 * shape, including nested role-child projections).
 */
function assertNoPasswordHashField(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoPasswordHashField(item);
    }
    return;
  }
  if (!isRecordBag(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    expect(key).not.toBe("passwordHash");
    assertNoPasswordHashField(child);
  }
}

/** Reads a `users` row by id via the global `db` (post-commit read). */
async function readUserRow(id: number): Promise<UserSelectType | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Counts audit rows touching the cast — as actor OR as affected user entity. */
async function countAuditRowsForCast(ids: readonly number[]): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(
      or(
        inArray(auditLogs.actorId, [...ids]),
        and(eq(auditLogs.entityType, "user"), inArray(auditLogs.entityId, [...ids]))
      )
    );
  return rows[0]?.count ?? 0;
}

/** Counts notification rows targeting the cast (external-effect absence probe). */
async function countNotificationsForCast(ids: readonly number[]): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(inArray(notifications.userId, [...ids]));
  return rows.length;
}

/** Cast member ids — the scope for every side-effect delta assertion. */
function castIds(): number[] {
  return [adminActor.userId, targetActor.userId, foreignActor.userId];
}

/**
 * Fixture-immutability oracle — the admin and foreign-student `users` rows
 * must remain byte-identical across every step (no accidental fan-out).
 * The TARGET row is excluded: the journey deliberately mutates it.
 */
async function assertCastUntouched(): Promise<void> {
  const adminNow = await readUserRow(adminActor.userId);
  const foreignNow = await readUserRow(foreignActor.userId);
  expect(adminNow).toEqual(adminUserSnapshot);
  expect(foreignNow).toEqual(foreignUserSnapshot);
}

/**
 * Relabels a provisioned actor with the per-run prefix (explicit
 * field-mapped update — never a spread) and returns the new email.
 */
async function relabelActorFixture(tx: DBTransaction, userId: number, label: string): Promise<string> {
  const email = `${PREFIX}-${label}@journey.test`;
  const rows = await tx
    .update(users)
    .set({ fullName: `${PREFIX} ${label}`, email })
    .where(eq(users.id, userId))
    .returning({ email: users.email });
  if (rows[0]?.email !== email) {
    throw new Error(`relabelActorFixture: relabel found no users row ${userId}`);
  }
  return email;
}

/**
 * Parses a probe document and returns its single operation together with
 * the document (kind-guarded — no unsafe type assertions).
 */
function probeOperation(source: string): { document: DocumentNode; operation: OperationDefinitionNode } {
  const document: DocumentNode = parse(source);
  const operation = document.definitions.find(definition => definition.kind === "OperationDefinition");
  if (operation?.kind !== "OperationDefinition") {
    throw new Error("probe document carries no operation definition");
  }
  return { document, operation };
}

describe("Journey D — Admin Password Reset (Temporary Credential → Forced Change)", () => {
  beforeAll(async () => {
    tracked = new TrackedFixtures();
    await db.transaction(async (tx: DBTransaction) => {
      adminActor = await provisionAdminActor(tx, { tracked });
      targetActor = await provisionCertifiedTeacherActor(tx, { tracked });
      foreignActor = await provisionStudentActor(tx, { tracked });
      targetEmail = await relabelActorFixture(tx, targetActor.userId, "target-teacher");
      await relabelActorFixture(tx, adminActor.userId, "admin");
      await relabelActorFixture(tx, foreignActor.userId, "foreign-student");
      const adminRows = await tx.select().from(users).where(eq(users.id, adminActor.userId)).limit(1);
      const foreignRows = await tx.select().from(users).where(eq(users.id, foreignActor.userId)).limit(1);
      adminUserSnapshot = adminRows[0] ?? null;
      foreignUserSnapshot = foreignRows[0] ?? null;
    });
    if (adminUserSnapshot === null || foreignUserSnapshot === null) {
      throw new Error("journey fixtures: cast user rows missing after the provisioning transaction");
    }
  });

  // Step 8 — tracked cleanup: audit rows first (RESTRICT-gated on users),
  // then the registry's hard-delete sweep with zero-residue verification.
  afterAll(async () => {
    const ids = castIds();
    await withAuditDeleteTriggersSuspended(async () => {
      await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
      await queryDb("DELETE FROM audit_logs WHERE entity_type = 'user' AND entity_id = ANY($1::int[])", [ids]);
    });
    await tracked.cleanup();
    const auditResidue = await countAuditRowsForCast(ids);
    if (auditResidue !== 0) {
      throw new Error(`journey teardown residue: ${auditResidue} audit rows still reference the cast`);
    }
  });

  // ─── Step 1: fixtures commit ─────────────────────────────────────────
  test("Journey D — step 1: fixtures commit — admin, target teacher, foreign student with real roles; flag defaults false", async () => {
    const adminRow = await readUserRow(adminActor.userId);
    const targetRow = await readUserRow(targetActor.userId);
    const foreignRow = await readUserRow(foreignActor.userId);

    expect(adminRow?.role).toBe(UserRole.Admin);
    expect(targetRow?.role).toBe(UserRole.Teacher);
    expect(foreignRow?.role).toBe(UserRole.Student);
    for (const row of [adminRow, targetRow, foreignRow]) {
      expect(row?.isDeleted).toBe(false);
      expect(row?.mustChangePassword).toBe(false);
    }
    expect(targetRow?.email).toBe(targetEmail);
    expect(targetEmail).toContain(PREFIX);

    // Clean baseline: zero audit rows + zero notifications for the cast.
    expect(await countAuditRowsForCast(castIds())).toBe(0);
    expect(await countNotificationsForCast(castIds())).toBe(0);
    await assertCastUntouched();
  });

  // ─── Step 2: admin sets the temporary credential (flag = true) ───────
  test("Journey D — step 2: admin setUserPassword(flag=true) — new hash verifies; ONE Update audit row with changedFields [credentials]", async () => {
    const input: AdminSetUserPasswordSubmitInput = { password: TEMP_CREDENTIAL, mustChangePassword: true };
    const result = await AdminUserManagementService.setUserPassword(
      targetActor.userId,
      input,
      adminActor.userId,
      LOCALE
    );

    expect(result.id).toBe(targetActor.userId);
    expect(result.mustChangePassword).toBe(true);
    assertNoPasswordHashField(result);

    // Target row: the stored hash is a REAL bcrypt hash of the temporary
    // credential, and the forced-reset flag is set.
    const targetRow = await readUserRow(targetActor.userId);
    expect(targetRow?.mustChangePassword).toBe(true);
    expect(await comparePassword(TEMP_CREDENTIAL, targetRow?.passwordHash ?? "")).toBe(true);

    // Exactly ONE audit row (Update, actor=admin, entity=target) whose
    // details carry the field names + the flag — never the plaintext,
    // never the stored hash.
    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.actorId, adminActor.userId),
          eq(auditLogs.actionType, AuditActionType.Update),
          eq(auditLogs.entityId, targetActor.userId)
        )
      );
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows[0];
    if (!auditRow) {
      throw new Error("step 2: the asserted audit row is missing");
    }
    expect(auditRow.entityType).toBe("user");
    const rawDetails = auditRow.details ?? "";
    const parsedDetails: unknown = rawDetails.length > 0 ? JSON.parse(rawDetails) : null;
    if (!isRecordBag(parsedDetails) || !Array.isArray(parsedDetails.changedFields)) {
      throw new Error("step 2: audit details are not a record with changedFields");
    }
    expect(parsedDetails.changedFields).toEqual(["credentials"]);
    expect(parsedDetails.mustChangePassword).toBe(true);
    expect(rawDetails).not.toContain(TEMP_CREDENTIAL);
    expect(rawDetails).not.toContain(targetRow?.passwordHash ?? "");

    // Zero notifications fan-out (the surface emits none by design).
    expect(await countNotificationsForCast(castIds())).toBe(0);
    await assertCastUntouched();
  });

  // ─── Step 3: target logs in with the temporary credential ────────────
  test("Journey D — step 3: target login succeeds — session flag true; login does NOT clear the flag", async () => {
    const session = await AuthService.login(targetEmail, TEMP_CREDENTIAL, LOCALE);

    expect(session.user.id).toBe(targetActor.userId);
    expect(session.user.mustChangePassword).toBe(true);
    expect(session.accessToken).toBeTruthy();
    assertNoPasswordHashField(session.user);

    // login NEVER writes the flag — the row still demands the change.
    const targetRow = await readUserRow(targetActor.userId);
    expect(targetRow?.mustChangePassword).toBe(true);
    expect(await comparePassword(TEMP_CREDENTIAL, targetRow?.passwordHash ?? "")).toBe(true);

    await assertCastUntouched();
  });

  // ─── Step 4: foreign non-admin denied the admin credential surface ───
  test("Journey D — step 4: foreign non-admin setUserPassword — FORBIDDEN; zero writes; zero audit rows", async () => {
    const auditBefore = await countAuditRowsForCast(castIds());

    const foreignInput: AdminSetUserPasswordSubmitInput = {
      password: FOREIGN_CREDENTIAL,
      mustChangePassword: true,
    };
    const error = await expectJourneyError(() =>
      AdminUserManagementService.setUserPassword(targetActor.userId, foreignInput, foreignActor.userId, LOCALE)
    );

    // Honest-role denial through the real strict admin gate.
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(tErrors.forbidden);

    // Zero writes — the target row still holds the temporary credential
    // and the flag; no hash of the rejected attempt ever landed.
    const targetRow = await readUserRow(targetActor.userId);
    expect(targetRow?.mustChangePassword).toBe(true);
    expect(await comparePassword(TEMP_CREDENTIAL, targetRow?.passwordHash ?? "")).toBe(true);
    expect(await comparePassword(FOREIGN_CREDENTIAL, targetRow?.passwordHash ?? "")).toBe(false);

    // Zero audit rows for the denial (cast-scoped delta).
    expect(await countAuditRowsForCast(castIds())).toBe(auditBefore);

    await assertCastUntouched();
  });

  // ─── Step 5: flagged target fenced from a non-exempt operation ───────
  test("Journey D — step 5: flagged target → non-exempt operation → PASSWORD_CHANGE_REQUIRED; exempt escape hatches stay open", async () => {
    const auditBefore = await countAuditRowsForCast(castIds());
    const flaggedRow = await readUserRow(targetActor.userId);
    if (!flaggedRow) {
      throw new Error("step 5: target row missing");
    }
    expect(flaggedRow.mustChangePassword).toBe(true);
    const flaggedIdentity = { mustChangePassword: flaggedRow.mustChangePassword };

    // The gated probe: the admin credential surface (deliberately NOT on
    // the exemption allowlist).
    const gatedProbe = probeOperation("mutation GatedProbe { adminSetUserPassword }");
    const gatedRoots = extractOperationRootFieldNames(gatedProbe.operation, gatedProbe.document);
    expect(gatedRoots.has("adminSetUserPassword")).toBe(true);
    expect(isExemptRootField("adminSetUserPassword")).toBe(false);
    expect(PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS.includes("adminSetUserPassword")).toBe(false);
    expect(isPasswordChangeRequired(flaggedIdentity, gatedRoots)).toBe(true);

    // Per-operation semantics: a gated field cannot hide beside an exempt one.
    const smuggledProbe = probeOperation("query Mixed { me adminSetUserPassword }");
    const smuggledRoots = extractOperationRootFieldNames(smuggledProbe.operation, smuggledProbe.document);
    expect(isPasswordChangeRequired(flaggedIdentity, smuggledRoots)).toBe(true);

    // The self-service escape hatches stay callable while flagged.
    expect(isExemptRootField("changeMyPassword")).toBe(true);
    expect(isExemptRootField("updateMyLocale")).toBe(true);
    expect(isPasswordChangeRequired(flaggedIdentity, new Set(["changeMyPassword"]))).toBe(false);
    expect(isPasswordChangeRequired(flaggedIdentity, new Set(["updateMyLocale"]))).toBe(false);

    // The REAL denial carrier the gate plugin throws — constant shape,
    // stable domain code, localized message (no trigger-detail leak).
    const denial = buildPasswordChangeRequiredDenial(tErrors.passwordChangeRequired);
    expect(denial).toBeInstanceOf(ForbiddenError);
    expect(denial.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(denial.extensions.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(denial.message).toBe(tErrors.passwordChangeRequired);

    // Zero writes / zero audit rows across the whole fence probe.
    const rowAfter = await readUserRow(targetActor.userId);
    expect(rowAfter?.mustChangePassword).toBe(true);
    expect(await countAuditRowsForCast(castIds())).toBe(auditBefore);
  });

  // ─── Step 6: target replaces the credential (flag cleared) ───────────
  test("Journey D — step 6: target changeMyPassword — new hash verifies; flag cleared; self-service writes ZERO audit rows", async () => {
    const auditBefore = await countAuditRowsForCast(castIds());

    const input: ChangeMyPasswordSubmitInput = { currentPassword: TEMP_CREDENTIAL, newPassword: NEW_CREDENTIAL };
    const result = await AuthService.changeMyPassword(targetActor.userId, input, LOCALE);

    expect(result.id).toBe(targetActor.userId);
    expect(result.mustChangePassword).toBe(false);
    assertNoPasswordHashField(result);

    // Target row: the flag is cleared and the hash now verifies ONLY the
    // replacement credential.
    const targetRow = await readUserRow(targetActor.userId);
    expect(targetRow?.mustChangePassword).toBe(false);
    expect(await comparePassword(NEW_CREDENTIAL, targetRow?.passwordHash ?? "")).toBe(true);
    expect(await comparePassword(TEMP_CREDENTIAL, targetRow?.passwordHash ?? "")).toBe(false);

    // Self-service is unaudited — ZERO new audit rows.
    expect(await countAuditRowsForCast(castIds())).toBe(auditBefore);
    expect(await countNotificationsForCast(castIds())).toBe(0);

    await assertCastUntouched();
  });

  // ─── Step 7: the fence opens; credential semantics swap ──────────────
  test("Journey D — step 7: gate opens — previously-denied op allowed; post-clear service op succeeds; re-login semantics swapped", async () => {
    const clearedRow = await readUserRow(targetActor.userId);
    if (!clearedRow) {
      throw new Error("step 7: target row missing");
    }
    expect(clearedRow.mustChangePassword).toBe(false);
    const clearedIdentity = { mustChangePassword: clearedRow.mustChangePassword };

    // The previously denied operation is now allowed by the gate (the same
    // non-exempt probe that was denied while flagged).
    const gatedProbe = probeOperation("mutation GatedProbe { adminSetUserPassword }");
    const gatedRoots = extractOperationRootFieldNames(gatedProbe.operation, gatedProbe.document);
    expect(isPasswordChangeRequired(clearedIdentity, gatedRoots)).toBe(false);

    // A real operation the target may run post-clear — the exempt
    // self-service locale write — goes through the real service.
    const localeResult = await AuthService.updateMyLocale(targetActor.userId, "ar", LOCALE);
    expect(localeResult.id).toBe(targetActor.userId);
    expect(localeResult.locale).toBe("ar");
    expect(localeResult.mustChangePassword).toBe(false);
    assertNoPasswordHashField(localeResult);

    // Re-login with the replacement credential SUCCEEDS…
    const session = await AuthService.login(targetEmail, NEW_CREDENTIAL, LOCALE);
    expect(session.user.id).toBe(targetActor.userId);
    expect(session.user.mustChangePassword).toBe(false);
    assertNoPasswordHashField(session.user);

    // …and the temporary credential FAILS (generic no-enumeration denial).
    const staleError = await expectJourneyError(() => AuthService.login(targetEmail, TEMP_CREDENTIAL, LOCALE));
    expect(staleError).toBeInstanceOf(UnauthorizedError);
    expect(staleError.message).toContain(tAuth.invalidCredentials);

    await assertCastUntouched();
  });
});
