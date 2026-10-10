/**
 * Schema registry census — the static decision-verification guard for the
 * §8 row 8.33 contract ("all enums validated, defined in the Drizzle schema").
 * DB-free by design: the Drizzle pgEnum objects and the TS mirror enum
 * objects are the structural ground truth — no connection, no fixtures, no
 * rollback transaction. The pgEnum registry and the mirrors are imported as
 * VALUE imports (their runtime member arrays are the object under census).
 *
 * Pinned invariants:
 *  - Registry exclusivity: the ONLY `pgEnum(` declarations in the schema tree
 *    live in `backend/db/schema/enums.ts` — a domain table file (or any other
 *    schema-tree module) declaring its own pgEnum fails the fs-walk.
 *  - Registry census: `enums.ts` exports EXACTLY the 21 pinned pgEnum keys,
 *    each resolving to the pinned live registry object with its pinned SQL
 *    name and member count.
 *  - Mirror parity: every pgEnum's `enumValues` are byte-identical
 *    (order-sensitive) to `Object.values(...)` of its `backend/enum/**` TS
 *    mirror — the registry-level drift oracle covering all 21.
 *  - Gap closure: the 13 enums that had no mirror-parity test additionally
 *    pin their exact member lists against a hardcoded canonical ground truth
 *    (assertion shape copied from the notification-type parity suite); the
 *    other 8 keep their own green per-enum suites and are not re-transcribed
 *    here (no duplicated green coverage).
 *
 * NON-VACUITY: the occurrence scanner is exercised against crafted in-memory
 * fixtures that MUST fire, and the registry file itself is the fs-walk's live
 * positive control (it must be in the corpus and must match the needle).
 *
 * DETERMINISM: file discovery sorts paths with localeCompare at read time.
 *
 * LEXICAL CAVEAT (accepted by design): a text-level scan can flag occurrences
 * inside comments/strings; false positives are visible and cheap to resolve,
 * and false negatives require intentionally obfuscated code which fails
 * review anyway.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPgEnum } from "drizzle-orm/pg-core";
import * as schemaEnums from "@/backend/db/schema/enums";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { BroadcastStatus } from "@/backend/enum/notifications/broadcast-status.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { RubricWeaknessArea } from "@/backend/enum/teachers/rubric-weakness-area.enum";
import { TeacherRequestPreference } from "@/backend/enum/teachers/teacher-request-preference.enum";
import { AppLocale } from "@/backend/enum/users/app-locale.enum";
import { Gender } from "@/backend/enum/users/gender.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";

/** Root of the Drizzle schema tree (repo-root anchored, like the audit corpus walk). */
const SCHEMA_ROOT = join(process.cwd(), "backend", "db", "schema");

/** The single file where pgEnum declarations are allowed to live. */
const REGISTRY_FILE = join(SCHEMA_ROOT, "enums.ts");

/** The declaration needle the exclusivity walk counts. */
const PG_ENUM_DECLARATION = "pgEnum(";

/** The read-only slice of a live pgEnum the census reads (structurally shared by every PgEnum). */
interface LivePgEnum {
  readonly enumName: string;
  readonly enumValues: readonly string[];
}

/** One census row: the export key, live registry object, TS mirror, and member count. */
interface RegistryRow {
  readonly exportName: string;
  readonly sqlName: string;
  readonly registry: LivePgEnum;
  readonly mirror: Record<string, string>;
  readonly memberCount: number;
  /** Hardcoded member ground truth — present ONLY for enums with no other parity pin. */
  readonly canonical?: readonly string[];
}

/**
 * The pinned registry inventory — all 21 pgEnums, export key → SQL name →
 * live registry object → TS mirror → member count. Rows WITHOUT `canonical`
 * are the 8 enums whose per-enum mirror-parity suites already pin the member
 * ground truth.
 */
