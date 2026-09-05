/**
 * Type definitions for the live PostgreSQL introspection library.
 * See `index.ts` for the module-level overview and security notes.
 */

/** One row per public-schema table, with live metadata. */
export interface TableSummary {
  tableName: string;
  rowCount: number;
  columnCount: number;
  hasTriggers: boolean;
  isImmutable: boolean;
  constraints: {
    pk: number;
    fks: number;
    uniques: number;
    checks: number;
  };
}

/** One row per column on a table — full metadata for the expand panel. */
export interface ColumnInfo {
  columnName: string;
  dataType: string;
  udtName: string | null;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  fkReferences: string | null;
  isUnique: boolean;
  checkConstraint: string | null;
}

/** One row per public-schema enum type, with all values. */
export interface EnumInfo {
  enumName: string;
  values: string[];
}

/** One row per public-schema trigger (the immutability triggers). */
export interface TriggerInfo {
  triggerName: string;
  tableName: string;
  eventManipulation: string;
  timing: string;
  isEnabled: boolean;
}

/** One row per index, with column list + flags. */
export interface IndexInfo {
  indexName: string;
  tableName: string;
  columnNames: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

/** One row per foreign-key constraint, fully resolved. */
export interface FkInfo {
  constraintName: string;
  tableName: string;
  columnName: string;
  foreignTableName: string;
  foreignColumnName: string;
  onDelete: string;
}

/** High-level DB stats for the dashboard header / stat strip. */
export interface DbStats {
  dbName: string;
  postgresVersion: string;
  tableCount: number;
  enumCount: number;
  triggerCount: number;
  totalRows: number;
  schemaSize: string;
}

/** One row per CHECK constraint. */
export interface CheckInfo {
  constraintName: string;
  tableName: string;
  checkClause: string;
}
