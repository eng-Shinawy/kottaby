/**
 * Namespace registry — the composed `namespaces` object (one entry per
 * locale namespace). Split out of the barrel `index.ts` so the barrel stays
 * a pure relative re-export surface (root AGENTS.md barrel conventions:
 * no import statements in `index.ts`).
 */
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";
import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";
import { Applicant } from "@/shared/locale/namespaces/applicant";
import { Auth } from "@/shared/locale/namespaces/auth";
import { Common } from "@/shared/locale/namespaces/common";
import { Dashboard } from "@/shared/locale/namespaces/dashboard";
import { Errors } from "@/shared/locale/namespaces/errors";
import { HandshakeCode } from "@/shared/locale/namespaces/handshakeCode";
import { Landing } from "@/shared/locale/namespaces/landing";
import { Notifications } from "@/shared/locale/namespaces/notifications";
import { ParentLink } from "@/shared/locale/namespaces/parentLink";
import { Plans } from "@/shared/locale/namespaces/plans";
import { Recitation } from "@/shared/locale/namespaces/recitation";
import { Sessions } from "@/shared/locale/namespaces/sessions";
import { Wallet } from "@/shared/locale/namespaces/wallet";

export const namespaces = {
  AdminBroadcasts,
  AdminUsers,
  Applicant,
  Auth,
  Common,
  Dashboard,
  Errors,
  HandshakeCode,
  Landing,
  Notifications,
  ParentLink,
  Plans,
  Recitation,
  Sessions,
  Wallet,
} as const;
