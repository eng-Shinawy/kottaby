/**
 * User-domain Pothos field factories — shared field-definition + resolver
 * helpers consumed by the user-domain surfaces (jscpd clone elimination,
 * per `backend/graphql/AGENTS.md` §Pothos Field Factories):
 *
 *  - `resolveUserRole` / `userRoleField` — the resolved non-null `role`
 *    field (`UserRolePothosEnum`) shared by `User`, `AdminUserListItem`,
 *    and `AdminUserDetail`.
 *  - `resolveNullableUserGender` / `nullableUserGenderField` — the resolved
 *    nullable `gender` field (`GenderPothosEnum`) shared by the same three
 *    objects.
 *  - `userRegistrationInputFields` — the public registration input whitelist
 *    (`fullName/email/phone/password/gender/country/role`) shared by
 *    `RegisterUserInput` and `AdminCreateUserInput`; `admin` stays
 *    structurally excluded via `RegisterPublicRolePothosEnum` (BFLA).
 *
 * Both enum resolvers are fail-closed: an unexpected stored value throws at
 * resolve time instead of leaking through as an unsafe cast.
 *
 * All builders are typed against `GqlSchemaTypes`, derived from the
 * canonical `gqlSchemaBuilder` instance, so helpers accept the same field
 * builders the domain `fields: t => ({...})` callbacks receive.
 */
import type { InputFieldBuilder, ObjectFieldBuilder } from "@pothos/core";
import { type Gender, toGender } from "@/backend/enum/users/gender.enum";
import { toUserRole, type UserRole } from "@/backend/enum/users/user-role.enum";
import type { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  GenderPothosEnum,
  RegisterPublicRolePothosEnum,
  UserRolePothosEnum,
} from "@/backend/graphql/pothos/shared/enum.pothos";

/**
 * The `SchemaTypes` of the canonical `gqlSchemaBuilder` — derived from the
 * instance so helper signatures track the builder's context/defaults/scalars
 * without duplicating the builder's type parameter.
 */
type GqlSchemaTypes = typeof gqlSchemaBuilder extends PothosSchemaTypes.SchemaBuilder<infer Types> ? Types : never;

/**
 * `role` field resolver — maps the raw pgEnum string to the `UserRole` TS
 * enum via `toUserRole`. Fail-closed: a corrupt stored value surfaces as a
 * resolver error rather than an unsafe cast.
 */
export function resolveUserRole(parent: { readonly role: string }): UserRole {
  const role = toUserRole(parent.role);
  if (role === null) {
    throw new Error(`Unexpected user role: ${parent.role}`);
  }
  return role;
}

/**
 * Nullable `gender` field resolver — maps the raw pgEnum string to the
 * `Gender` TS enum via `toGender`; `null`/empty short-circuits to `null`.
 * Fail-closed: a corrupt stored value surfaces as a resolver error rather
 * than an unsafe cast.
 */
export function resolveNullableUserGender(parent: { readonly gender: string | null }): Gender | null {
  if (!parent.gender) return null;
  const gender = toGender(parent.gender);
  if (gender === null) {
    throw new Error(`Unexpected user gender: ${parent.gender}`);
  }
  return gender;
}

/**
 * The resolved, non-nullable `role: UserRole!` object field.
 */
export function userRoleField<Shape extends { readonly role: string }>(t: ObjectFieldBuilder<GqlSchemaTypes, Shape>) {
  return t.field({ type: UserRolePothosEnum, resolve: resolveUserRole });
}

/**
 * The resolved, nullable `gender: Gender` object field.
 */
export function nullableUserGenderField<Shape extends { readonly gender: string | null }>(
  t: ObjectFieldBuilder<GqlSchemaTypes, Shape>
) {
  return t.field({ type: GenderPothosEnum, nullable: true, resolve: resolveNullableUserGender });
}

/**
 * The public user-registration input whitelist, shared (identical field
 * definitions — names, requiredness, and enum types) by `RegisterUserInput`
 * and `AdminCreateUserInput`. `role` uses `RegisterPublicRolePothosEnum`
 * (student/teacher/parent — `admin` structurally excluded at the schema
 * layer; BFLA-safe).
 */
export function userRegistrationInputFields(t: InputFieldBuilder<GqlSchemaTypes, "InputObject">) {
  return {
    fullName: t.string({ required: true }),
    email: t.string({ required: true }),
    phone: t.string({ required: true }),
    password: t.string({ required: true }),
    gender: t.field({ type: GenderPothosEnum, required: false }),
    country: t.string({ required: true }),
    role: t.field({ type: RegisterPublicRolePothosEnum, required: true }),
  };
}
