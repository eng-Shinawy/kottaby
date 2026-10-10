/**
 * Pure catalog-audit logic for the index verification tool.
 *
 * The audit answers one question from the live PostgreSQL catalog: does
 * every foreign-key-constrained column have a usable btree index? An FK
 * column is covered when some btree index on the same table lists the
 * column as its leading key column, or when the constraint's referencing
 * columns, in declaration order, form a prefix of an index's key
 * columns. Primary-key and unique-constraint backing counts as coverage
 * because PostgreSQL implements both as btree indexes that appear in the
 * catalog exactly like plain indexes.
 *
 * The matching pipeline's driving columns (`teacher.is_online`,
 * `teacher.is_approved`, `teacher.average_rating` — the eligibility
 * filters and the rating sort) are reported with the same
 * leading-column lens, plus the planner's actual index choice taken from
 * an EXPLAIN of the matching-shaped read: index existence and planner
 * usage are both evidence, and only the FK coverage is gated.
 *
 * Everything here is pure: catalog rows in, facts out. The entrypoint
 * owns the catalog SQL, the destructive-target guard, and the report
 * lifecycle.
 */

/** One referencing column of one foreign-key constraint, from the catalog join. */
export type FkColumnRow = {
  readonly constraintName: string;
  readonly schemaName: string;
  readonly tableName: string;
  readonly ordinal: number;
  readonly columnName: string;
};

/** One index exactly as `pg_indexes` reports it. */
export type IndexRow = {
  readonly schemaName: string;
  readonly tableName: string;
  readonly indexName: string;
  readonly indexDefinition: string;
};

/** Parsed index definition; an element is a plain column name, or null for an expression key part. */
export interface ParsedIndex {
  readonly indexName: string;
  readonly accessMethod: string;
  readonly elements: readonly (string | null)[];
}

/** Per-FK-column coverage verdict with the indexes that provide the coverage. */
export interface FkColumnCoverage {
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  readonly ordinal: number;
  readonly columnName: string;
  readonly covered: boolean;
  readonly coveringIndexNames: readonly string[];
}

/** One FK constraint with its referencing columns in declaration order. */
interface GroupedFkConstraint {
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  readonly columns: readonly string[];
}

/** Leading-column coverage fact for a matching-pipeline driving column. */
export interface HotColumnCoverage {
  readonly table: string;
  readonly column: string;
  readonly leadingIndexNames: readonly string[];
}

/**
 * Pre-remediation documentation of FK columns that historically shipped
 * without indexes. The audit itself always derives from the live
 * catalog — this list exists so reports can call out whether the
 * observed gap set matches the documented baseline.
 */
export const DOCUMENTED_UNCOVERED_FK_COLUMNS: readonly string[] = [
  "session_request_idempotency.session_id",
  "subscription_purchase_idempotency.subscription_id",
  "broadcasts.sent_by_id",
  "broadcasts.stopped_by_id",
];

/** The matching pipeline's driving table and its filter/sort hot columns. */
export const HOT_COLUMN_TABLE = "teacher";
export const HOT_COLUMN_NAMES: readonly string[] = ["is_online", "is_approved", "average_rating"];

const USING_CLAUSE_PATTERN = /\busing\s+([a-z_]+)\s+\(/i;

/** Returns the balanced body inside the parentheses starting at `openIndex`, or null when unbalanced. */
function extractParenthesizedBody(text: string, openIndex: number): string | null {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(openIndex + 1, i);
      }
    }
  }
  return null;
}

/** Splits an index key body on top-level commas (parenthesized expressions stay whole). */
function splitTopLevel(body: string): readonly string[] {
  const elements: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of body) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }
    if (char === "," && depth === 0) {
      if (current.trim().length > 0) {
        elements.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) {
    elements.push(current.trim());
  }
  return elements;
}

/**
 * True when the remainder after an index key part consists only of the
 * ordering/collation/opclass qualifiers PostgreSQL may append (ASC,
 * DESC, NULLS FIRST|LAST, COLLATE <target>, `*_ops` operator classes).
 * Anything else means the part is an expression, not a plain column.
 */
function qualifiersOnly(rest: string): boolean {
  const tokens = rest
    .trim()
    .split(/\s+/)
    .filter(token => token.length > 0);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i].toLowerCase();
    if (token === "asc" || token === "desc") {
      i += 1;
      continue;
    }
    if (token === "nulls") {
      const next = (tokens[i + 1] ?? "").toLowerCase();
      if (next === "first" || next === "last") {
        i += 2;
        continue;
      }
    }
    if (token === "collate") {
      i += 2;
      continue;
    }
    if (token.endsWith("_ops")) {
      i += 1;
      continue;
    }
    return false;
  }
  return true;
}

/** Parses a double-quoted identifier key part (`""` escapes included), scanning instead of regexing. */
function parseQuotedElement(element: string): string | null {
  let name = "";
  let index = 1;
  while (index < element.length) {
    const char = element.charAt(index);
    if (char === '"') {
      if (element.charAt(index + 1) === '"') {
        name += '"';
        index += 2;
        continue;
      }
      break;
    }
    name += char;
    index += 1;
  }
  if (index >= element.length || !qualifiersOnly(element.slice(index + 1))) {
    return null;
  }
  return name;
}

const IDENTIFIER_PREFIX_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*/;

/** Parses one index key part into a plain column name, or null for expressions. */
function parseIndexElement(element: string): string | null {
  if (element.startsWith('"')) {
    return parseQuotedElement(element);
  }
  if (element.startsWith("(")) {
    return null;
  }
  const match = IDENTIFIER_PREFIX_PATTERN.exec(element);
  if (!match || !qualifiersOnly(element.slice(match[0].length))) {
    return null;
  }
  return match[0];
}

