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
 *  - `TransactionType`, `TransactionStatus` (billing ledger vocabulary)
 *  - `PaymentGateway`, `PaymentStatus`, `SubscriptionStatus`,
 *    `SubscriptionCreditLane` (subscription purchase + settlement vocabulary)
 *  - `ProrationDirection` (admin plan-change upgrade/downgrade vocabulary)
 *  - `AdminUserGovernanceFilter` (active|suspended|blocked|deleted — admin directory filter)
 *  - `NotificationType` (the nine notification kinds)
 *  - `BroadcastAudienceType` (all|role|country|plan — admin broadcast cohort kinds)
 *  - `AppLocale` (the per-user UI/copy preference — "ar" | "en")
 *  - `LinkStatus` (pending|confirmed|rejected|expired — parent-child link request lifecycle)
 *  - `SurahJuzRef` (5 surahs + 30 juz — home_work assignment/ref vocabulary)
 *
 * After registering a new enum here, run `bun run generate:gqlSchema` and
 * `bun codegen` to refresh the SDL + frontend codegen.
 */

import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { ProrationDirection } from "@/backend/enum/billing/proration-direction.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { WalletAdjustmentDirection } from "@/backend/enum/billing/wallet-adjustment-direction.enum";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
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
 * GraphQL `DisputeResolution` enum (Cancel|Complete|Refund|PartialRefund|
 * Uphold) — the admin arbitration outcome vocabulary that exits the
 * non-terminal `disputed` state into exactly one terminal state. The
 * members serve the two dispute generations, discriminated by the row's
 * escrow marker: `Cancel`/`Complete` resolve held-escrow disputes (the
 * shipped lifecycle service), `Refund`/`PartialRefund`/`Uphold` resolve
 * consumed-escrow disputes (the post-confirmation arbitration service) —
 * the `resolveSessionDispute` mutation dispatches the two families.
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/scheduling/dispute-resolution.enum.ts`, which derives the
 * registered members dynamically). There is NO pgEnum backing this
 * vocabulary — it is a pure transition selector on the arbitration
 * mutation, never a stored column value.
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
 * GraphQL `TransactionType` enum (earning|withdrawal|bonus|arbitration_reversal) — the
 * `teacher_transaction` ledger vocabulary.
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
 * `teacher_transaction` ledger settlement vocabulary.
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/billing/transaction-status.enum.ts`) mirroring the
 * `transaction_status` pgEnum.
 */
export const TransactionStatusPothosEnum = gqlSchemaBuilder.enumType(TransactionStatus, {
  name: "TransactionStatus",
});

/**
 * GraphQL `WalletAdjustmentDirection` enum (wire names `Credit`/`Debit`
 * over the runtime strings "credit"/"debit") — the manual wallet
 * adjustment vocabulary the admin auditing mutation selects.
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/billing/wallet-adjustment-direction.enum.ts`). There is NO
 * pgEnum backing this vocabulary — it is a pure service-time transition
 * selector resolved into the credit/debit ledger movement against the
 * teacher's wallet, never a stored column value. Per the Pothos
 * enum-object convention (identical to `DisputeResolution`), the enum KEYS
 * are the GraphQL value names on the wire (`Credit`, `Debit`).
 */
export const WalletAdjustmentDirectionPothosEnum = gqlSchemaBuilder.enumType(WalletAdjustmentDirection, {
  name: "WalletAdjustmentDirection",
});

/**
 * GraphQL `PaymentGateway` enum — the channel a payment traveled
 * (stripe|paypal|paymob|fawry|offline_cash|bank_transfer|scholarship|other
 * |mock on the runtime/database side).
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/billing/payment-gateway.enum.ts`) mirroring the
 * `payment_gateway` pgEnum. The `Mock` member records purchases processed
 * by the built-in mock gateway so development transactions stay
 * distinguishable from real `Other` payments in the ledger.
 */
export const PaymentGatewayPothosEnum = gqlSchemaBuilder.enumType(PaymentGateway, {
  name: "PaymentGateway",
});

/**
 * GraphQL `PaymentStatus` enum (pending|paid|failed|refunded) — the
 * `student_payments` settlement lifecycle.
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/billing/payment-status.enum.ts`) mirroring the
 * `payment_status` pgEnum. A payment leaves `Pending` exactly once via
 * the guarded decision writes; decided rows are terminal.
 */
export const PaymentStatusPothosEnum = gqlSchemaBuilder.enumType(PaymentStatus, {
  name: "PaymentStatus",
});

/**
 * GraphQL `SubscriptionStatus` enum (active|pending|expired|cancelled|
 * suspended) — the subscription lifecycle.
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/billing/subscription-status.enum.ts`) mirroring the
 * `subscription_status` pgEnum. Purchases create rows in `Pending`;
 * only the payment-activation path moves them to `Active`.
 */
export const SubscriptionStatusPothosEnum = gqlSchemaBuilder.enumType(SubscriptionStatus, {
  name: "SubscriptionStatus",
});

/**
 * GraphQL `SubscriptionCreditLane` enum (hifz|tajweed|reviews) — the
 * student balance lane a plan's sessions are credited to on activation.
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/billing/subscription-credit-lane.enum.ts`) mirroring the
 * `subscription_credit_lane` pgEnum. Nullable on catalog surfaces: a plan
 * without a lane is valid but unfulfillable — purchases fail closed
 * instead of crediting a guessed lane.
 */
export const SubscriptionCreditLanePothosEnum = gqlSchemaBuilder.enumType(SubscriptionCreditLane, {
  name: "SubscriptionCreditLane",
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
 * audit-trail browsing surface remains owned.
 */
export const AuditActionTypePothosEnum = gqlSchemaBuilder.enumType(AuditActionType, {
  name: "AuditActionType",
});

/**
 * GraphQL `NotificationType` enum (the nine notification kinds).
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

/**
 * GraphQL `SurahJuzRef` enum (5 surahs `SurahAlFatihah`…`SurahAlMaidah`
 * followed by 30 juz `Juz1`…`Juz30`).
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/shared/surah-juz-ref.enum.ts`), which mirrors the
 * `surah_juz_ref` pgEnum byte-for-byte. Backs the assignment/ref fields on
 * the `SessionHomeWork` object — the stored `surah_juz_ref` column values
 * (`surah_al_fatihah`, `juz_1`, …) map onto the Pothos enum through the
 * exhaustive DB-string mapper in `classes/home-work.pothos.ts`, never via
 * casts. Per the Pothos enum-object convention (identical to
 * `NotificationType`/`LinkStatus`), the enum KEYS are the GraphQL value
 * names on the wire (`SurahAlFatihah`, `Juz1`, …) while the snake_case
 * string values remain the runtime and database representation.
 */
export const SurahJuzRefPothosEnum = gqlSchemaBuilder.enumType(SurahJuzRef, {
  name: "SurahJuzRef",
});

/**
 * GraphQL `ProrationDirection` enum (upgrade|downgrade) — the derived
 * direction of an admin plan change, computed from the two plans'
 * per-session unit values (a unit-value tie breaks on session count).
 *
 * Registered ONCE from the canonical TS enum
 * (`backend/enum/billing/proration-direction.enum.ts`). There is NO pgEnum
 * backing this vocabulary — it is a pure service-time computation result
 * on the `adminChangeSubscriptionPlan` payload, never a stored column
 * value. Backs the `direction` field on the `ChangeSubscriptionPlanPayload`
 * object.
 */
export const ProrationDirectionPothosEnum = gqlSchemaBuilder.enumType(ProrationDirection, {
  name: "ProrationDirection",
});
