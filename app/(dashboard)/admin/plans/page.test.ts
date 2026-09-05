/**
 * Admin Plans Page Unit Tests — DEV1-005 Task 4.2.TE
 *
 * Verifies:
 *  - REQ-002, REQ-062, REQ-064: Server component page metadata and export contract.
 *  - Frontend views barrel exports for plan management.
 */

import { describe, expect, test } from "bun:test";
import * as plansPage from "@/app/(dashboard)/admin/plans/page";
import {
  PlanCatalogContainer,
  PlanCatalogTable,
  PlanFormDialog,
  PlanStatusConfirmDialog,
} from "@/frontend/views/admin/plans";

describe("Admin Plans Page (REQ-062)", () => {
  test("exposes localized generateMetadata (not static metadata)", () => {
    // REQ-062: metadata resolves per-request from the caller's locale cookie,
    // so the page exports `generateMetadata` instead of a static `metadata`
    // object. The function is not INVOKED here — it reads cookies via
    // next/headers, which requires a request scope only available in SSR.
    expect(typeof plansPage.generateMetadata).toBe("function");
  });

  test("frontend view components are exported correctly", () => {
    expect(typeof PlanCatalogContainer).toBe("function");
    expect(typeof PlanCatalogTable).toBe("function");
    expect(typeof PlanFormDialog).toBe("function");
    expect(typeof PlanStatusConfirmDialog).toBe("function");
  });
});
