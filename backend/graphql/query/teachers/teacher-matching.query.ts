/**
 * `browseAvailableTeachers` query — the student-facing on-demand matching
 * browse (the "Teacher Directory Browse & Filter API" read side).
 *
 * Contract:
 *  - Identity is derived EXCLUSIVELY from the verified context
 *    (`ctx.user.id`) — there is NO caller-supplied user/student id
 *    argument of any kind (BOLA: probes addressing a foreign id die as
 *    GraphQL validation failures before a resolver ever runs). The service
 *    resolves the caller's own student context (languages + country pair)
 *    internally.
 *  - Args are the per-browse choices ONLY:
 *      `recitation: RecitationReading!` (hard Qira'ah filter),
 *      `intent: SessionIntent!` (hard subject filter — narrowed to the
 *      student browse vocabulary by `isBrowseIntent`; the staff-driven
 *      `evaluation` value denies with the localized `ValidationError`
 *      before any database work),
 *      `search: String` (optional case-insensitive substring match on the
 *      display name — the service is the single escape point; an empty or
 *      whitespace-only value means "no search"),
 *      `minRating: Float` (optional honest-SQL rating floor — unrated
 *      teachers are excluded when set; validated to a finite 0..5 value
 *      service-side),
 *      `sort: TeacherMatchingSort = RATING_DESC` (the post-tier ordering
 *      choice — the country tier ALWAYS sorts first; `RATING_DESC` is the
 *      byte-identical-to-legacy default),
 *      `page: Int = 1` / `pageSize: Int = 25` (SDL defaults; the service
 *      re-normalizes the effective bounds pre-DB and echoes them honestly
 *      — the resolver forwards, never clamps; the `??` restores the
 *      declared defaults when a client sends an EXPLICIT `null`).
 *  - Returns `TeacherMatchingPage!` — the paginated envelope of
 *    PII-minimal teacher cards. Eligibility composes the read-side rule of
 *    record: `is_online = true` AND no active `started` session (NEVER
 *    `is_online` alone). Zero matches is a valid browse state (an honest
 *    empty page, never an error). A caller without a `students` row
 *    (teacher/parent/admin) surfaces the localized `NotFoundError`
 *    (`STUDENT_NOT_FOUND`, HTTP 404) with exactly one bounded domain-error
 *    log.
 *  - DomainErrors thrown deeper propagate uncaught to the masking boundary
 *    (no try/catch here by contract) — `extensions.code` survives
 *    untouched: `VALIDATION`/422, `STUDENT_NOT_FOUND`/404.
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth@4.1.7):
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (`defaultStrategy: "any"` default), so ANY authenticated caller would
 *    pass through the first satisfied scope and non-students would be
 *    granted access.
 *  - The conjunction is therefore made EXPLICIT with `$all`: anonymous
 *    callers hit the `authenticated` scope's UnauthorizedError throw
 *    (extensions.code UNAUTHORIZED / 401 — explicit throws pass through
 *    builder.ts's unauthorizedError mapping VERBATIM), while authenticated
 *    non-students fail the `role` scope into the canonical localized
 *    ForbiddenError (FORBIDDEN / 403).
 *
 * Per backend/graphql/query/AGENTS.md:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/teachers/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation
 *    (backend/graphql/AGENTS.md); no business logic inline.
 */

import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  RecitationReadingPothosEnum,
  SessionIntentPothosEnum,
  TeacherMatchingSortPothosEnum,
} from "@/backend/graphql/pothos/shared/enum.pothos";
import { TeacherMatchingPagePothosObject } from "@/backend/graphql/pothos/teachers/teacher-matching.pothos";
import { UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { isBrowseIntent, TeacherMatchingService } from "@/backend/services";

// Side-effect: register the `browseAvailableTeachers` query field.
gqlSchemaBuilder.queryField("browseAvailableTeachers", t =>
  t.field({
    type: TeacherMatchingPagePothosObject,
    args: {
      // The hard Qira'ah certification filter — a required browse choice.
      recitation: t.arg({ type: RecitationReadingPothosEnum, required: true }),
      // The hard subject filter — carried on the wire as the scheduling
      // `SessionIntent` enum (a real TS enum per the Pothos enum rule);
      // the resolver narrows it to the student browse vocabulary below.
      intent: t.arg({ type: SessionIntentPothosEnum, required: true }),
      // SDL defaults (`page: Int = 1`, `pageSize: Int = 25`); the service
      // re-normalizes the effective bounds pre-DB (1..100) and echoes them
      // honestly — the resolver forwards, never clamps. The `??` restores
      // the declared defaults when a client sends an EXPLICIT `null`
      // (GraphQL field defaults do not apply to explicit nulls).
      // Optional case-insensitive display-name substring search; the
      // service is the single escape point and treats an empty or
      // whitespace-only value as "no search" (no default needed).
      search: t.arg.string({ required: false }),
      // Optional honest-SQL rating floor: `average_rating >= minRating`,
      // so an unrated teacher (NULL) is excluded whenever a floor is set.
      // Service-validated to a finite 0..5 value before any DB work.
      minRating: t.arg.float({ required: false }),
      // The post-tier ordering choice — the country tier ALWAYS sorts
      // first and the deterministic id tiebreak ALWAYS last. SDL default
      // `RATING_DESC` keeps the legacy ordering byte-identical.
      sort: t.arg({
        type: TeacherMatchingSortPothosEnum,
        required: false,
        defaultValue: TeacherMatchingSort.RatingDesc,
      }),
      page: t.arg.int({ required: false, defaultValue: 1 }),
      pageSize: t.arg.int({ required: false, defaultValue: 25 }),
    },
    description:
      "Student-only paged browse of eligible teachers for one Qira'ah + subject choice, narrowed optionally by a case-insensitive name search and a minimum rating, ordered by same-country affinity first, then the chosen sort (top-rated by default, with unrated last within a tier), then a stable id tiebreak. PII-minimal cards (display name, country, subjects, recitations, languages, average rating, online flag). Eligibility composes the availability flag with the no-active-session rule; out-of-range pages return empty items next to the honest total.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Student],
      },
    },
    resolve: async (_root, args, ctx) => {
      // The `$all { authenticated: true }` scope guarantees a verified user
      // row at resolution time (anonymous callers never get past the scope
      // step). This branch exists purely for TypeScript narrowing — the
      // repo-wide no-non-null-assertion rule forbids dereferencing the
      // nullable context directly; the thrown message resolves through
      // the request locale per the resolver localization contract and is
      // unreachable in practice.
      if (!ctx.user) {
        throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized);
      }
      // TypeScript narrowing belt for the wire `SessionIntent` → browse
      // vocabulary: the staff-driven `evaluation` intent is not a browse
      // choice. The localized denial mirrors the service's own
      // `ValidationError` copy and is unreachable for honest clients (the
      // UI offers only the two browse intents); the service re-validates
      // against the same set (defense-in-depth).
      if (!isBrowseIntent(args.intent)) {
        throw new ValidationError((await ctx.t("errorsTranslations")).validation);
      }
      // Identity is server-derived (BOLA — no id argument of any kind);
      // the locale propagates so every localized denial copy resolves
      // through the service's translation seam.
      return TeacherMatchingService.browseAvailableTeachers(
        ctx.user.id,
        {
          recitation: args.recitation,
          intent: args.intent,
          search: args.search ?? null,
          minRating: args.minRating ?? null,
          sort: args.sort ?? TeacherMatchingSort.RatingDesc,
          page: args.page ?? 1,
          pageSize: args.pageSize ?? 25,
        },
        ctx.locale
      );
    },
  })
);