const REGISTRY: readonly RegistryRow[] = [
  {
    exportName: "userRole",
    sqlName: "user_role",
    registry: schemaEnums.userRole,
    mirror: UserRole,
    memberCount: 4,
    canonical: ["admin", "teacher", "student", "parent"],
  },
  {
    exportName: "gender",
    sqlName: "gender",
    registry: schemaEnums.gender,
    mirror: Gender,
    memberCount: 2,
    canonical: ["male", "female"],
  },
  {
    exportName: "appLocale",
    sqlName: "app_locale",
    registry: schemaEnums.appLocale,
    mirror: AppLocale,
    memberCount: 2,
  },
  {
    exportName: "sessionStatus",
    sqlName: "session_status",
    registry: schemaEnums.sessionStatus,
    mirror: SessionStatus,
    memberCount: 5,
    canonical: ["scheduled", "started", "completed", "cancelled", "disputed"],
  },
  {
    exportName: "disputeResolution",
    sqlName: "dispute_resolution",
    registry: schemaEnums.disputeResolution,
    mirror: DisputeResolution,
    memberCount: 5,
  },
  {
    exportName: "sessionType",
    sqlName: "session_type",
    registry: schemaEnums.sessionType,
    mirror: SessionType,
    memberCount: 3,
    canonical: ["student_session", "teacher_evaluation", "re_evaluation"],
  },
  {
    exportName: "sessionIntent",
    sqlName: "session_intent",
    registry: schemaEnums.sessionIntent,
    mirror: SessionIntent,
    memberCount: 3,
    canonical: ["hifz", "tajweed", "evaluation"],
  },
  {
    exportName: "rubricWeaknessArea",
    sqlName: "rubric_weakness_area",
    registry: schemaEnums.rubricWeaknessArea,
    mirror: RubricWeaknessArea,
    memberCount: 2,
  },
  {
    exportName: "paymentStatus",
    sqlName: "payment_status",
    registry: schemaEnums.paymentStatus,
    mirror: PaymentStatus,
    memberCount: 4,
    canonical: ["pending", "paid", "failed", "refunded"],
  },
  {
    exportName: "transactionType",
    sqlName: "transaction_type",
    registry: schemaEnums.transactionType,
    mirror: TransactionType,
    memberCount: 4,
    canonical: ["earning", "withdrawal", "bonus", "arbitration_reversal"],
  },
  {
    exportName: "transactionStatus",
    sqlName: "transaction_status",
    registry: schemaEnums.transactionStatus,
    mirror: TransactionStatus,
    memberCount: 3,
    canonical: ["pending", "completed", "failed"],
  },
  {
    exportName: "paymentGateway",
    sqlName: "payment_gateway",
    registry: schemaEnums.paymentGateway,
    mirror: PaymentGateway,
    memberCount: 9,
    canonical: ["stripe", "paypal", "paymob", "fawry", "offline_cash", "bank_transfer", "scholarship", "other", "mock"],
  },
  {
    exportName: "subscriptionStatus",
    sqlName: "subscription_status",
    registry: schemaEnums.subscriptionStatus,
    mirror: SubscriptionStatus,
    memberCount: 5,
    canonical: ["active", "pending", "expired", "cancelled", "suspended"],
  },
  {
    exportName: "subscriptionCreditLane",
    sqlName: "subscription_credit_lane",
    registry: schemaEnums.subscriptionCreditLane,
    mirror: SubscriptionCreditLane,
    memberCount: 3,
    canonical: ["hifz", "tajweed", "reviews"],
  },
  {
    exportName: "linkStatus",
    sqlName: "link_status",
    registry: schemaEnums.linkStatus,
    mirror: LinkStatus,
    memberCount: 4,
  },
  {
    exportName: "notificationType",
    sqlName: "notification_type",
    registry: schemaEnums.notificationType,
    mirror: NotificationType,
    memberCount: 10,
  },
  {
    exportName: "auditActionType",
    sqlName: "audit_action_type",
    registry: schemaEnums.auditActionType,
    mirror: AuditActionType,
    memberCount: 7,
    canonical: ["create", "update", "delete", "override", "adjust", "suspend", "reactivate"],
  },
  {
    exportName: "surahJuzRef",
    sqlName: "surah_juz_ref",
    registry: schemaEnums.surahJuzRef,
    mirror: SurahJuzRef,
    memberCount: 144,
  },
  {
    exportName: "teacherRequestPreference",
    sqlName: "teacher_request_preference",
    registry: schemaEnums.teacherRequestPreference,
    mirror: TeacherRequestPreference,
    memberCount: 3,
    canonical: ["queue", "reject", "offer_alternatives"],
  },
  {
    exportName: "broadcastStatus",
    sqlName: "broadcast_status",
    registry: schemaEnums.broadcastStatus,
    mirror: BroadcastStatus,
    memberCount: 2,
  },
  {
    exportName: "broadcastAudienceType",
    sqlName: "broadcast_audience_type",
    registry: schemaEnums.broadcastAudienceType,
    mirror: BroadcastAudienceType,
    memberCount: 4,
  },
];

