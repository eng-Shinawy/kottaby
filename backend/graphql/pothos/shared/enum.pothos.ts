/**
 * Pothos enum registry — single canonical registration of every TS enum
 * exposed through the GraphQL schema.
 *
 * Per `backend/graphql/pothos/AGENTS.md` (CRITICAL RULE):
 *  - GraphQL enums MUST be backed by a real TS `enum` in `backend/enum/`.
 *  - Hardcoding enum value literal arrays in Pothos files is PROHIBITED.
 *  - Each enum is registered ONCE here using the enum-object form:
 *      `gqlSchemaBuilder.enumType(MyEnum, { name: "MyEnum" })`
 *  - Domain Pothos files import the registered Pothos enum from here —
 *    they MUST NOT re-register the same enum (runtime error: "has already
 *    been declared").
 *
 * Registered enums:
 *  - `UserRole` (full role set incl. "admin")
 *  - `Gender`
 *  - `RegisterPublicRole` (public subset — student/teacher/parent — BFLA)
 *  - `RecitationReading`, `ApplicantStatus`
 *  - `SessionStatus`, `SessionType`, `SessionIntent` (scheduling domain)
 *  - `DisputeResolution` (admin arbitration outcome vocabulary)
 *  - `TransactionType`, `TransactionStatus` (billing ledger vocabulary, DEV3-013)
 *  - `AdminUserGovernanceFilter` (active|suspended|blocked|deleted — admin directory filter)
 *  - `NotificationType` (the seven notification kinds)
 *  - `BroadcastAudienceType` (all|role|country|plan — admin broadcast cohort kinds)
 *  - `AppLocale` (the per-user UI/copy preference — "ar" | "en")
 *  - `LinkStatus` (pending|confirmed|rejected|expired — parent-child link request lifecycle)
 *
 * After registering a new enum here, run `bun run generate:gqlSchema` and
 * `bun codegen` to refresh the SDL + frontend codegen.
 */

import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { AdminUserGovernanceFilter } from "@/backend/enum/users/admin-user-governance-filter.enum";
import { AppLocale } from "@/backend/enum/users/app-locale.enum";
import { Gender } from "@/backend/enum/users/gender.enum";
import { RegisterPublicRole } from "@/backend/enum/users/register-public-role.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { RecitationReading } from "@/shared/constants/recitation-reading.enum";

/** GraphQL `UserRole` enum (full role set — admin|teacher|student|parent). */
export const UserRolePothosEnum = gqlSchemaBuilder.enumType(UserRole, {
  name: "UserRole",
});

/** GraphQL `Gender` enum (male|female|other). */
export const GenderPothosEnum = gqlSchemaBuilder.enumType(Gender, {
  name: "Gender",
});

/**
 * GraphQL `AppLocale` enum (ar|en) — the per-user UI/copy preference.
 *
 * Backed by the canonical TS mirror (`backend/enum/users/app-locale.enum.ts`),
 * which the parity test pins byte-identical to BOTH the `app_locale` pgEnum
 * (`users.locale`) and the shared locale list (`shared/locale/AppLocale.ts`).
 */
export const AppLocalePothosEnum = gqlSchemaBuilder.enumType(AppLocale, {
  name: "AppLocale",
});

/**
 * GraphQL `RegisterPublicRole` enum (student|teacher|parent — `admin`
 * intentionally excluded). Enforces BFLA at the schema layer: the public
 * `registerUser` mutation rejects `admin` before any resolver runs.
 */
export const RegisterPublicRolePothosEnum = gqlSchemaBuilder.enumType(RegisterPublicRole, {
  name: "RegisterPublicRole",
});

/**
 * GraphQL `RecitationReading` enum (Qira'ah catalog — 10 canonical readings).
 *
 * Registered ONCE from the canonical shared enum. The
 * physical `recitation` table is session-linked — this enum is for
 * user-preference selection only, not for `recitation.user_id` resurrection.
 */
export const RecitationReadingPothosEnum = gqlSchemaBuilder.enumType(RecitationReading, {
  name: "RecitationReading",
});

/**
 * GraphQL `ApplicantStatus` enum (pending|in_evaluation|failed|passed).
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/teachers/applicant-status.enum.ts`) — the sole runtime
 * authority over the pgEnum-less `applicants.status` varchar column, whose
 * stored values are guard-validated with `isApplicantStatus` at the service
 * boundary before any value carries the GraphQL type.
 */
export const ApplicantStatusPothosEnum = gqlSchemaBuilder.enumType(ApplicantStatus, {
  name: "ApplicantStatus",
});

/**
 * GraphQL `SessionStatus` enum (scheduled|started|completed|cancelled|disputed).
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/scheduling/session-status.enum.ts`) mirroring the
 * `session_status` pgEnum. The `disputed` member is produced by the
 * participant dispute transition and consumed by the admin arbitration
 * (`DisputeResolution` below is the outcome vocabulary).
 */
export const SessionStatusPothosEnum = gqlSchemaBuilder.enumType(SessionStatus, {
  name: "SessionStatus",
});

