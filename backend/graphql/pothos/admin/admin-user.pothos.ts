/**
 * Admin user GraphQL objects — directory row, page envelope, detail, and
 * role-child snapshot projections for the admin user-management surface.
 *
 * Every object is backed by a canonical type from `backend/types/admin/`:
 *  - `AdminUserListItem` ← `AdminUserListItemReturnType`
 *  - `AdminUserPage` ← `AdminUserPageReturnType`
 *  - `AdminUserDetail` ← `AdminUserDetailReturnType`
 *  - `AdminUserStats` ← `AdminUserStatsReturnType`
 *  - `AdminUserActivityEntry` ← `AdminUserActivityEntryReturnType`
 *  - `AdminTeacherSnapshot` ← `AdminTeacherSnapshotReturnType`
 *  - `AdminStudentSnapshot` ← `AdminStudentSnapshotReturnType`
 *  - `AdminParentSnapshot` ← `AdminParentSnapshotReturnType`
 *
 * The `applicant` field on `AdminUserDetail` reuses the canonical
 * `ApplicantProfilePothosObject` — never re-declared here.
 *
 * `passwordHash` is structurally absent from every shape (composed via
 * `Omit<UserSelectType, "passwordHash">` at the canonical-type layer);
 * Pothos exposes only the fields on the underlying type, so the hash is
 * unreachable.
 *
 * Per `backend/graphql/pothos/AGENTS.md`:
 *  - NO local type definitions — all shapes come from `backend/types/**`.
 *  - `id` is exposed FIRST on every object (Int) so Apollo cache
 *    normalization keys consistently.
 *  - Enums are imported from the shared enum registry — never re-registered.
 */
import { isApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  AdminUserGovernanceFilterPothosEnum,
  ApplicantCooldownStatePothosEnum,
  ApplicantStatusPothosEnum,
  AuditActionTypePothosEnum,
  GenderPothosEnum,
  UserRolePothosEnum,
} from "@/backend/graphql/pothos/shared/enum.pothos";
import {
  adminUserStatsFields,
  nullableUserGenderField,
  userRegistrationInputFields,
  userRoleField,
} from "@/backend/graphql/pothos/shared/userFieldHelpers";
import { ApplicantProfilePothosObject } from "@/backend/graphql/pothos/teachers/applicant.pothos";
import type {
  AdminCooldownLifecycleStatsReturnType,
  AdminParentSnapshotReturnType,
  AdminStudentSnapshotReturnType,
  AdminTeacherSnapshotReturnType,
  AdminUserActivityEntryReturnType,
  AdminUserCountryBreakdownReturnType,
  AdminUserCountryBucketReturnType,
  AdminUserDetailReturnType,
  AdminUserListItemReturnType,
  AdminUserPageReturnType,
  AdminUserStatsReturnType,
} from "@/backend/types";

/**
 * `AdminUserListItem` — one directory row. Exposes the safe `users` columns
 * plus the role-child status headline. `role` is mapped from the raw pgEnum
 * string to the `UserRole` TS enum via `toUserRole` (fail-closed on corrupt
 * stored values — surfaces as a resolver error rather than an unsafe cast).
 */
