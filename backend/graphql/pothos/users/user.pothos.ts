/**
 * UserPothosObject — the single canonical GraphQL object type for `User`.
 *
 * Per `backend/graphql/AGENTS.md` (Single Canonical Object Type Pattern):
 *  - Uses `RegistrationReturnType` from `@/backend/types` as the underlying
 *    type reference (NOT a local type definition).
 *  - Backed by `gqlSchemaBuilder.objectRef<RegistrationReturnType>("User")`.
 *  - Exposes `id` (Int — Apollo cache normalization), `email`, `fullName`,
 *    `role`, plus the profile-page fields (`phone`, `country`, `gender`,
 *    `locale`) and the read-only governance fields (`isDeleted`,
 *    `suspended`, `isBlocked`, `mustChangePassword`). The `passwordHash`
 *    field is structurally omitted from `RegistrationReturnType` so it can
 *    never leak.
 *
 * Additional fields (relationships, computed props) may be added on this same
 * object in future tickets — GraphQL's selection mechanism lets clients
 * request only what they need.
 */
import { toAppLocale } from "@/backend/enum/users/app-locale.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { AppLocalePothosEnum, RecitationReadingPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import { nullableUserGenderField, userRoleField } from "@/backend/graphql/pothos/shared/userFieldHelpers";
import { ValidationError } from "@/backend/lib/errors";
import type { RegistrationReturnType } from "@/backend/types";

/**
 * The canonical `User` GraphQL object. Resolvers return
 * `RegistrationReturnType` (a `UserSelectType` with `passwordHash` stripped +
 * `preferredRecitation` attached).
 */
export const UserPothosObject = gqlSchemaBuilder.objectRef<RegistrationReturnType>("User").implement({
  fields: t => ({
    // Int ID — Apollo cache normalization requires `id` on every object.
    id: t.exposeInt("id"),
    email: t.exposeString("email"),
    fullName: t.exposeString("fullName"),
    // Nullable — phone is optional in the schema.
    phone: t.exposeString("phone", { nullable: true }),
    // Nullable — country is optional in the schema.
    country: t.exposeString("country", { nullable: true }),
    // Nullable — locale is optional in the schema (unset until the user
    // explicitly picks one; registration leaves it null by the D2 deferred
    // decision). Same shape as `gender`: a closed pgEnum surfaced through
    // the shared Pothos enum registry + the `toAppLocale` safe mapper.
    locale: t.field({
      type: AppLocalePothosEnum,
      nullable: true,
      resolve: async (parent, _args, ctx) => {
        if (!parent.locale) return null;
        const locale = toAppLocale(parent.locale);
        if (locale === null) {
          // Fail-closed deny on a corrupt stored enum (the applicantStatusCorrupt
          // precedent) — translated per the resolver-i18n rule via ctx.t.
          const tErrors = await ctx.t("errorsTranslations");
          throw new ValidationError("USER_LOCALE_CORRUPT", tErrors.userLocaleCorrupt);
        }
        return locale;
      },
    }),
    // Nullable — gender is optional in the schema.
    gender: nullableUserGenderField(t),
    // `RegistrationReturnType.role` is the `userRole` pgEnum string union
    // ("admin" | "teacher" | "student" | "parent"); mapped to the `UserRole`
    // TS enum for Pothos's `ValuesFromEnum` slot by the shared
    // `resolveUserRole` resolver (fail-closed on unexpected values).
    role: userRoleField(t),
    // Echo the validated preferred recitation reading (contract
    // metadata — NOT persisted to the `recitation` table). Nullable: null when
    // the user didn't select a reading during registration.
    preferredRecitation: t.field({
      type: RecitationReadingPothosEnum,
      nullable: true,
      description:
        "The user's preferred recitation reading (Qira'ah), selected during registration. Contract metadata — not persisted to the session-linked `recitation` table (C.5).",
      resolve: parent => parent.preferredRecitation ?? null,
    }),
    // Read-only governance fields — exposed so the profile page can show
    // account status badges. These are server-controlled — clients
    // cannot mutate them through any input type. The DB columns are
    // `boolean | null` (Drizzle types them as nullable since they lack
    // `.notNull()`), so we resolve null → false at the GraphQL layer to
    // present a non-nullable Boolean to clients.
    isDeleted: t.boolean({
      resolve: parent => parent.isDeleted ?? false,
    }),
    suspended: t.boolean({
      resolve: parent => parent.suspended ?? false,
    }),
    isBlocked: t.boolean({
      resolve: parent => parent.isBlocked ?? false,
    }),
    // Read-only credential-governance flag — "require this credential to be
    // replaced on next login". Written only by the admin credential
    // mutation, cleared only by the self-service change path — clients
    // cannot mutate it through any input type. The column is `notNull` with
    // a `false` server default; the `?? false` mirrors the sibling
    // governance booleans above so the resolver stays total.
    mustChangePassword: t.boolean({
      resolve: parent => parent.mustChangePassword ?? false,
    }),
  }),
});

/**
 * Closed self-service credential input — the argument surface of the
 * `changeMyPassword` mutation. EXACTLY two required fields; the shape
 * is structurally final, so `passwordHash`, `email`, `role`, the locale
 * preference, and every governance field (incl. `mustChangePassword` itself)
 * are unreachable through it — the flag clears ONLY through the service's
 * verified write path, never through client input.
 *
 * BOPLA discipline: identity is NEVER an input member — the resolver derives
 * it exclusively from the verified context (`ctx.user.id`), so a caller can
 * only ever target its own row. Both members are PLAINTEXT credentials: they
 * exist only for the duration of the service call, are verified/hashed
 * (`comparePassword` → `hashPassword`) before persistence, and are never
 * stored, logged, audited, or echoed back.
 */
export const ChangeMyPasswordInput = gqlSchemaBuilder.inputType("ChangeMyPasswordInput", {
  fields: t => ({
    currentPassword: t.string({ required: true }),
    newPassword: t.string({ required: true }),
  }),
});
