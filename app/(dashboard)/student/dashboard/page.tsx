import { UserRole } from "@/backend/enum/users/user-role.enum";
import { createRoleDashboardPage, roleDashboardMetadata } from "@/frontend/views/dashboard/home/server";

export const metadata = roleDashboardMetadata();

export default function StudentDashboardPage() {
  return createRoleDashboardPage(UserRole.Student, "/student/dashboard");
}
