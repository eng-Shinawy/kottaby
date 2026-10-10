#!/usr/bin/env bun
/**
 * Read-only live-database probe for the decision-verification schema-shape
 * rows (checklist section 8) — the launch gate spawns it through the row
 * registry's canonical command.
 *
 * Probe contract (shared across the launch probes):
 *   • Read-only — every statement is a catalog/information_schema SELECT;
 *     the probe never writes to the database, the filesystem, or any cache.
 *   • Emits one `ProbeLine` JSON record per stdout line
 *     (`{rowId, result, detail}`) and exits 0 iff every line is PASS.
 *   • Never silently skips: an unreachable database is a named FAIL line
 *     and a non-zero exit.
 *
 * Line inventory (in emission order):
 *   1. the connection line (a named FAIL when the database is unreachable —
 *      the row checks are not run);
 *   2. exactly one line per checklist row mapped to this probe
 *      (`DECISION_ROW_IDS`, derived from the row registry), each verifying
 *      that row's decision against the live catalog via `pg_enum` /
 *      `pg_constraint` / `information_schema` / `pg_trigger`;
 *   3. probe-scoped corroboration lines (rowIds namespaced like the
 *      connection line) for the decision-census inventory items whose
 *      checklist rows are proven by behavioral suites — the live-catalog
 *      half of those decisions is defense-in-depth for the sign-off
 *      record, and drift surfaces as its own named FAIL line.
 *
 * Every expectation is pinned catalog-level ground truth mirroring the
 * static enum census's canonical member lists. It is deliberately NOT
 * derived from schema code, so a schema-source edit can never silently
 * satisfy both halves of the census at once. Each line's detail always
 * reports what the live catalog holds versus what was decided, so a FAIL
 * names its drift and a PASS carries its own evidence.
 *
 * Usage:
 *   bun run scripts/launch/probe-decisions.ts [--help]
 *
 * Exit codes: 0 = every emitted line PASS; 1 = any line FAIL.
 */

import { sql } from "drizzle-orm";
import type { ProbeLine } from "@/scripts/launch/shared/launch-types";
import {
  type DbProbeCliOptions,
  type ProbeDb,
  probeDbConnection,
  rowIdsForCommand,
  runDbProbeCli,
} from "@/scripts/launch/shared/probe-cli";

/** This probe's own invocation — the registry rows cite it verbatim. */
const PROBE_COMMAND = "bun run scripts/launch/probe-decisions.ts";

/** Checklist rows this probe proves — derived from the row registry. */
export const DECISION_ROW_IDS: readonly string[] = rowIdsForCommand(PROBE_COMMAND);

/** rowId of the connection line (a named FAIL line when the database is unreachable). */
const CONNECTION_ROW_ID = "probe-decisions.connection";

const USAGE =
  "Usage: bun run scripts/launch/probe-decisions.ts [--help] — read-only live-database probe; exits 0 iff every emitted line is PASS.";

// ─── Pinned catalog expectations (mirrors of the static enum census) ─────────

const SESSION_TYPE_MEMBERS = ["student_session", "teacher_evaluation", "re_evaluation"] as const;
const SUBSCRIPTION_STATUS_MEMBERS = ["active", "pending", "expired", "cancelled", "suspended"] as const;
const SESSION_INTENT_MEMBERS = ["hifz", "tajweed", "evaluation"] as const;
const TEACHER_REQUEST_PREFERENCE_MEMBERS = ["queue", "reject", "offer_alternatives"] as const;
const USER_ROLE_MEMBERS = ["admin", "teacher", "student", "parent"] as const;
const DISPUTE_RESOLUTION_MEMBERS = ["Cancel", "Complete", "Refund", "PartialRefund", "Uphold"] as const;
const OFFLINE_PAYMENT_MEMBERS = ["bank_transfer", "offline_cash", "other", "scholarship"] as const;
const GOVERNANCE_COLUMNS: readonly string[] =
  "blocked_at deleted_at is_blocked is_deleted suspended suspended_at suspended_period_days".split(" ");
const GOVERNANCE_FLAG_COLUMNS: readonly string[] = "is_blocked is_deleted suspended".split(" ");
const GOVERNANCE_EXCLUSIVE_TABLES: readonly string[] = "admin parents students teacher".split(" ");
const REPORTS_COLUMNS: readonly string[] =
  "created_at id session_id student_rating_by_teacher teacher_notes updated_at".split(" ");

