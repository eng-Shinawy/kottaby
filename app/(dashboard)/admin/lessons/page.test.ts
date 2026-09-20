/**
 * Admin Lessons Page Unit Tests
 *
 * Verifies:
 *  - REQ-060, REQ-061: Server component page metadata and export contract.
 *  - Frontend views barrel exports for lesson management.
 *  - REQ-060: the admin sidebar carries the `/admin/lessons` nav entry and
 *    `resolveNavItemLabel` resolves its label from the dashboard bundle in
 *    both locales.
 */

import { describe, expect, test } from "bun:test";
import * as lessonsPage from "@/app/(dashboard)/admin/lessons/page";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  LessonFormDialog,
  LessonsCatalogContainer,
  LessonsCatalogTable,
  LessonsDeleteConfirmDialog,
} from "@/frontend/views/admin/lessons";
import { getNavItemsForRole, resolveNavItemLabel } from "@/frontend/views/dashboard/nav";
import { dashboardAr } from "@/shared/locale/ar/dashboard";
import { handshakeCodeAr } from "@/shared/locale/ar/handshakeCode";
import { dashboardEn } from "@/shared/locale/en/dashboard";
import { handshakeCodeEn } from "@/shared/locale/en/handshakeCode";

describe("Admin Lessons Page (REQ-060)", () => {
  test("exposes localized generateMetadata (not static metadata)", () => {
    // REQ-061: metadata resolves per-request from the caller's locale cookie,
    // so the page exports `generateMetadata` instead of a static `metadata`
    // object. The function is not INVOKED here — it reads cookies via
    // next/headers, which requires a request scope only available in SSR.
    expect(typeof lessonsPage.generateMetadata).toBe("function");
  });

  test("frontend view components are exported correctly", () => {
    expect(typeof LessonsCatalogContainer).toBe("function");
    expect(typeof LessonsCatalogTable).toBe("function");
    expect(typeof LessonFormDialog).toBe("function");
    expect(typeof LessonsDeleteConfirmDialog).toBe("function");
  });

  test("admin nav carries the /admin/lessons entry with a resolvable label", () => {
    const adminItems = getNavItemsForRole(UserRole.Admin);
    const lessonsItem = adminItems.find(item => item.route === "/admin/lessons");
    expect(lessonsItem?.labelKey).toBe("lessons");
    if (lessonsItem) {
      expect(resolveNavItemLabel(lessonsItem, dashboardEn, handshakeCodeEn)).toBe("Lessons");
      expect(resolveNavItemLabel(lessonsItem, dashboardAr, handshakeCodeAr)).toBe("الدروس");
    }
  });
});
