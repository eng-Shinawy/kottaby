/**
 * MyNotificationsFilterInput — Pothos input type for the self-scoped inbox
 * list query.
 *
 * Input-type exception (`backend/graphql/AGENTS.md` Single Canonical Object
 * Type Pattern — "Input types … are allowed as separate definitions when they
 * serve a specific purpose"), authored in the Pothos tree per
 * `backend/graphql/query/AGENTS.md` (query files register root fields only).
 *
 * Field whitelist mirrors the inbox read parameters — and nothing else:
 *  - `type` — optional notification-kind filter through the registered
 *    {@link NotificationTypePothosEnum} (unknown values die at the GraphQL
 *    enum layer before a resolver ever runs).
 *  - `isRead` — optional read-state filter.
 *  - `limit` / `offset` — optional page window, carried as nullable Ints.
 *    Bounds validation and the documented defaults (page size 20, offset 0
 *    when absent) are owned by the notification engine's service boundary;
 *    the resolver merely forwards what arrived.
 *
 * BOPLA-safe by construction: NO identity field of any kind — the inbox is
 * addressed exclusively by the verified caller context, so a client cannot
 * smuggle a recipient through the filter. Smuggled extra fields die as
 * GraphQL validation failures ("field not defined"), never reaching the
 * resolver.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { NotificationTypePothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";

/** Input type for the `myNotifications` query's optional filter argument. */
export const MyNotificationsFilterInput = gqlSchemaBuilder.inputType("MyNotificationsFilterInput", {
  fields: t => ({
    // Optional notification-kind conjunct (enum-guarded at the schema layer).
    type: t.field({ type: NotificationTypePothosEnum, required: false }),
    // Optional read-state conjunct.
    isRead: t.boolean({ required: false }),
    // Optional page window — bounds + defaults owned by the service layer.
    limit: t.int({ required: false }),
    offset: t.int({ required: false }),
  }),
});