// ─── Catalog facts ────────────────────────────────────────────────────────────

/** One string-typed catalog row (column, constraint, index, or trigger facts). */
type ForeignRow = Record<string, string>;

/** One mapped enum check: rowId, enum name, pinned members, table, column. */
type EnumCheck = readonly [string, string, readonly string[], string, string];

/** The live-catalog snapshot every row check reads. */
interface DecisionFacts {
  readonly enums: ReadonlyMap<string, readonly string[]>;
  readonly columns: ReadonlyMap<string, ReadonlyMap<string, ForeignRow>>;
  readonly assignmentTables: readonly string[];
  readonly fks: readonly ForeignRow[];
  readonly uniques: readonly ForeignRow[];
  readonly subscriptionIndexes: readonly ForeignRow[];
  readonly auditTriggers: readonly ForeignRow[];
}

const ENUM_MEMBERS_QUERY = sql`SELECT t.typname AS enum_name, e.enumsortorder AS sort_order, e.enumlabel AS member FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' ORDER BY t.typname, e.enumsortorder`;

const COLUMN_FACTS_QUERY = sql`SELECT table_name, column_name, data_type, udt_name, character_maximum_length::text AS max_length, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('admin','applicants','audit_logs','evaluations','notifications','parents','recitation','reports','session','students','subscriptions','teacher','users')`;

/** Fields every column fact must carry to count as present in the snapshot. */
const REQUIRED_COLUMN_FIELDS: readonly string[] = ["table_name", "column_name", "data_type", "udt_name", "is_nullable"];

