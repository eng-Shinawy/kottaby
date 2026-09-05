/**
 * NotificationPothosObject — the single canonical GraphQL object type for a
 * notification row.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical {@link NotificationReturnType} from
 *    `@/backend/types` (the GraphQL binding anchor derived from
 *    `notifications.$inferSelect`) — no local type definitions here, and no
 *    second notification-shaped object anywhere.
 *  - Exactly the eight inbox-facing fields; the recipient `userId` is
 *    structurally NOT part of the GraphQL surface — every consuming
 *    operation is self-scoped (`ctx.user.id`), so the recipient is implied
 *    by the caller and never disclosed as data.
 *  - `id` is exposed FIRST (Apollo cache normalization, CRITICAL rule) as a
 *    GraphQL `ID!` over the integer primary key.
 *
 * Timestamp exposure: although the shared registry now provides a `DateTime`
 * scalar (`shared/scalar.pothos.ts`, registered via the definitions barrel),
 * `createdAt` deliberately keeps the established ISO-8601 UTC string
 * convention pinned by the inbox contract (`HealthCheck` precedent and the
 * schema-surface freeze). The canonical TS shape stays `Date`; only this
 * presentation layer serializes via `toISOString()`.
 *
 * Enum exposure: `type` maps the `notification_type` pgEnum string union onto
 * the registered `NotificationTypePothosEnum` through the fail-closed
 * `isNotificationType` guard — an unexpected value surfaces as a resolver
 * error rather than an unsafe cast (`toUserRole` mapping precedent on
 * `User.role`).
 */
import { isNotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { NotificationTypePothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import { ValidationError } from "@/backend/lib/errors";
import type { NotificationReturnType } from "@/backend/types";

/**
 * The canonical `Notification` GraphQL object. Resolvers return
 * `NotificationReturnType` rows (full `$inferSelect` shape); only the eight
 * fields below are discloseable over the wire.
 */
export const NotificationPothosObject = gqlSchemaBuilder.objectRef<NotificationReturnType>("Notification").implement({
  fields: t => ({
    // Integer primary key exposed as a GraphQL ID — FIRST for Apollo cache
    // normalization.
    id: t.exposeID("id"),
    // Guard-validated `NotificationType` member — the pgEnum string union
    // is narrowed onto the registered enum (fail-closed, no casts).
    type: t.field({
      type: NotificationTypePothosEnum,
      resolve: async (parent, _args, ctx) => {
        if (!isNotificationType(parent.type)) {
          // Fail-closed deny on a corrupt stored enum (the applicantStatusCorrupt
          // precedent) — translated per the resolver-i18n rule via ctx.t.
          const tErrors = await ctx.t("errorsTranslations");
          throw new ValidationError("NOTIFICATION_TYPE_CORRUPT", tErrors.notificationTypeCorrupt);
        }
        return parent.type;
      },
    }),
    title: t.exposeString("title"),
    // Nullable — optional long-form copy.
    body: t.exposeString("body", { nullable: true }),
    // DB column is `boolean | null` (default false, no `.notNull()`) —
    // resolved null → false to present a non-nullable Boolean to clients
    // (`User.isDeleted` governance-field precedent).
    isRead: t.boolean({
      resolve: parent => parent.isRead ?? false,
    }),
    // Nullable — polymorphic related-row pointer (both fields co-present
    // or both null, enforced by the notification engine).
    relatedEntityType: t.exposeString("relatedEntityType", { nullable: true }),
    relatedEntityId: t.exposeInt("relatedEntityId", { nullable: true }),
    // Non-nullable ISO-8601 UTC string (source is a non-null `Date`).
    createdAt: t.field({
      type: "String",
      resolve: parent => parent.createdAt.toISOString(),
    }),
  }),
});
