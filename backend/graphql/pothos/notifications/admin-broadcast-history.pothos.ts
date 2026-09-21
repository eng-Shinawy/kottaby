/**
 * Admin-broadcast history Pothos objects + filters input — the read/stop
 * surface of the admin broadcast lifecycle (the compose inputs live in
 * `admin-broadcast.pothos.ts`).
 *
 * String-named definitions per `backend/graphql/AGENTS.md` (the wrapper-type
 * and input-type exceptions) — NO local type shapes: the canonical return
 * shapes live in `backend/types/notifications/broadcast.types.ts`
 * (`AdminBroadcastEntryReturnType`, `AdminBroadcastPageReturnType`,
 * `AdminBroadcastDetailReturnType`, `AdminBroadcastListFilters`), and the
 * resolvers map the validated GraphQL input onto them field-by-field.
 *
 * `AdminBroadcastEntry` is the single canonical broadcast GraphQL object:
 *  - `id` is exposed FIRST (Apollo cache normalization, CRITICAL rule) as a
 *    GraphQL `ID!` over the integer primary key.
 *  - Enum members arrive pre-normalized from the service's fail-closed
 *    entry mapper (`isBroadcastStatus` / `isBroadcastAudienceType` /
 *    `toUserRole`), so the schema layer only exposes them through the
 *    registered enums — no casts, no re-validation.
 *
 * The page/detail envelopes are id-less BY DESIGN (root-field value
 * objects, the `NotificationListPage` / `AdminUserPage` wrapper precedent):
 * the rows inside `items` and `entry` are the normalizable entities.
 *
 * Closed-input posture (BOPLA-safe by construction):
 *  - `AdminBroadcastFiltersInput` carries the three history conjuncts ONLY
 *    (title substring, status, audience type) — no identity field of any
 *    kind. Any field beyond the whitelist dies as a GraphQL validation
 *    failure ("field not defined") before a resolver ever runs.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  BroadcastAudienceTypePothosEnum,
  BroadcastStatusPothosEnum,
  UserRolePothosEnum,
} from "@/backend/graphql/pothos/shared/enum.pothos";
import type {
  AdminBroadcastDetailReturnType,
  AdminBroadcastEntryReturnType,
  AdminBroadcastPageReturnType,
} from "@/backend/types";

/**
 * The canonical `AdminBroadcastEntry` GraphQL object — one history row of the
 * admin broadcast list/detail surfaces (header columns plus the joined
 * sender/stopper display names).
 */
export const AdminBroadcastEntryPothosObject = gqlSchemaBuilder
  .objectRef<AdminBroadcastEntryReturnType>("AdminBroadcastEntry")
  .implement({
    fields: t => ({
      // Integer primary key exposed as a GraphQL ID — FIRST for Apollo cache
      // normalization.
      id: t.exposeID("id"),
      title: t.exposeString("title"),
      body: t.exposeString("body"),
      // Nullable — a legacy row predating the typed audience selector.
      audienceType: t.expose("audienceType", { type: BroadcastAudienceTypePothosEnum, nullable: true }),
      // Nullable — meaningful only when `audienceType` is `role`.
      audienceRole: t.expose("audienceRole", { type: UserRolePothosEnum, nullable: true }),
      // Nullable — meaningful only when `audienceType` is `country`.
      audienceCountry: t.exposeString("audienceCountry", { nullable: true }),
      // Nullable — meaningful only when `audienceType` is `plan`.
      audiencePlanId: t.exposeInt("audiencePlanId", { nullable: true }),
      // The lifecycle state — `active` until the one-way stop transition.
      status: t.expose("status", { type: BroadcastStatusPothosEnum }),
      recipientCount: t.exposeInt("recipientCount"),
      sentById: t.exposeInt("sentById"),
      sentByName: t.exposeString("sentByName"),
      // ISO-8601 UTC timestamps through the shared `DateTime` scalar.
      sentAt: t.expose("sentAt", { type: "DateTime" }),
      stoppedById: t.exposeInt("stoppedById", { nullable: true }),
      stoppedByName: t.exposeString("stoppedByName", { nullable: true }),
      stoppedAt: t.expose("stoppedAt", { type: "DateTime", nullable: true }),
    }),
  });

/**
 * The canonical `AdminBroadcastPage` pagination wrapper object. An
 * out-of-range page yields an empty `items` array with the honest
 * `totalCount`; `page`/`pageSize` echo the resolved window back so callers
 * can normalize client-side pagination state.
 */
export const AdminBroadcastPagePothosObject = gqlSchemaBuilder
  .objectRef<AdminBroadcastPageReturnType>("AdminBroadcastPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [AdminBroadcastEntryPothosObject],
        resolve: parent => parent.items,
      }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });

/**
 * The canonical `AdminBroadcastDetail` value object — the header entry plus
 * the live delivery/read aggregates derived from the broadcast's
 * still-present notification rows (both live counts are 0 once stopped; the
 * entry's `recipientCount` preserves the original reach).
 */
export const AdminBroadcastDetailPothosObject = gqlSchemaBuilder
  .objectRef<AdminBroadcastDetailReturnType>("AdminBroadcastDetail")
  .implement({
    fields: t => ({
      entry: t.field({
        type: AdminBroadcastEntryPothosObject,
        resolve: parent => parent.entry,
      }),
      liveDeliveredCount: t.exposeInt("liveDeliveredCount"),
      liveReadCount: t.exposeInt("liveReadCount"),
    }),
  });

/**
 * `AdminBroadcastFiltersInput` — input type for the `adminBroadcasts` history
 * query's optional filter argument. Every field is optional (absent/null =
 * no filter) and the conjuncts compose AND-wise; the service owns the
 * title-substring trimming/bounding/escaping and the filter drop-out
 * semantics.
 */
export const AdminBroadcastFiltersInput = gqlSchemaBuilder.inputType("AdminBroadcastFiltersInput", {
  fields: t => ({
    // Optional title substring conjunct (service-owned escaping).
    titleSearch: t.string({ required: false }),
    // Optional lifecycle-state conjunct (enum-guarded at the schema layer).
    status: t.field({ type: BroadcastStatusPothosEnum, required: false }),
    // Optional audience-kind conjunct (enum-guarded at the schema layer).
    audienceType: t.field({ type: BroadcastAudienceTypePothosEnum, required: false }),
  }),
});