const AdminUserListItemPothosObject = gqlSchemaBuilder
  .objectRef<AdminUserListItemReturnType>("AdminUserListItem")
  .implement({
    fields: t => ({
      id: t.exposeInt("id"),
      fullName: t.exposeString("fullName"),
      email: t.exposeString("email"),
      phone: t.exposeString("phone", { nullable: true }),
      role: userRoleField(t),
      country: t.exposeString("country", { nullable: true }),
      gender: nullableUserGenderField(t),
      dateOfBirth: t.exposeString("dateOfBirth", { nullable: true }),
      isDeleted: t.field({ type: "Boolean", resolve: parent => parent.isDeleted }),
      suspended: t.field({ type: "Boolean", resolve: parent => parent.suspended }),
      isBlocked: t.field({ type: "Boolean", resolve: parent => parent.isBlocked }),
      lastActiveAt: t.field({
        type: "String",
        nullable: true,
        resolve: parent => (parent.lastActiveAt ? parent.lastActiveAt.toISOString() : null),
      }),
      createdAt: t.field({
        type: "String",
        resolve: parent => parent.createdAt.toISOString(),
      }),
      applicantStatus: t.field({
        type: ApplicantStatusPothosEnum,
        nullable: true,
        resolve: parent => {
          if (!parent.applicantStatus) return null;
          if (!isApplicantStatus(parent.applicantStatus)) {
            throw new Error(`Unexpected applicant status: ${String(parent.applicantStatus)}`);
          }
          return parent.applicantStatus;
        },
      }),
      /**
       * Read-time cooldown observables (both null for non-applicant rows).
       * `cooldownState` reuses the registered `ApplicantCooldownState` enum;
       * `cooldownUntil` is the raw ISO instant the client shows as the
       * chip's native tooltip. Read-only surface — no mutation targets the
       * directory row shape.
       */
      cooldownState: t.field({
        type: ApplicantCooldownStatePothosEnum,
        nullable: true,
        resolve: parent => parent.cooldownState,
      }),
      cooldownUntil: t.field({
        type: "String",
        nullable: true,
        resolve: parent => (parent.cooldownUntil ? parent.cooldownUntil.toISOString() : null),
      }),
      teacherIsApproved: t.exposeBoolean("teacherIsApproved", { nullable: true }),
      teacherIsEvaluator: t.exposeBoolean("teacherIsEvaluator", { nullable: true }),
      studentHasParentLink: t.exposeBoolean("studentHasParentLink", { nullable: true }),
      studentHasActiveSubscription: t.exposeBoolean("studentHasActiveSubscription", { nullable: true }),
      parentLinkedChildrenCount: t.exposeInt("parentLinkedChildrenCount", { nullable: true }),
    }),
  });

/**
 * `AdminUserPage` — paginated directory envelope. Echoes `page` + `pageSize`
 * so callers can normalize client-side pagination state; an out-of-range page
 * yields an empty `items` array with the honest `totalCount` (never clamped,
 * never an error).
 */
export const AdminUserPagePothosObject = gqlSchemaBuilder
  .objectRef<AdminUserPageReturnType>("AdminUserPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [AdminUserListItemPothosObject],
        resolve: parent => parent.items,
      }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });

/**
 * `AdminUserStats` — directory-wide aggregate counters for the admin
 * overview strip. Pure read (no `id` — the shape is a single scalar-only
 * envelope the Apollo cache never normalizes as an entity list). Backed
 * by the canonical `AdminUserStatsReturnType`.
 */
export const AdminUserStatsPothosObject = gqlSchemaBuilder
  .objectRef<AdminUserStatsReturnType>("AdminUserStats")
  .implement({
    fields: t => ({ ...adminUserStatsFields(t) }),
  });

/**
 * `AdminApplicantCooldownStats` — the applicant-cooldown LIFECYCLE counters
 * for the admin dashboard panel. A deliberately SEPARATE wire shape from
 * `AdminUserStats` (whose members are user-population counters shared with
 * platform analytics through `adminUserStatsFields`): the cooldown lifecycle
 * is its own concept with its own vocabulary, so it gets its own scalar-only
 * envelope instead of widening the shared population-counter helper. Pure
 * read (no `id` — nothing to normalize), backed by the canonical
 * `AdminCooldownLifecycleStatsReturnType` via `getCooldownLifecycleStats`.
 */
export const AdminApplicantCooldownStatsPothosObject = gqlSchemaBuilder
  .objectRef<AdminCooldownLifecycleStatsReturnType>("AdminApplicantCooldownStats")
  .implement({
    fields: t => ({
      activeCount: t.exposeInt("activeCount"),
      expiringSoonCount: t.exposeInt("expiringSoonCount"),
      expiredCount: t.exposeInt("expiredCount"),
      /** The window length the expiringSoon bucket was measured with — echoed so label copy cannot drift. */
      expiringSoonWindowDays: t.exposeInt("expiringSoonWindowDays"),
    }),
  });