/** Type guard: the census rows that carry the hardcoded canonical member list. */
function hasCanonical(row: RegistryRow): row is RegistryRow & { readonly canonical: readonly string[] } {
  return row.canonical !== undefined;
}

/** The gap rows — the 13 pgEnums that had no mirror-parity test before this census. */
const GAP_ROWS: readonly (RegistryRow & { readonly canonical: readonly string[] })[] = REGISTRY.filter(hasCanonical);

/** The `exportName -> sqlName` pairs of a row set, sorted for census comparison. */
function sortedKeys(rows: readonly RegistryRow[]): string[] {
  return rows.map(row => row.exportName).toSorted((a, b) => a.localeCompare(b));
}

/** Every `.ts` file under a directory, sorted for deterministic traversal. */
function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listTsFiles(path));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files.toSorted((a, b) => a.localeCompare(b));
}

/** Non-overlapping count of `needle` occurrences in `content` (split is scan-free). */
function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

/** `Object.values(...)` of a TS string-enum mirror (its runtime member array). */
function mirrorMembers(mirror: Record<string, string>): string[] {
  return Object.values(mirror);
}

describe("schema registry census (§8 row 8.33)", () => {
  test("registry exclusivity: zero pgEnum( declarations outside enums.ts across the schema tree", () => {
    const corpus = listTsFiles(SCHEMA_ROOT);
    expect(corpus.length).toBeGreaterThanOrEqual(20);
    expect(corpus).toContain(REGISTRY_FILE);

    const offenders = corpus
      .filter(path => path !== REGISTRY_FILE)
      .filter(path => countOccurrences(readFileSync(path, "utf8"), PG_ENUM_DECLARATION) > 0);
    expect(offenders).toEqual([]);
  });

  test("fs-walk positive control: the registry file itself matches the needle at least 21 times", () => {
    const registryContent = readFileSync(REGISTRY_FILE, "utf8");
    expect(countOccurrences(registryContent, PG_ENUM_DECLARATION)).toBeGreaterThanOrEqual(REGISTRY.length);
  });

  test("scanner non-vacuity: crafted in-memory fixtures with a pgEnum declaration are counted, decoys are not", () => {
    expect(countOccurrences(`export const x = pgEnum("x", ["a"]);`, PG_ENUM_DECLARATION)).toBe(1);
    expect(countOccurrences(`pgEnum("a") + pgEnum("b")`, PG_ENUM_DECLARATION)).toBe(2);
    expect(countOccurrences(`isPgEnum(value); pgEnumValues; "pgEnum"`, PG_ENUM_DECLARATION)).toBe(0);
    expect(countOccurrences("", PG_ENUM_DECLARATION)).toBe(0);
  });

  test("registry census: enums.ts exports exactly the 21 pinned pgEnum keys, no more, no fewer", () => {
    expect(Object.keys(schemaEnums).toSorted((a, b) => a.localeCompare(b))).toEqual(sortedKeys(REGISTRY));
  });

  test("every pinned row resolves live: a pgEnum with matching SQL name and exact member count", () => {
    expect(REGISTRY).toHaveLength(21);
    expect(GAP_ROWS).toHaveLength(13);
    for (const row of REGISTRY) {
      expect(isPgEnum(row.registry)).toBe(true);
      expect(row.registry.enumName).toBe(row.sqlName);
      expect(row.registry.enumValues).toHaveLength(row.memberCount);
    }
  });

  describe("mirror parity — every pgEnum byte-identical to its TS mirror (order-sensitive)", () => {
    for (const row of REGISTRY) {
      test(`${row.sqlName}: ${row.memberCount} members, pgEnum ↔ mirror byte-identical`, () => {
        expect([...row.registry.enumValues].join("|")).toBe(mirrorMembers(row.mirror).join("|"));
        expect([...row.registry.enumValues]).toEqual(mirrorMembers(row.mirror));
      });
    }
  });

  describe("gap closure — the 13 enums without a prior parity pin, against hardcoded canonical members", () => {
    for (const row of GAP_ROWS) {
      test(`${row.sqlName}: pgEnum enumValues are exactly the ${row.canonical.length} canonical values, in order`, () => {
        expect([...row.registry.enumValues]).toEqual([...row.canonical]);
      });
      test(`${row.sqlName}: TS mirror Object.values are exactly the ${row.canonical.length} canonical values, in order`, () => {
        expect(mirrorMembers(row.mirror)).toEqual([...row.canonical]);
      });
    }
  });
});