const ASSIGNMENT_TABLES_QUERY = sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name ILIKE '%assign%' OR table_name ILIKE '%allocat%')`;

const FK_CONSTRAINTS_QUERY = sql`SELECT c.conname AS name, t.relname AS table_name, rt.relname AS ref_table, c.confdeltype AS on_delete, (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM unnest(c.conkey) AS k(attnum) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS fk_columns FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_class rt ON rt.oid = c.confrelid WHERE n.nspname = 'public' AND c.contype = 'f' AND t.relname IN ('applicants','evaluations','parents','students','subscriptions')`;

const UNIQUE_CONSTRAINTS_QUERY = sql`SELECT c.conname AS name, t.relname AS table_name, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND c.contype = 'u' AND t.relname IN ('recitation','students')`;

const SUBSCRIPTION_INDEXES_QUERY = sql`SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'subscriptions'`;

const AUDIT_TRIGGERS_QUERY = sql`SELECT tgname AS name, tgenabled, pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid = to_regclass('public.audit_logs') AND NOT tgisinternal`;

/** Reads catalog rows as string records, dropping rows whose required fields are missing. */
function stringRowsOf(rows: readonly Record<string, unknown>[], required: readonly string[]): ForeignRow[] {
  const out: ForeignRow[] = [];
  for (const row of rows) {
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string") fields[key] = value;
    }
    if (required.every(key => fields[key] !== undefined)) out.push(fields);
  }
  return out;
}

async function fetchDecisionFacts(db: ProbeDb): Promise<DecisionFacts> {
  const [enumResult, columnResult, tableResult, fkResult, uniqueResult, indexResult, triggerResult] = await Promise.all(
    [
      ENUM_MEMBERS_QUERY,
      COLUMN_FACTS_QUERY,
      ASSIGNMENT_TABLES_QUERY,
      FK_CONSTRAINTS_QUERY,
      UNIQUE_CONSTRAINTS_QUERY,
      SUBSCRIPTION_INDEXES_QUERY,
      AUDIT_TRIGGERS_QUERY,
    ].map(query => db.execute(query))
  );
  const enums = new Map<string, string[]>();
  for (const row of stringRowsOf(enumResult.rows, ["enum_name", "member"])) {
    const list = enums.get(row.enum_name);
    if (list === undefined) enums.set(row.enum_name, [row.member]);
    else list.push(row.member);
  }
  const columns = new Map<string, Map<string, ForeignRow>>();
  for (const row of stringRowsOf(columnResult.rows, REQUIRED_COLUMN_FIELDS)) {
    const table = columns.get(row.table_name) ?? new Map<string, ForeignRow>();
    if (table.size === 0) columns.set(row.table_name, table);
    table.set(row.column_name, row);
  }
  return {
    enums,
    columns,
    assignmentTables: tableResult.rows.flatMap(row => (typeof row.table_name === "string" ? [row.table_name] : [])),
    fks: stringRowsOf(fkResult.rows, ["name", "table_name", "ref_table", "on_delete", "fk_columns"]),
    uniques: stringRowsOf(uniqueResult.rows, ["name", "table_name", "definition"]),
    subscriptionIndexes: stringRowsOf(indexResult.rows, ["name", "definition"]),
    auditTriggers: stringRowsOf(triggerResult.rows, ["name", "tgenabled", "definition"]),
  };
}

// ─── Row checks ──────────────────────────────────────────────────────────────

/** One verification line: the detail always reports the live catalog state. */
function decisionLine(rowId: string, ok: boolean, detail: string): ProbeLine {
  return { rowId, result: ok ? "PASS" : "FAIL", detail };
}

function columnFactOf(facts: DecisionFacts, table: string, column: string): ForeignRow | undefined {
  return facts.columns.get(table)?.get(column);
}

function fkTo(facts: DecisionFacts, table: string, column: string, refTable: string): ForeignRow | undefined {
  return facts.fks.find(fk => fk.table_name === table && fk.fk_columns === column && fk.ref_table === refTable);
}

function membersMatch(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return actual?.join("|") === expected.join("|");
}

const listOf = (members: readonly string[]): string => members.join(", ");

const DELETE_ACTIONS: Readonly<Record<string, string>> = { c: "CASCADE", n: "SET NULL", r: "RESTRICT" };

/** Human form of a catalog `confdeltype` code (c/r/n/a/d). */
const deleteActionOf = (code: string): string => DELETE_ACTIONS[code] ?? code;

/** Whether an audit trigger exists, is enabled, and fires for the given event. */
function triggerArmed(trigger: ForeignRow | undefined, event: string): boolean {
  return trigger !== undefined && trigger.tgenabled !== "D" && trigger.definition.includes(event);
}

/** State text for the audit-ledger corroboration detail. */
function triggerStateOf(trigger: ForeignRow | undefined): string {
  if (trigger === undefined) return "missing";
  const state = trigger.tgenabled === "D" ? "DISABLED" : "enabled";
  return `${state} (${trigger.definition})`;
}

/** FK action text for reviewer details. */
function actionTextOf(fk: ForeignRow | undefined): string {
  return fk === undefined ? "FK missing" : `ON DELETE ${deleteActionOf(fk.on_delete)}`;
}

/** Shared-PK child table check: `<table>.id` is a users(id) cascade FK. */
function sharedPkCascadeLine(facts: DecisionFacts, rowId: string, table: string): ProbeLine {
  const id = columnFactOf(facts, table, "id");
  const fk = fkTo(facts, table, "id", "users");
  const ok = id !== undefined && fk?.on_delete === "c";
  const fkText = fk === undefined ? "missing" : `${fk.name} ON DELETE ${deleteActionOf(fk.on_delete)}`;
  const detail = `${table} table ${id !== undefined ? "present" : "MISSING"}; ${table}.id → users(id) FK: ${fkText}${ok ? "" : " (expected CASCADE)"}`;
  return decisionLine(rowId, ok, detail);
}

/** Row 8.2 — the one-parent link plus the handshake-code uniqueness lock. */
function studentsParentLinkLine(facts: DecisionFacts): ProbeLine {
  const fk = fkTo(facts, "students", "parent_id", "users");
  const unique = facts.uniques.find(u => u.name === "students_handshake_code_unique" && u.table_name === "students");
  const fkOk = columnFactOf(facts, "students", "parent_id") !== undefined && fk?.on_delete === "n";
  const uniqueOk = unique?.definition === "UNIQUE (handshake_code)";
  const fkText = fk === undefined ? "missing" : `${fk.name} ON DELETE ${deleteActionOf(fk.on_delete)}`;
  const uniqueText = unique === undefined ? "missing" : unique.definition;
  const detail = `students.parent_id → users(id) FK: ${fkText}${fkOk ? "" : " (expected SET NULL)"}; students_handshake_code_unique: ${uniqueText}${uniqueOk ? "" : " (expected UNIQUE (handshake_code))"}`;
  return decisionLine("8.2", fkOk && uniqueOk, detail);
}

/** Row 8.4 — notifications events are typed by the notification_type enum. */
function notificationsLine(facts: DecisionFacts): ProbeLine {
  const type = columnFactOf(facts, "notifications", "type");
  if (type === undefined) return decisionLine("8.4", false, "notifications.type: column MISSING");
  const ok = type.udt_name === "notification_type" && type.data_type === "USER-DEFINED";
  const detail = `notifications table present; notifications.type — live: ${type.data_type}/${type.udt_name}`;
  return decisionLine("8.4", ok, detail);
}

/** Row 8.6 — teacher.subjects carries the JSON-array subject list in varchar(255). */
function teacherSubjectsLine(facts: DecisionFacts): ProbeLine {
  const subjects = columnFactOf(facts, "teacher", "subjects");
  if (subjects === undefined) return decisionLine("8.6", false, "teacher.subjects: column MISSING");
  const ok =
    subjects.udt_name === "varchar" && subjects.data_type === "character varying" && subjects.max_length === "255";
  const detail = `teacher table present (singular); teacher.subjects is varchar(255) JSON array — live: ${subjects.data_type}(${subjects.max_length ?? "—"})`;
  return decisionLine("8.6", ok, detail);
}

/** Enum-member checks — pinned pgEnum members plus the column consuming the enum. */
function typedEnumLine(facts: DecisionFacts, check: EnumCheck): ProbeLine {
  const [rowId, enumName, expected, table, column] = check;
  const live = facts.enums.get(enumName);
  const fact = columnFactOf(facts, table, column);
  const ok = membersMatch(live, expected) && fact?.udt_name === enumName;
  const detail = `${enumName} members: ${listOf(live ?? [])}; ${table}.${column} udt: ${fact?.udt_name ?? "—"}; expected members: ${listOf(expected)}`;
  return decisionLine(rowId, ok, detail);
}

/** Row 8.18 — generic purchaser ownership of a subscription. */
function subscriptionOwnerLine(facts: DecisionFacts): ProbeLine {
  const userId = columnFactOf(facts, "subscriptions", "user_id");
  const fk = fkTo(facts, "subscriptions", "user_id", "users");
  const ok = userId?.is_nullable === "NO" && fk?.on_delete === "r";
  const userText = userId === undefined ? "MISSING" : `present, NOT NULL: ${userId.is_nullable === "NO"}`;
  const fkText = fk === undefined ? "missing" : `${fk.name} ON DELETE ${deleteActionOf(fk.on_delete)}`;
  const detail = `subscriptions.user_id ${userText}; → users(id) FK: ${fkText}${fk?.on_delete === "r" ? "" : " (expected RESTRICT)"}`;
  return decisionLine("8.18", ok, detail);
}

/** Row 8.19 — offline payment fields plus the reference uniqueness lock. */
function offlinePaymentLine(facts: DecisionFacts): ProbeLine {
  const method = columnFactOf(facts, "subscriptions", "payment_method");
  const reference = columnFactOf(facts, "subscriptions", "payment_reference");
  const verifiedAt = columnFactOf(facts, "subscriptions", "payment_verified_at");
  const gateway = facts.enums.get("payment_gateway") ?? [];
  const referenceOk = reference?.data_type === "character varying" && reference?.max_length === "255";
  const columnsOk =
    verifiedAt?.data_type.startsWith("timestamp") === true && method?.udt_name === "payment_gateway" && referenceOk;
  const offlineOk = OFFLINE_PAYMENT_MEMBERS.every(member => gateway.includes(member));
  const index = facts.subscriptionIndexes.find(i => i.name === "subscriptions_payment_reference_unique");
  const def = index?.definition ?? "";
  const indexOk = def.includes("UNIQUE INDEX") && def.includes("(payment_reference)") && def.includes("IS NOT NULL");
  const referenceText = reference === undefined ? "MISSING" : `${reference.data_type}(${reference.max_length ?? "—"})`;
  const verifiedText = verifiedAt === undefined ? "MISSING" : verifiedAt.data_type;
  const indexText = index === undefined ? "missing" : index.definition;
  const detail = `offline fields: payment_method udt ${method?.udt_name ?? "—"}, payment_reference ${referenceText}, payment_verified_at ${verifiedText}; payment_gateway members: ${listOf(gateway)} (offline quartet expected); partial unique index subscriptions_payment_reference_unique: ${indexText}`;
  return decisionLine("8.19", columnsOk && offlineOk && indexOk, detail);
}

/** Row 8.20 — on-demand matching: no fixed assignment/allocation table exists. */
function onDemandMatchingLine(facts: DecisionFacts): ProbeLine {
  const matches = facts.assignmentTables;
  const detail = `fixed-assignment/allocation tables in schema public: ${matches.length === 0 ? "none (on-demand matching model)" : listOf(matches)}`;
  return decisionLine("8.20", matches.length === 0, detail);
}

/** Corroboration — the audit ledger's immutability triggers are armed. */
function auditImmutabilityLine(facts: DecisionFacts): ProbeLine {
  const update = facts.auditTriggers.find(t => t.name === "prevent_audit_logs_update_trigger");
  const del = facts.auditTriggers.find(t => t.name === "prevent_audit_logs_delete_trigger");
  const auditColumns = facts.columns.get("audit_logs")?.size ?? 0;
  const ok = auditColumns > 0 && triggerArmed(update, "BEFORE UPDATE") && triggerArmed(del, "BEFORE DELETE");
  const detail = `audit_logs columns: ${auditColumns}; update trigger: ${triggerStateOf(update)}; delete trigger: ${triggerStateOf(del)}`;
  return decisionLine("probe-decisions.audit-logs-immutability-triggers", ok, detail);
}

/** Corroboration — governance columns live on users ONLY. */
function governanceColumnsLine(facts: DecisionFacts): ProbeLine {
  const users = facts.columns.get("users");
  const allPresent = GOVERNANCE_COLUMNS.every(column => users?.has(column) ?? false);
  const flagsBoolean = GOVERNANCE_FLAG_COLUMNS.every(column => users?.get(column)?.data_type === "boolean");
  const tablesExist = GOVERNANCE_EXCLUSIVE_TABLES.every(table => (facts.columns.get(table)?.size ?? 0) > 0);
  const leaks = GOVERNANCE_EXCLUSIVE_TABLES.flatMap(table =>
    GOVERNANCE_COLUMNS.filter(c => facts.columns.get(table)?.has(c) === true).map(c => `${table}.${c}`)
  );
  const ok = allPresent && flagsBoolean && tablesExist && leaks.length === 0;
  const detail = `users governance columns present: ${allPresent}, boolean flags typed: ${flagsBoolean}; role tables present: ${tablesExist}; governance columns found elsewhere: ${leaks.length === 0 ? "none" : listOf(leaks)}`;
  return decisionLine("probe-decisions.users-governance-columns", ok, detail);
}

/** Corroboration — evaluations reviewer columns are mandatory users FKs. */
function evaluationsReviewerLine(facts: DecisionFacts): ProbeLine {
  const evaluated = columnFactOf(facts, "evaluations", "evaluated_id");
  const evaluator = columnFactOf(facts, "evaluations", "evaluator_id");
  const evaluatedFk = fkTo(facts, "evaluations", "evaluated_id", "users");
  const evaluatorFk = fkTo(facts, "evaluations", "evaluator_id", "users");
  const evaluatedOk = evaluated?.is_nullable === "NO" && evaluatedFk?.on_delete === "c";
  const evaluatorOk = evaluator?.is_nullable === "NO" && evaluatorFk?.on_delete === "r";
  const ok = evaluatedOk && evaluatorOk;
  const detail = `evaluated_id NOT NULL: ${evaluated?.is_nullable === "NO"}, ${actionTextOf(evaluatedFk)}${evaluatedFk?.on_delete === "c" ? "" : " (expected CASCADE)"}; evaluator_id NOT NULL: ${evaluator?.is_nullable === "NO"}, ${actionTextOf(evaluatorFk)}${evaluatorFk?.on_delete === "r" ? "" : " (expected RESTRICT)"}`;
  return decisionLine("probe-decisions.evaluations-reviewer-fks", ok, detail);
}

/** Corroboration — recitation is 1:1 with its session at the DB layer. */
function recitationSessionUniqueLine(facts: DecisionFacts): ProbeLine {
  const unique = facts.uniques.find(u => u.name === "recitation_session_id_unique" && u.table_name === "recitation");
  const ok = unique?.definition === "UNIQUE (session_id)";
  const detail = `recitation_session_id_unique: ${unique === undefined ? "missing" : unique.definition}`;
  return decisionLine("probe-decisions.recitation-session-unique", ok, detail);
}

/** Corroboration — reports carries no teacher_id (teacher via session_id). */
function reportsTeacherIdAbsentLine(facts: DecisionFacts): ProbeLine {
  const live = [...(facts.columns.get("reports")?.keys() ?? [])].toSorted((a, b) => a.localeCompare(b));
  const ok = live.join("|") === REPORTS_COLUMNS.join("|");
  const detail = `reports columns: ${listOf(live)}${live.includes("teacher_id") ? " — teacher_id UNEXPECTEDLY PRESENT" : " — no teacher_id"} (teacher reached via session_id)`;
  return decisionLine("probe-decisions.reports-teacher-id-absent", ok, detail);
}

/** Corroboration — the homework curriculum vocabulary is complete. */
function surahJuzRefCountLine(facts: DecisionFacts): ProbeLine {
  const live = facts.enums.get("surah_juz_ref");
  const ok = live?.length === 144;
  const detail = `surah_juz_ref member count: ${live === undefined ? "enum missing" : live.length} (expected 144: 114 surahs + 30 juz)`;
  return decisionLine("probe-decisions.surah-juz-ref-member-count", ok, detail);
}

/** Mapped enum rows 8.8–8.10, in registry order. */
const MAPPED_ENUM_CHECKS = [
  ["8.8", "session_type", SESSION_TYPE_MEMBERS, "session", "session_type"],
  ["8.9", "subscription_status", SUBSCRIPTION_STATUS_MEMBERS, "subscriptions", "status"],
  ["8.10", "session_intent", SESSION_INTENT_MEMBERS, "session", "intent"],
] as const;

/** Mapped enum row 8.26 (emitted after 8.20, per registry order). */
const LATE_ENUM_CHECKS = [
  ["8.26", "teacher_request_preference", TEACHER_REQUEST_PREFERENCE_MEMBERS, "teacher", "request_preference"],
] as const;

/** rowId of the dispute-resolution corroboration line. */
const DISPUTE_ROW_ID = "probe-decisions.dispute-resolution-members";

/** Corroboration enum rows — user_role and dispute_resolution, each with its consuming column. */
const MEMBER_SET_CHECKS = [
  ["probe-decisions.user-role-members", "user_role", USER_ROLE_MEMBERS, "users", "role"],
  [DISPUTE_ROW_ID, "dispute_resolution", DISPUTE_RESOLUTION_MEMBERS, "session", "resolution_outcome"],
] as const;

function decisionLines(facts: DecisionFacts): readonly ProbeLine[] {
  return [
    sharedPkCascadeLine(facts, "8.1", "parents"),
    studentsParentLinkLine(facts),
    notificationsLine(facts),
    teacherSubjectsLine(facts),
    ...MAPPED_ENUM_CHECKS.map(check => typedEnumLine(facts, check)),
    subscriptionOwnerLine(facts),
    offlinePaymentLine(facts),
    onDemandMatchingLine(facts),
    ...LATE_ENUM_CHECKS.map(check => typedEnumLine(facts, check)),
    auditImmutabilityLine(facts),
    sharedPkCascadeLine(facts, "probe-decisions.applicants-shared-pk", "applicants"),
    governanceColumnsLine(facts),
    ...MEMBER_SET_CHECKS.map(check => typedEnumLine(facts, check)),
    evaluationsReviewerLine(facts),
    recitationSessionUniqueLine(facts),
    reportsTeacherIdAbsentLine(facts),
    surahJuzRefCountLine(facts),
  ];
}

/**
 * The probe body: the connection probe first (so an unreachable database
 * is a single named FAIL row), then one verification line per mapped
 * registry row, then the probe-scoped corroboration lines.
 */
export async function probeDecisions(db: ProbeDb): Promise<readonly ProbeLine[]> {
  const connection = await probeDbConnection(db, CONNECTION_ROW_ID);
  if (connection.result === "FAIL") return [connection];
  const facts = await fetchDecisionFacts(db);
  return [connection, ...decisionLines(facts)];
}

/**
 * CLI entry point. Reads args (the tokens after the interpreter and script
 * path), opens the read-only database handle from the repo `.env` through
 * the shared client, and returns the process exit code.
 */
export async function main(
  args: readonly string[] = process.argv.slice(2),
  options: DbProbeCliOptions = {}
): Promise<number> {
  return runDbProbeCli(
    { probeName: "probe-decisions", usage: USAGE, connectionRowId: CONNECTION_ROW_ID, runProbe: probeDecisions },
    args,
    options
  );
}

if (import.meta.main) {
  main()
    .then(code => process.exit(code))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
