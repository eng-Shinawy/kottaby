/**
 * directoryConversions — runtime-validated conversions between the local
 * directory filter unions (`DirectoryRole` / `DirectoryGovernance`) and the
 * GraphQL-codegen enums (`UserRole` / `AdminUserGovernanceFilter`).
 *
 * The two sides carry the same underlying string values but TS treats them
 * as distinct nominal types. The exhaustive switches below perform a real
 * per-branch mapping — no `as unknown as ...` cast (which would trip
 * `no-unsafe-type-assertion`). If a future member lands on the local union
 * without a case update, TypeScript fails the exhaustiveness check.
 */

import { AdminUserGovernanceFilter, UserRole } from "@/frontend/graphql/generated/gql/graphql";
import type { DirectoryGovernance, DirectoryRole } from "@/frontend/views/admin/users/utils";

/**
 * Runtime-validated conversion from the local `DirectoryRole` string-literal
 * union to the GraphQL-codegen `UserRole` enum. `DirectoryRole` and
 * `UserRole` carry the same underlying string values
 * (`"Admin" | "Parent" | "Student" | "Teacher"`) but TS treats them as
 * distinct nominal types. The exhaustive switch below performs a real
 * per-branch mapping — no `as unknown as UserRole` cast (which would trip
 * `no-unsafe-type-assertion`). The branch set is the complete `DirectoryRole`
 * union; if a new role is added to `DirectoryRole` but not here, TS will
 * fail the noFallthroughCasesInSwitch / exhaustiveness check.
 */
export function toUserRole(role: DirectoryRole): UserRole {
  switch (role) {
    case "Admin":
      return UserRole.Admin;
    case "Teacher":
      return UserRole.Teacher;
    case "Student":
      return UserRole.Student;
    case "Parent":
      return UserRole.Parent;
  }
  // Exhaustive-switch fallback — TypeScript knows `DirectoryRole` is fully
  // covered above, but `consistent-return` requires every code path to return
  // OR none. Return Student (the default role for new public registrations)
  // if a future role member lands here without a case update.
  return UserRole.Student;
}

/**
 * Runtime-validated conversion from the local `DirectoryGovernance`
 * string-literal union to the GraphQL-codegen `AdminUserGovernanceFilter`
 * enum. Same rationale as `toUserRole`: same underlying string values,
 * exhaustive switch, no `as` cast.
 */
export function toGovernanceFilter(governance: DirectoryGovernance): AdminUserGovernanceFilter {
  switch (governance) {
    case "Active":
      return AdminUserGovernanceFilter.Active;
    case "Suspended":
      return AdminUserGovernanceFilter.Suspended;
    case "Blocked":
      return AdminUserGovernanceFilter.Blocked;
    case "Deleted":
      return AdminUserGovernanceFilter.Deleted;
  }
  // Exhaustive-switch fallback — TypeScript knows `DirectoryGovernance` is
  // fully covered above, but `consistent-return` requires every code path to
  // return OR none. Return Active (the default governance for new accounts)
  // if a future governance member lands here without a case update.
  return AdminUserGovernanceFilter.Active;
}
