import { UserRole } from "@/backend/enum/users/user-role.enum";
import { createRoleDashboardPage, roleDashboardMetadata } from "@/frontend/views/dashboard/home/server";

export const metadata = roleDashboardMetadata();

export default function ParentDashboardPage() {
  return createRoleDashboardPage(UserRole.Parent, "/parent/dashboard");
}