/**
 * `AdminUserCountryBucket` — one entry of the directory's "users by
 * country" distribution facet. `code` is the canonical ISO 3166-1 alpha-2
 * code (the SAME vocabulary the `?country=` deep link speaks — a chip
 * click writes exactly this value into the URL contract); `label` is the
 * LOCALE-resolved dataset display name and `flag` the dataset's
 * regional-indicator emoji, so the facet, the directory chips, and the
 * broadcast audience summary render one country vocabulary. Backed by the
 * canonical `AdminUserCountryBucketReturnType`.
 */
const AdminUserCountryBucketPothosObject = gqlSchemaBuilder
  .objectRef<AdminUserCountryBucketReturnType>("AdminUserCountryBucket")
  .implement({
    fields: t => ({
      code: t.exposeString("code"),
      label: t.exposeString("label"),
      flag: t.exposeString("flag"),
      count: t.exposeInt("count"),
    }),
  });

/**
 * `AdminUserCountryBreakdown` — the "users by country" distribution
 * envelope for the admin directory facet. Pure read (no `id` — a
 * scalar-only envelope the Apollo cache never normalizes as an entity,
 * same posture as `AdminUserStats`). `buckets` carries the top-N
 * dataset-resolvable populations (count-desc, code-asc — SQL-owned
 * determinism); `unresolvedCount` is the honest remainder (NULL-code
 * legacy/never-set rows + out-of-vocabulary codes) that the facet renders
 * as a muted caption so chips + caption always account for the whole
 * active population. Backed by the canonical
 * `AdminUserCountryBreakdownReturnType` via
 * `AdminUserManagementService.getCountryBreakdown`.
 */
export const AdminUserCountryBreakdownPothosObject = gqlSchemaBuilder
  .objectRef<AdminUserCountryBreakdownReturnType>("AdminUserCountryBreakdown")
  .implement({
    fields: t => ({
      buckets: t.field({
        type: [AdminUserCountryBucketPothosObject],
        resolve: root => root.buckets,
      }),
      unresolvedCount: t.exposeInt("unresolvedCount"),
    }),
  });

/**
 * `AdminUserActivityEntry` — one row of the per-user "recent activity"
 * timeline on the admin detail page (scoped `audit_logs` read-back:
 * actions recorded ABOUT this user — account rows plus the user's
 * teacher-applicant lifecycle rows — newest-first). `entityType`
 * discriminates the mixed feed ("user" vs "applicant") so the client can
 * tag applicant entries. `caption` is the server-composed localized
 * rendering of the details payload for the applicant lifecycle rows (the
 * raw `details` JSON itself is NOT exposed — BOPLA on read-back). Backed
 * by the canonical `AdminUserActivityEntryReturnType`.
 */
export const AdminUserActivityEntryPothosObject = gqlSchemaBuilder
  .objectRef<AdminUserActivityEntryReturnType>("AdminUserActivityEntry")
  .implement({
    fields: t => ({
      id: t.exposeInt("id"),
      actionType: t.expose("actionType", { type: AuditActionTypePothosEnum }),
      entityType: t.exposeString("entityType"),
      caption: t.exposeString("caption", { nullable: true }),
      actorName: t.exposeString("actorName"),
      changedFields: t.field({
        type: ["String"],
        nullable: true,
        resolve: parent => (parent.changedFields ? [...parent.changedFields] : null),
      }),
      createdAt: t.field({
        type: "String",
        resolve: parent => parent.createdAt.toISOString(),
      }),
    }),
  });

/**
 * `AdminTeacherSnapshot` — read-only projection of the `teacher` child row
 * when one exists. Teacher-applicants (no `teacher` row yet) yield `null` at
 * the detail composition site.
 */
