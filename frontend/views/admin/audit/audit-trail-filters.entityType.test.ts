/**
 * Audit-trail entity-type + CSV-export helper verification — pure unit tier
 * (NO server boot, NO network, NO DB). Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts frontend/views/admin/audit/audit-trail-filters.entityType.test.ts`.
 *
 * WHAT THIS LOCKS
 *  1. `entityTypeLabelOf` resolves every canonical entity-type wire value the
 *     backend mints (user, teacher, applicant, session, subscription, plan,
 *     teacher_transaction, parent_link_request*, notification_broadcast) to
 *     the localized `entityTypeLabels` copy in BOTH locales.
 *  2. FAIL-OPEN DISPLAY: a value outside the vocabulary renders verbatim —
 *     a future feature's new type is legible instead of blank.
 *  3. The CSV export carries the RAW wire values (action/entity type) and
 *     honest-empty null cells, with the localized header captions; the
 *     filename keeps the shared minute-precision stamp shape.
 */

import { describe, expect, test } from "bun:test";
import {
  type AdminAuditLogsQuery_adminAuditLogs_items,
  AuditActionType,
} from "@/frontend/graphql/generated/gql/graphql";
import { auditTrailCsvFilename, buildAuditTrailCsv } from "@/frontend/views/admin/audit/audit-trail-csv";
import { auditEntityIdContentOf, entityTypeLabelOf } from "@/frontend/views/admin/audit/audit-trail-filters";
import { adminUsersAr } from "@/shared/locale/ar/adminUsers";
import { adminUsersEn } from "@/shared/locale/en/adminUsers";

/** Every entity-type wire value the backend mints (backend constants sweep). */
const ALL_WIRE_TYPES = [
  "user",
  "teacher",
  "applicant",
  "session",
  "subscription",
  "plan",
  "teacher_transaction",
  "parent_link_request",
  "parent_link_request_decision",
  "parent_link_request_expiry",
  "notification_broadcast",
] as const;

/** One fully-typed trail entry fixture (the generated query item shape). */
function csvEntry(
  overrides: Partial<AdminAuditLogsQuery_adminAuditLogs_items> = {}
): AdminAuditLogsQuery_adminAuditLogs_items {
  return {
    id: "audit-entry-1",
    createdAt: "2026-09-20T10:00:00.000Z",
    actorId: 1,
    actorName: "Admin",
    actionType: AuditActionType.Update,
    entityType: "subscription",
    entityId: 3821,
    details: '{"addedDays":14}',
    ...overrides,
  };
}

describe("entityTypeLabelOf — localized display labels for the trail's entity chips", () => {
  test("resolves every canonical wire value in BOTH locales", () => {
    for (const wireType of ALL_WIRE_TYPES) {
      expect(entityTypeLabelOf(adminUsersEn.auditTrail, wireType).length).toBeGreaterThan(0);
      expect(entityTypeLabelOf(adminUsersAr.auditTrail, wireType).length).toBeGreaterThan(0);
    }
  });

  test("localizes the flagged jarring value: subscription renders non-Latin copy in ar", () => {
    expect(entityTypeLabelOf(adminUsersEn.auditTrail, "subscription")).toBe("Subscription");
    expect(entityTypeLabelOf(adminUsersAr.auditTrail, "subscription")).toBe("اشتراك");
  });

  test("the cooldown-governance mint: applicant resolves to the established applicant vocabulary in BOTH locales", () => {
    expect(entityTypeLabelOf(adminUsersEn.auditTrail, "applicant")).toBe("Teacher Applicant");
    expect(entityTypeLabelOf(adminUsersAr.auditTrail, "applicant")).toBe("متقدم للتدريس");
  });

  test("an unknown wire value renders VERBATIM (fail-open display, never blank)", () => {
    expect(entityTypeLabelOf(adminUsersEn.auditTrail, "future_thing")).toBe("future_thing");
    expect(entityTypeLabelOf(adminUsersAr.auditTrail, "future_thing")).toBe("future_thing");
  });
});

describe("auditEntityIdContentOf — which trail rows navigate to the account", () => {
  test("both ACCOUNT arms navigate: user AND applicant resolve to the account deep link", () => {
    // `applicants` is a shared-PK child of `users` — the applicant row's
    // entity_id IS the affected account's id, so the deep link is honest by
    // the same construction as the user arm.
    expect(auditEntityIdContentOf({ entityType: "user", entityId: 1478 })).toEqual({
      kind: "accountLink",
      userId: 1478,
    });
    expect(auditEntityIdContentOf({ entityType: "applicant", entityId: 1478 })).toEqual({
      kind: "accountLink",
      userId: 1478,
    });
  });

  test("every non-account entity keeps the plain id atom (no false navigation)", () => {
    for (const wireType of ALL_WIRE_TYPES) {
      if (wireType === "user" || wireType === "applicant") continue;
      expect(auditEntityIdContentOf({ entityType: wireType, entityId: 3821 })).toEqual({
        kind: "plainId",
        entityId: 3821,
      });
    }
  });

  test("absent entity ids render the em-dash decision regardless of the entity arm", () => {
    expect(auditEntityIdContentOf({ entityType: "user", entityId: null })).toEqual({ kind: "null" });
    expect(auditEntityIdContentOf({ entityType: "applicant", entityId: null })).toEqual({ kind: "null" });
    expect(auditEntityIdContentOf({ entityType: "plan", entityId: null })).toEqual({ kind: "null" });
  });
});

describe("buildAuditTrailCsv — page export serialization", () => {
  test("localizes the header captions and keeps VALUES as raw wire data", () => {
    const csv = buildAuditTrailCsv([csvEntry()], adminUsersEn);
    // The document opens with the shared UTF-8 BOM (spreadsheet-friendly).
    const lines = csv.replace(/^\uFEFF/, "").split("\n");
    expect(lines[0]).toBe("When,Actor,Action,Entity type,Entity ID,Details");
    // A details payload always carries quotes → the RFC-4180 escaper wraps it.
    expect(lines[1]).toBe('2026-09-20T10:00:00.000Z,Admin,Update,subscription,3821,"{""addedDays"":14}"');
  });

  test("honest-null entity ids and details serialize as EMPTY cells (never the — affordance)", () => {
    const csv = buildAuditTrailCsv([csvEntry({ entityId: null, details: null })], adminUsersEn);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("2026-09-20T10:00:00.000Z,Admin,Update,subscription,,");
  });

  test("the details JSON payload is RFC-4180 escaped when it carries quotes", () => {
    const csv = buildAuditTrailCsv([csvEntry({ details: '{"reason":"said "hold""}' })], adminUsersEn);
    const lines = csv.split("\n");
    expect(lines[1]).toBe('2026-09-20T10:00:00.000Z,Admin,Update,subscription,3821,"{""reason"":""said ""hold""""}"');
  });

  test("the filename keeps the shared stamped shape (minute precision)", () => {
    const filename = auditTrailCsvFilename(new Date(Date.UTC(2026, 8, 20, 14, 9)));
    expect(filename).toBe("audit-trail-page-2026-09-20-1409.csv");
  });
});