/**
 * Parses an `pg_indexes.indexdef` string into its access method and
 * ordered key parts. Returns null when the definition has no parseable
 * `USING <method> (<keys>)` clause — the caller then treats the index
 * as non-covering (conservative: an unreadable index never proves
 * coverage).
 */
export function parseIndexDefinition(row: IndexRow): ParsedIndex | null {
  const using = USING_CLAUSE_PATTERN.exec(row.indexDefinition);
  if (!using) {
    return null;
  }
  const body = extractParenthesizedBody(row.indexDefinition, using.index + using[0].length - 1);
  if (body === null) {
    return null;
  }
  return {
    indexName: row.indexName,
    accessMethod: using[1].toLowerCase(),
    elements: splitTopLevel(body).map(element => parseIndexElement(element)),
  };
}

/** Groups FK column rows into constraints with declaration-ordered columns (duplicate rows collapse). */
export function groupFkConstraints(fkRows: readonly FkColumnRow[]): readonly GroupedFkConstraint[] {
  const sorted = fkRows.toSorted((a, b) =>
    `${a.schemaName}.${a.tableName}.${a.constraintName}.${a.ordinal}`.localeCompare(
      `${b.schemaName}.${b.tableName}.${b.constraintName}.${b.ordinal}`
    )
  );
  const byKey = new Map<
    string,
    { schemaName: string; tableName: string; constraintName: string; columnsByOrdinal: Map<number, string> }
  >();
  for (const row of sorted) {
    const key = `${row.schemaName}.${row.tableName}.${row.constraintName}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        schemaName: row.schemaName,
        tableName: row.tableName,
        constraintName: row.constraintName,
        columnsByOrdinal: new Map(),
      };
      byKey.set(key, entry);
    }
    entry.columnsByOrdinal.set(row.ordinal, row.columnName);
  }
  return [...byKey.values()].map(entry => ({
    schemaName: entry.schemaName,
    tableName: entry.tableName,
    constraintName: entry.constraintName,
    columns: [...entry.columnsByOrdinal.entries()].toSorted((a, b) => a[0] - b[0]).map(([, name]) => name),
  }));
}

function tableKey(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

/** True when `index` covers `column` of a constraint whose columns are `fkColumns` (declaration order). */
function columnIsCovered(index: ParsedIndex, fkColumns: readonly string[], column: string): boolean {
  if (index.elements[0] === column) {
    return true;
  }
  return (
    fkColumns.length <= index.elements.length && fkColumns.every((name, position) => index.elements[position] === name)
  );
}

/**
 * Computes the per-FK-column coverage verdict. Only btree indexes can
 * serve the rule; every other access method (gin, gist, hash, …) is
 * ignored, and unparseable definitions never cover.
 */
export function computeFkColumnCoverage(
  fkRows: readonly FkColumnRow[],
  indexRows: readonly IndexRow[]
): readonly FkColumnCoverage[] {
  const btreeByTable = new Map<string, ParsedIndex[]>();
  for (const row of indexRows) {
    const parsed = parseIndexDefinition(row);
    if (parsed?.accessMethod !== "btree") {
      continue;
    }
    const key = tableKey(row.schemaName, row.tableName);
    const existing = btreeByTable.get(key) ?? [];
    existing.push(parsed);
    btreeByTable.set(key, existing);
  }
  return groupFkConstraints(fkRows).flatMap(constraint => {
    const indexes = btreeByTable.get(tableKey(constraint.schemaName, constraint.tableName)) ?? [];
    return constraint.columns.map((column, position) => {
      const covering = indexes.filter(index => columnIsCovered(index, constraint.columns, column));
      return {
        schemaName: constraint.schemaName,
        tableName: constraint.tableName,
        constraintName: constraint.constraintName,
        ordinal: position + 1,
        columnName: column,
        covered: covering.length > 0,
        coveringIndexNames: covering.map(index => index.indexName),
      };
    });
  });
}

/**
 * Reports the leading-column coverage for the matching pipeline's
 * driving columns: for each hot column, the btree indexes on the driving
 * table whose FIRST key part is the column (the shape the planner can
 * actually use for that column's filter/sort).
 */
export function analyzeHotColumnCoverage(indexRows: readonly IndexRow[]): readonly HotColumnCoverage[] {
  const leadingByColumn = new Map<string, string[]>();
  for (const row of indexRows) {
    const parsed = parseIndexDefinition(row);
    if (parsed?.accessMethod !== "btree" || row.tableName !== HOT_COLUMN_TABLE) {
      continue;
    }
    const leading = parsed.elements[0];
    if (!leading) {
      continue;
    }
    const existing = leadingByColumn.get(leading) ?? [];
    existing.push(row.indexName);
    leadingByColumn.set(leading, existing);
  }
  return HOT_COLUMN_NAMES.map(column => ({
    table: HOT_COLUMN_TABLE,
    column,
    leadingIndexNames: leadingByColumn.get(column) ?? [],
  }));
}

/**
 * Finds the composite eligibility index the matching read prefers: a
 * btree index on the driving table whose key starts with
 * (is_online, is_approved). Returns the index name, or null when the
 * shape does not exist yet.
 */
export function findCompositeEligibilityIndex(indexRows: readonly IndexRow[]): string | null {
  for (const row of indexRows) {
    const parsed = parseIndexDefinition(row);
    if (
      parsed?.accessMethod === "btree" &&
      row.tableName === HOT_COLUMN_TABLE &&
      parsed.elements[0] === HOT_COLUMN_NAMES[0] &&
      parsed.elements[1] === HOT_COLUMN_NAMES[1]
    ) {
      return row.indexName;
    }
  }
  return null;
}