const AdminTeacherSnapshotPothosObject = gqlSchemaBuilder
  .objectRef<AdminTeacherSnapshotReturnType>("AdminTeacherSnapshot")
  .implement({
    fields: t => ({
      isApproved: t.field({ type: "Boolean", resolve: parent => parent.isApproved }),
      isEvaluator: t.field({ type: "Boolean", resolve: parent => parent.isEvaluator }),
      isOnline: t.field({ type: "Boolean", resolve: parent => parent.isOnline }),
      averageRating: t.exposeString("averageRating", { nullable: true }),
    }),
  });

/**
 * `AdminStudentSnapshot` — read-only projection of the `students` child row.
 * Balance fields are pure reads; this surface ships NO mutation that touches
 * them.
 */
const AdminStudentSnapshotPothosObject = gqlSchemaBuilder
  .objectRef<AdminStudentSnapshotReturnType>("AdminStudentSnapshot")
  .implement({
    fields: t => ({
      handshakeCode: t.exposeString("handshakeCode"),
      parentId: t.exposeInt("parentId", { nullable: true }),
      primaryLanguage: t.exposeString("primaryLanguage", { nullable: true }),
      anotherLanguage: t.exposeString("anotherLanguage", { nullable: true }),
      hasParentLink: t.field({ type: "Boolean", resolve: parent => parent.hasParentLink }),
      hasActiveSubscription: t.field({ type: "Boolean", resolve: parent => parent.hasActiveSubscription }),
      balanceHifz: t.exposeInt("balanceHifz", { nullable: true }),
      balanceTajweed: t.exposeInt("balanceTajweed", { nullable: true }),
      balanceReviews: t.exposeInt("balanceReviews", { nullable: true }),
      balanceTrial: t.exposeInt("balanceTrial", { nullable: true }),
      trialGrantedAt: t.field({
        type: "String",
        nullable: true,
        resolve: parent => (parent.trialGrantedAt ? parent.trialGrantedAt.toISOString() : null),
      }),
    }),
  });

/**
 * `AdminParentSnapshot` — read-only projection of the `parents` child row.
 * The headline is the linked-children count.
 */
const AdminParentSnapshotPothosObject = gqlSchemaBuilder
  .objectRef<AdminParentSnapshotReturnType>("AdminParentSnapshot")
  .implement({
    fields: t => ({
      linkedChildrenCount: t.exposeInt("linkedChildrenCount"),
    }),
  });

/**
 * `AdminUserDetail` — full profile plus resolved role-child state. Extends
 * the safe `users` shape; the role-child slots are independently nullable.
 * The `applicant` slot reuses the canonical `ApplicantProfilePothosObject`
 * (composition-only — never re-declared).
 */
export const AdminUserDetailPothosObject = gqlSchemaBuilder
  .objectRef<AdminUserDetailReturnType>("AdminUserDetail")
  .implement({
    fields: t => ({
      id: t.exposeInt("id"),
      fullName: t.exposeString("fullName"),
      email: t.exposeString("email"),
      phone: t.exposeString("phone", { nullable: true }),
      role: userRoleField(t),
      dateOfBirth: t.exposeString("dateOfBirth", { nullable: true }),
      gender: nullableUserGenderField(t),
      country: t.exposeString("country", { nullable: true }),
      isDeleted: t.field({ type: "Boolean", nullable: true, resolve: parent => parent.isDeleted ?? false }),
      deletedAt: t.field({
        type: "String",
        nullable: true,
        resolve: parent => (parent.deletedAt ? parent.deletedAt.toISOString() : null),
      }),
      suspended: t.field({ type: "Boolean", nullable: true, resolve: parent => parent.suspended ?? false }),
      suspendedAt: t.field({
        type: "String",
        nullable: true,
        resolve: parent => (parent.suspendedAt ? parent.suspendedAt.toISOString() : null),
      }),
      suspendedPeriodDays: t.exposeInt("suspendedPeriodDays", { nullable: true }),
      isBlocked: t.field({ type: "Boolean", nullable: true, resolve: parent => parent.isBlocked ?? false }),
      blockedAt: t.field({
        type: "String",
        nullable: true,
        resolve: parent => (parent.blockedAt ? parent.blockedAt.toISOString() : null),
      }),
      lastActiveAt: t.field({
        type: "String",
        nullable: true,
        resolve: parent => (parent.lastActiveAt ? parent.lastActiveAt.toISOString() : null),
      }),
      createdAt: t.field({
        type: "String",
        resolve: parent => parent.createdAt.toISOString(),
      }),
      updatedAt: t.field({
        type: "String",
        resolve: parent => parent.updatedAt.toISOString(),
      }),
      applicant: t.field({
        type: ApplicantProfilePothosObject,
        nullable: true,
        resolve: parent => parent.applicant,
      }),
      teacher: t.field({
        type: AdminTeacherSnapshotPothosObject,
        nullable: true,
        resolve: parent => parent.teacher,
      }),
      student: t.field({
        type: AdminStudentSnapshotPothosObject,
        nullable: true,
        resolve: parent => parent.student,
      }),
      parent: t.field({
        type: AdminParentSnapshotPothosObject,
        nullable: true,
        resolve: parent => parent.parent,
      }),
    }),
  });

