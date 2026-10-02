/**
 * Registration types — public + internal DTOs for user registration.
 *
 * Design:
 *  - `RegistrationSubmitInput` is the **public** contract submitted by the
 *    register form. It structurally omits `id`, governance fields
 *    (`isDeleted`, `suspended`, `isBlocked`, …), balances, and the
 *    server-generated `handshakeCode` so mass-assignment (BOPLA) is impossible
 *    at the type level.
 *  - `RegisterPublicRole` is the role subset reachable from the public
 *    mutation: `student | teacher | parent`. `admin` is intentionally absent
 *    (BFLA defense): admin child rows are only created through the
 *    privileged `RegistrationService.createAdminUser` entry point used by
 *    the admin-onboarding flow.
 *  - `RegistrationReturnType` is the service return shape — `UserSelectType`
 *    with `passwordHash` stripped, so the plaintext hash can never leak to a
 *    resolver or response.
 *  - `AdminRegistrationSubmitInput` is the service-only variant permitting
 *    `role: "admin"`. It MUST NOT be referenced by any Pothos input type.
 */
import type { Gender } from "@/backend/enum/users/gender.enum";
import type { UserSelectType } from "@/backend/types/users/user.types";
import type { RecitationReading } from "@/shared/constants/recitation-reading.enum";

/**
 * Roles reachable from the public registration mutation.
 *
 * Excludes `"admin"` — admin child rows are only created via the privileged
 * `RegistrationService.createAdminUser` service entry point.
 */
export type RegisterPublicRole = "student" | "teacher" | "parent";

/**
 * Public registration input contract.
 *
 * Field whitelist (BOPLA): only client-supplied fields appear here.
 * `id`, `handshakeCode`, `balance*`, `isDeleted`, `suspended`, `isBlocked`,
 * `deletedAt`, `blockedAt`, `suspendedAt`, `suspendedPeriodDays`,
 * `lastActiveAt`, `createdAt`, `updatedAt` are all server-controlled and
 * structurally absent from this type.
 */
export interface RegistrationSubmitInput {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly password: string;
  readonly gender?: Gender;
  /**
   * ISO 3166-1 alpha-2 country code (e.g. "EG"). Wire-typed as the
   * `CountryCode` scalar; kept as `string` at this service boundary because
   * the scalar resolves to a string. The service normalizes and
   * membership-checks the value before persistence.
   */
  readonly country: string;
  readonly role: RegisterPublicRole;
  /**
   * Optional preferred recitation reading (Qira'ah).
   *
   * Validated against the canonical recitation catalog before any DB work.
   * NOT persisted to the `recitation` table — that table is session-linked
   * (1:1 with `session`). This field is contract metadata only until a
   * user-preference home exists.
   */
  readonly preferredRecitation?: RecitationReading | null;
}

/**
 * Internal registration input variant permitting `role: "admin"`.
 *
 * Service-only — used by `RegistrationService.createAdminUser` for the
 * privileged admin-onboarding path. NOT exposed via any Pothos input
 * type (the public mutation rejects `role: "admin"` via the
 * `RegisterPublicRolePothosEnum`).
 */
export interface AdminRegistrationSubmitInput {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly password: string;
  readonly gender?: Gender;
  /**
   * ISO 3166-1 alpha-2 country code (e.g. "EG"). Wire-typed as the
   * `CountryCode` scalar (shared admin-create input); kept as `string` at
   * this service boundary because the scalar resolves to a string. The
   * service normalizes and membership-checks the value before persistence.
   */
  readonly country: string;
  readonly role: "admin";
  /** Optional preferred recitation reading (not persisted to `recitation`, same as public input). */
  readonly preferredRecitation?: RecitationReading | null;
}

/**
 * Service return shape for registration.
 *
 * `passwordHash` is structurally omitted from `UserSelectType` so the hash can
 * never leak to a resolver payload, log, or GraphQL response. The
 * `role` field is the `userRole` pgEnum value union ("admin" | "teacher" |
 * "student" | "parent") — runtime-equivalent to the `UserRole` TS enum but
 * typed as a string literal union (Drizzle's `$inferSelect` produces this
 * shape from `pgEnum`).
 *
 * `preferredRecitation` echoes the validated selection (contract metadata —
 * not persisted to `recitation`). `null` when no selection was made.
 */
export type RegistrationReturnType = Omit<UserSelectType, "passwordHash"> & {
  readonly preferredRecitation: RecitationReading | null;
};

/**
 * Exact result shape of the read-only registered-user email lookup
 * (`RegistrationService.findRegisteredUserByEmail`) — the seed-layer
 * bootstrap contract for look-before-create flows.
 *
 * Deliberately NOT `RegistrationReturnType`: the lookup never needs the
 * full user row, only identity + role. `role` is derived from
 * `UserSelectType` so it tracks the `user_role` pgEnum value union
 * ("admin" | "teacher" | "student" | "parent") without re-declaring the
 * literals here.
 */
export type RegisteredUserLookupResult = {
  readonly id: number;
  readonly email: string;
  readonly role: UserSelectType["role"];
};