/**
 * GraphQL `DisputeResolution` enum (Cancel|Complete) — the admin arbitration
 * outcome vocabulary that exits the non-terminal `disputed` state into
 * exactly one terminal state.
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/scheduling/dispute-resolution.enum.ts`). There is NO
 * pgEnum backing this vocabulary — it is a pure transition selector on the
 * arbitration mutation, never a stored column value.
 */
export const DisputeResolutionPothosEnum = gqlSchemaBuilder.enumType(DisputeResolution, {
  name: "DisputeResolution",
});

/**
 * GraphQL `SessionType` enum (student_session|teacher_evaluation|re_evaluation).
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/scheduling/session-type.enum.ts`) mirroring the
 * `session_type` pgEnum.
 */
export const SessionTypePothosEnum = gqlSchemaBuilder.enumType(SessionType, {
  name: "SessionType",
});

/**
 * GraphQL `SessionIntent` enum (hifz|tajweed|evaluation).
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/scheduling/session-intent.enum.ts`) mirroring the
 * `session_intent` pgEnum. Nullable on session fields: intent is optional on
 * the table (evaluation sessions carry it; student bookings pin Hifz/Tajweed).
 */
export const SessionIntentPothosEnum = gqlSchemaBuilder.enumType(SessionIntent, {
  name: "SessionIntent",
});

/**
 * GraphQL `TransactionType` enum (earning|withdrawal|bonus) — the
 * `teacher_transaction` ledger vocabulary (DEV3-013).
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/billing/transaction-type.enum.ts`) mirroring the
 * `transaction_type` pgEnum.
 */
export const TransactionTypePothosEnum = gqlSchemaBuilder.enumType(TransactionType, {
  name: "TransactionType",
});

/**
 * GraphQL `TransactionStatus` enum (pending|completed|failed) — the
 * `teacher_transaction` ledger settlement vocabulary (DEV3-013).
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/billing/transaction-status.enum.ts`) mirroring the
 * `transaction_status` pgEnum.
 */
export const TransactionStatusPothosEnum = gqlSchemaBuilder.enumType(TransactionStatus, {
  name: "TransactionStatus",
});

/**
 * GraphQL `AdminUserGovernanceFilter` enum (active|suspended|blocked|deleted).
 *
 * Backs the admin user directory `governance` filter. Unknown transport values
 * fail GraphQL input validation before any resolver runs; absent or `null`
 * drops out at the service layer (the directory falls back to the unfiltered
 * listing rather than erroring).
 */
export const AdminUserGovernanceFilterPothosEnum = gqlSchemaBuilder.enumType(AdminUserGovernanceFilter, {
  name: "AdminUserGovernanceFilter",
});

/**
 * GraphQL `AuditActionType` enum (create|update|delete|override|adjust|
 * suspend|reactivate).
 *
 * Registered ONCE from the canonical TS enum that mirrors the
 * `audit_action_type` pgEnum. Backs the per-user activity timeline on the
 * admin user detail surface (scoped `audit_logs` read-back); the global
 * audit-trail browsing surface remains owned by DEV3-020.
 */
export const AuditActionTypePothosEnum = gqlSchemaBuilder.enumType(AuditActionType, {
  name: "AuditActionType",
});

/**
 * GraphQL `NotificationType` enum (the seven notification kinds).
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/notifications/notification-type.enum.ts`), which mirrors the
 * `notification_type` pgEnum byte-for-byte. Per the Pothos enum-object
 * convention (identical to `UserRole` / `ApplicantStatus`), the enum KEYS are
 * the GraphQL value names on the wire (`SessionRequest`, …) while the
 * snake_case string values (`session_request`, …) remain the runtime and
 * database representation — the GraphQL enum layer maps between them.
 */
export const NotificationTypePothosEnum = gqlSchemaBuilder.enumType(NotificationType, {
  name: "NotificationType",
});

/**
 * GraphQL `LinkStatus` enum (pending|confirmed|rejected|expired).
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/shared/link-status.enum.ts`), which mirrors the
 * `link_status` pgEnum byte-for-byte. Per the Pothos enum-object
 * convention (identical to `NotificationType`), the enum KEYS are the
 * GraphQL value names on the wire (`Pending`, `Confirmed`, `Rejected`,
 * `Expired`) while the lowercase string values remain the runtime and
 * database representation — the GraphQL enum layer maps between them.
 * Backs the `status` field on the parent-child link request objects
 * (`pothos/parents/parent-link-request.pothos.ts`).
 */
export const LinkStatusPothosEnum = gqlSchemaBuilder.enumType(LinkStatus, {
  name: "LinkStatus",
});

/**
 * GraphQL `BroadcastAudienceType` enum (wire names `All`/`Role`/`Country`/
 * `Plan` over the runtime strings "all"/"role"/"country"/"plan").
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/notifications/broadcast-audience-type.enum.ts`). This is the
 * request-scoped cohort vocabulary an admin broadcast targets — it is never
 * persisted as a column type (resolved notification rows record the
 * recipient, not the cohort), so it has no pgEnum counterpart. Unknown
 * transport values die at the GraphQL input-validation layer before any
 * resolver runs.
 */
export const BroadcastAudienceTypePothosEnum = gqlSchemaBuilder.enumType(BroadcastAudienceType, {
  name: "BroadcastAudienceType",
});