/**
 * `AdminUserFiltersInput` — independent ANDed filters for the directory
 * listing. Absent or `null` members drop out at the service layer; a
 * transport-tampered `governance` value that is not a recognized enum member
 * fails GraphQL input validation before any resolver runs. The two
 * applicant-lifecycle members reuse the SAME registered wire enums the
 * directory rows expose (`ApplicantStatus` / `ApplicantCooldownState`) —
 * one vocabulary per domain concept, filter and display cannot drift.
 */
export const AdminUserFiltersInput = gqlSchemaBuilder.inputType("AdminUserFiltersInput", {
  fields: t => ({
    role: t.field({ type: UserRolePothosEnum, required: false }),
    governance: t.field({ type: AdminUserGovernanceFilterPothosEnum, required: false }),
    country: t.string({ required: false }),
    search: t.string({ required: false }),
    applicantStatus: t.field({ type: ApplicantStatusPothosEnum, required: false }),
    cooldownState: t.field({ type: ApplicantCooldownStatePothosEnum, required: false }),
    /**
     * Time-window narrow for the cooldown lifecycle — `true` restricts the
     * listing to applicants whose stamped cooldown expires within the
     * canonical `COOLDOWN_EXPIRING_SOON_DAYS` window (the SAME constant the
     * dashboard lifecycle panel's `expiringSoonCount` counts with, so the
     * KPI and its deep-linked listing cannot disagree). A plain nullable
     * Boolean (NOT an enum member): the window LENGTH is a product constant,
     * not a wire value, so the closed-whitelist discipline stays intact —
     * the only client-expressible choices are "applied" (`true`) and
     * "absent" (null/false → dropped per the forgiving read rule).
     */
    cooldownExpiringSoon: t.boolean({ required: false }),
  }),
});

/**
 * `AdminCreateUserInput` — closed whitelist mirroring the public registration
 * shape minus server-controlled fields. `role` uses
 * `RegisterPublicRolePothosEnum` (student/teacher/parent — `admin`
 * structurally excluded at the schema layer; BFLA).
 */
export const AdminCreateUserInput = gqlSchemaBuilder.inputType("AdminCreateUserInput", {
  fields: t => ({ ...userRegistrationInputFields(t) }),
});

/**
 * `AdminUpdateUserInput` — closed whitelist of EXACTLY five keys
 * (`fullName`, `phone`, `country`, `gender`, `dateOfBirth`). `email`, `role`,
 * `passwordHash`, governance fields, `parentId`, handshake code, balances,
 * and timestamps are structurally unreachable through this shape.
 */
export const AdminUpdateUserInput = gqlSchemaBuilder.inputType("AdminUpdateUserInput", {
  fields: t => ({
    fullName: t.string({ required: false }),
    phone: t.string({ required: false }),
    country: t.string({ required: false }),
    gender: t.field({ type: GenderPothosEnum, required: false }),
    dateOfBirth: t.string({ required: false }),
  }),
});
