/**
 * Namespace registry — the composed `namespaces` object (one entry per
 * locale namespace). Split out of the barrel `index.ts` so the barrel stays
 * a pure relative re-export surface (root AGENTS.md barrel conventions:
 * no import statements in `index.ts`).
 */
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";
import { AdminSessionGovernance } from "@/shared/locale/namespaces/adminSessionGovernance";
import { AdminStudents } from "@/shared/locale/namespaces/adminStudents";
import { AdminTeachers } from "@/shared/locale/namespaces/adminTeachers";
import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";
import { Analytics } from "@/shared/locale/namespaces/analytics";
import { Applicant } from "@/shared/locale/namespaces/applicant";
import { Auth } from "@/shared/locale/namespaces/auth";
import { Checkout } from "@/shared/locale/namespaces/checkout";
import { Common } from "@/shared/locale/namespaces/common";
import { Dashboard } from "@/shared/locale/namespaces/dashboard";
import { Errors } from "@/shared/locale/namespaces/errors";
import { HandshakeCode } from "@/shared/locale/namespaces/handshakeCode";
import { Homework } from "@/shared/locale/namespaces/homework";
import { Landing } from "@/shared/locale/namespaces/landing";
import { Lessons } from "@/shared/locale/namespaces/lessons";
import { Notifications } from "@/shared/locale/namespaces/notifications";
import { ParentLink } from "@/shared/locale/namespaces/parentLink";
import { ParentMonitoring } from "@/shared/locale/namespaces/parentMonitoring";
import { Plans } from "@/shared/locale/namespaces/plans";
import { Recitation } from "@/shared/locale/namespaces/recitation";
import { Schedule } from "@/shared/locale/namespaces/schedule";
import { Sessions } from "@/shared/locale/namespaces/sessions";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";
import { SubscriptionAdmin } from "@/shared/locale/namespaces/subscriptionAdmin";
import { UpNext } from "@/shared/locale/namespaces/upNext";
import { Wallet } from "@/shared/locale/namespaces/wallet";

export const namespaces = {
  AdminBroadcasts,
  AdminFinance,
  AdminSessionGovernance,
  AdminStudents,
  AdminTeachers,
  AdminUsers,
  Analytics,
  Applicant,
  Auth,
  Checkout,
  Common,
  Dashboard,
  Errors,
  HandshakeCode,
  Homework,
  Landing,
  Lessons,
  Notifications,
  ParentLink,
  ParentMonitoring,
  Plans,
  Recitation,
  Sessions,
  Schedule,
  UpNext,
  SubscriptionAdmin,
  StudentOnboarding,
  Wallet,
} as const;
