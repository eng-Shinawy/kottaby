/**
 * Admin direct-student-onboarding Pothos types — the
 * `AdminOnboardStudentOfflineInput` whitelist plus the
 * `AdminOnboardStudentResult` payload object.
 *
 * The input is the GraphQL schema's BOPLA boundary for the one-call admin
 * onboarding flow (create the student identity and activate a plan
 * subscription against an offline payment). It carries exactly the fields
 * the service accepts, so transport-tampered extras die at GraphQL
 * validation before a resolver ever runs. Server-owned concerns are
 * structurally absent: the created account's role is hard-coded
 * server-side, and the subscription's status / payment-verification
 * state are derived by the service, never submitted.
 *
 * `paymentMethod` is wire-restricted to the registered gateway enum; the
 * service additionally accepts only the offline members (offline cash,
 * bank transfer, scholarship) — online gateway members are rejected
 * there because the flow never performs a gateway round-trip.
 *
 * `paymentReference` is the human idempotency token of the offline
 * collection: trimmed and length-bounded server-side and enforced unique
 * across subscriptions, so a replayed reference conflicts instead of
 * double-billing.
 *
 * `parentId` is optional: omitted or `null` onboards an unlinked
 * student, while a supplied id links that parent in the same
 * transaction (existence and parent-role checks are server-side).
 *
 * The result composes the EXISTING canonical objects only — the full
 * admin user detail for the new student and the activated subscription
 * row — plus the exact lane credit the onboarding settled and the flat
 * handshake-code echo. No new entity object type exists for this flow.
 */
import { AdminUserDetailPothosObject } from "@/backend/graphql/pothos/admin/admin-user.pothos";
import { SubscriptionPothosObject } from "@/backend/graphql/pothos/billing/subscription.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  GenderPothosEnum,
  PaymentGatewayPothosEnum,
  SubscriptionCreditLanePothosEnum,
} from "@/backend/graphql/pothos/shared/enum.pothos";
import type { AdminOnboardStudentReturnType } from "@/backend/types/admin/admin-student-onboarding.types";

/**
 * Input for onboarding a student directly: one call creates the student
 * account and activates a plan subscription against an offline payment.
 */
export const AdminOnboardStudentOfflineInput = gqlSchemaBuilder.inputType("AdminOnboardStudentOfflineInput", {
  fields: t => ({
    fullName: t.string({
      required: true,
      description: "The student's full name, stored on the new user row.",
    }),
    email: t.string({
      required: true,
      description: "The student's login email — globally unique; a duplicate conflicts.",
    }),
    phone: t.string({
      required: true,
      description: "The student's contact phone number.",
    }),
    password: t.string({
      required: true,
      description: "Admin-authored initial password for the new student account.",
    }),
    gender: t.field({
      type: GenderPothosEnum,
      required: false,
      description: "Optional gender; omitted leaves the student's gender unset.",
    }),
    country: t.string({
      required: true,
      description: "The student's country of residence.",
    }),
    parentId: t.int({
      required: false,
      description:
        "Optional id of the parent to link to the new student; omitted or null onboards unlinked. Must reference an existing parent user (server-validated).",
    }),
    planId: t.int({
      required: true,
      description:
        "Id of the subscription plan to activate (must be an active plan with a configured credit lane; server-validated).",
    }),
    paymentMethod: t.field({
      type: PaymentGatewayPothosEnum,
      required: true,
      description:
        "Offline payment method of the collection (offline cash, bank transfer, or scholarship); online gateways are rejected server-side.",
    }),
    paymentReference: t.string({
      required: true,
      description:
        "Human reference of the offline payment (1–255 characters after trimming; unique across subscriptions).",
    }),
  }),
});

/**
 * Payload of a direct student onboarding: the provisioned student, the
 * activated offline subscription, and the exact balance credit the
 * onboarding transaction settled.
 */
export const AdminOnboardStudentResultPothosObject = gqlSchemaBuilder
  .objectRef<AdminOnboardStudentReturnType>("AdminOnboardStudentResult")
  .implement({
    fields: t => ({
      student: t.field({
        type: AdminUserDetailPothosObject,
        description: "The freshly provisioned student as a full admin user detail.",
        resolve: parent => parent.student,
      }),
      subscription: t.field({
        type: SubscriptionPothosObject,
        description: "The activated subscription row carrying the recorded offline payment evidence.",
        resolve: parent => parent.subscription,
      }),
      creditedLane: t.expose("creditedLane", {
        type: SubscriptionCreditLanePothosEnum,
        description: "Balance lane the plan's session credit was applied to.",
      }),
      creditedSessions: t.exposeInt("creditedSessions", {
        description: "Sessions credited to that lane (the plan's full session count — never prorated).",
      }),
      handshakeCode: t.exposeString("handshakeCode", {
        description:
          "The student's unique handshake code, echoed flat for the confirming UI (the same value the nested student snapshot carries).",
      }),
    }),
  });
