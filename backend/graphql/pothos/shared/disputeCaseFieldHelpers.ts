/**
 * Session-arbitration Pothos field factory — the participant-owned artifact
 * passthroughs shared verbatim by the three dispute-case envelopes (jscpd
 * clone elimination, per `backend/graphql/AGENTS.md` §Pothos Field
 * Factories):
 *
 *  - `disputeCaseArtifactFields` — the four canonical entity passthroughs
 *    (`session` through the canonical `Session` object, plus the honest-null
 *    `report` / `homework` / `recitation` artifacts) shared verbatim by
 *    `AdminDisputeCase`, `TeacherDisputeCase`, and `StudentDisputeCase`.
 *    All three envelopes re-register zero duplicate of any member entity —
 *    the canonical objects stay registered exactly once repo-wide, and the
 *    produced SDL is byte-identical to the pre-extraction definitions.
 *
 * The builder is typed against the union of the three canonical shapes (per
 * the `adminDirectoryAccountFields` convention in
 * `backend/graphql/pothos/admin/shared/adminDirectoryFieldHelpers.ts`), so
 * every call site passes its own field builder without a generic
 * indirection — and the helper only resolves shape members that exist
 * identically on all three canonical types.
 *
 * This is a shared HELPER module, NOT a `*.pothos.ts` definition file: it
 * declares no GraphQL types itself and is consumed directly by the domain
 * Pothos files (never barrel-imported).
 */
import type { ObjectFieldBuilder } from "@pothos/core";
import type { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SessionHomeWorkPothosObject } from "@/backend/graphql/pothos/classes/home-work.pothos";
import { SessionRecitationPothosObject } from "@/backend/graphql/pothos/classes/recitation.pothos";
import { SessionReportPothosObject } from "@/backend/graphql/pothos/classes/report.pothos";
import { SessionPothosObject } from "@/backend/graphql/pothos/classes/session.pothos";
import type {
  AdminDisputeCaseReturnType,
  StudentDisputeCaseReturnType,
  TeacherDisputeCaseReturnType,
} from "@/backend/types";

/**
 * The `SchemaTypes` of the canonical `gqlSchemaBuilder` — derived from the
 * instance so helper signatures track the builder's context/defaults/scalars
 * without duplicating the builder's type parameter.
 */
type GqlSchemaTypes = typeof gqlSchemaBuilder extends PothosSchemaTypes.SchemaBuilder<infer Types> ? Types : never;

/**
 * The session row + honest-null artifact passthroughs shared verbatim by
 * the three dispute-case envelopes (`AdminDisputeCase`, `TeacherDisputeCase`,
 * `StudentDisputeCase`).
 */
export function disputeCaseArtifactFields(
  t: ObjectFieldBuilder<
    GqlSchemaTypes,
    AdminDisputeCaseReturnType | TeacherDisputeCaseReturnType | StudentDisputeCaseReturnType
  >
) {
  return {
    // The disputed session's full row (dispute reason, stamps, fee, hold
    // marker) through the canonical `Session` object — `Session!`.
    session: t.field({
      type: SessionPothosObject,
      resolve: parent => parent.session,
    }),
    // The session's post-session report — honest `null` when none was
    // submitted.
    report: t.field({
      type: SessionReportPothosObject,
      nullable: true,
      resolve: parent => parent.report,
    }),
    // The session's homework record — honest `null` when none was produced.
    homework: t.field({
      type: SessionHomeWorkPothosObject,
      nullable: true,
      resolve: parent => parent.homework,
    }),
    // The session's recitation record — honest `null` when none was
    // recorded.
    recitation: t.field({
      type: SessionRecitationPothosObject,
      nullable: true,
      resolve: parent => parent.recitation,
    }),
  };
}
