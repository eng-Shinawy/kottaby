/**
 * ApplicantProfilePothosObject — the single canonical GraphQL object type
 * for the teacher-applicant lifecycle profile.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical {@link ApplicantProfileReturnType}
 *    from `@/backend/types` — no local type definitions here. The service
 *    (`ApplicantLifecycleService.getMyApplicantProfile`) is the only
 *    producer of that closed 8-field shape (BOPLA: read-only, no
 *    governance fields, no client-writable surface).
 *  - Exactly eight fields, mapped structurally:
 *      id / verificationAttempts                  → exposed Ints (non-nullable)
 *      status                                     → `ApplicantStatus` registered enum
 *      lastAttemptAt / cooldownUntil              → nullable `DateTime` scalars
 *      cooldownActive / canPurchaseVerification   → exposed Booleans (non-nullable)
 *      cooldownState                              → `ApplicantCooldownState` registered enum
 *  - Timestamp exposure: nullable timestamps use the `DateTime` scalar
 *    (registered in `shared/scalar.pothos.ts`, backed by `DateTimeResolver`
 *    from `graphql-scalars`) — it serializes `Date` to the same ISO-8601 UTC
 *    string the old manual `toISOString()` fields produced, so the wire
 *    format is unchanged. The canonical TS shape stays `Date | null`.
 *  - NO inline business logic — every field is a structural map or
 *    passthrough; derivations (`cooldownActive`, `canPurchaseVerification`)
 *    are computed server-side in the service, never re-computed here.
 *
 * Consumed by the zero-argument role-gated `myApplicantProfile` query, whose
 * import of this module transitively registers the type through the
 * `gqlSchema.ts` side-effect chain.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  ApplicantCooldownStatePothosEnum,
  ApplicantStatusPothosEnum,
} from "@/backend/graphql/pothos/shared/enum.pothos";
import type { ApplicantProfileReturnType } from "@/backend/types";

export const ApplicantProfilePothosObject = gqlSchemaBuilder
  .objectRef<ApplicantProfileReturnType>("ApplicantProfile")
  .implement({
    fields: t => ({
      // Int ID (= users.id) — Apollo cache normalization requires `id`
      // on every entity-shaped object.
      id: t.exposeInt("id"),
      // Guard-validated `ApplicantStatus` member from the service boundary —
      // direct passthrough onto the enum registered in shared/enum.pothos.
      status: t.field({
        type: ApplicantStatusPothosEnum,
        resolve: parent => parent.status,
      }),
      verificationAttempts: t.exposeInt("verificationAttempts"),
      // Nullable `DateTime` scalar (source is `Date | null`; serializes to
      // the same ISO-8601 UTC string as before).
      lastAttemptAt: t.expose("lastAttemptAt", { type: "DateTime", nullable: true }),
      // Nullable `DateTime` scalar (source is `Date | null`).
      cooldownUntil: t.expose("cooldownUntil", { type: "DateTime", nullable: true }),
      cooldownActive: t.exposeBoolean("cooldownActive"),
      canPurchaseVerification: t.exposeBoolean("canPurchaseVerification"),
      // Derived cooldown read-model vocabulary from the same captured `now`
      // that drives `cooldownActive` — computed server-side, direct
      // passthrough onto the enum registered in shared/enum.pothos.
      cooldownState: t.field({
        type: ApplicantCooldownStatePothosEnum,
        resolve: parent => parent.cooldownState,
      }),
    }),
  });
