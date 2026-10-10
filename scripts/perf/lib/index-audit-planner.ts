/**
 * EXPLAIN plan parsing for the index verification tool.
 *
 * The hot-column planner check runs one matching-shaped read under
 * `EXPLAIN (FORMAT JSON)` and reports the planner's actual index
 * choices — which access path served the `teacher` eligibility scan and
 * the `session` NOT EXISTS subplan — rather than trusting index
 * existence alone. Everything here is defensive: malformed or missing
 * plan shapes parse to empty facts (reported honestly), never crashes.
 */

/** One scan node from an EXPLAIN plan tree, flattened to the facts the report needs. */
export interface PlanScan {
  readonly nodeType: string;
  readonly relationName: string;
  readonly indexName: string | null;
}

/** Normalized EXPLAIN plan node (children pre-extracted from the `Plans` array). */
export interface PlanNode {
  readonly nodeType: string;
  readonly relationName: string | null;
  readonly indexName: string | null;
  readonly plans: readonly PlanNode[];
}

const EXPLAIN_RESULT_KEY = "QUERY PLAN";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrows a raw EXPLAIN JSON node into the normalized shape; returns null on any deviation. */
function toPlanNode(value: unknown): PlanNode | null {
  if (!isRecord(value) || typeof value["Node Type"] !== "string") {
    return null;
  }
  const relationName = typeof value["Relation Name"] === "string" ? value["Relation Name"] : null;
  const indexName = typeof value["Index Name"] === "string" ? value["Index Name"] : null;
  const children = Array.isArray(value.Plans) ? value.Plans : [];
  const plans = children.map(child => toPlanNode(child)).filter((node): node is PlanNode => node !== null);
  return { nodeType: value["Node Type"], relationName, indexName, plans };
}

/**
 * Extracts the root plan node from the rows a `queryDb` EXPLAIN call
 * returns. PostgreSQL yields one row whose `QUERY PLAN` column holds a
 * JSON array with a single member carrying the `Plan` object. Any other
 * shape — non-array rows, missing column, non-array plan container —
 * resolves to null (the report then states the planner check could not
 * be read).
 */
export function extractExplainPlan(explainRows: unknown): PlanNode | null {
  if (!Array.isArray(explainRows)) {
    return null;
  }
  const firstRow = explainRows[0];
  if (!isRecord(firstRow)) {
    return null;
  }
  const planContainer = firstRow[EXPLAIN_RESULT_KEY];
  if (!Array.isArray(planContainer) || planContainer.length === 0) {
    return null;
  }
  const containerMember = planContainer[0];
  if (!isRecord(containerMember)) {
    return null;
  }
  return toPlanNode(containerMember.Plan);
}

/** Walks a plan tree depth-first and collects every node that scans a named relation. */
export function collectRelationScans(root: PlanNode): readonly PlanScan[] {
  const scans: PlanScan[] = [];
  const walk = (node: PlanNode): void => {
    if (node.relationName !== null) {
      scans.push({ nodeType: node.nodeType, relationName: node.relationName, indexName: node.indexName });
    }
    for (const child of node.plans) {
      walk(child);
    }
  };
  walk(root);
  return scans;
}

/** The first scan a matching-shaped plan uses for a given relation, or null when the relation is absent. */
function scanForRelation(scans: readonly PlanScan[], relationName: string): PlanScan | null {
  return scans.find(scan => scan.relationName === relationName) ?? null;
}

/**
 * Summarizes a matching-shaped EXPLAIN: every relation scan in plan
 * order, plus the dedicated lookups for the driving table and the
 * NOT EXISTS subplan relation. A null root (unreadable plan) yields an
 * empty scan list — an honest "planner check unavailable" report.
 */
export function summarizeMatchingPlan(root: PlanNode | null): {
  readonly scans: readonly PlanScan[];
  readonly teacherScan: PlanScan | null;
  readonly sessionScan: PlanScan | null;
} {
  const scans = root === null ? [] : collectRelationScans(root);
  return {
    scans,
    teacherScan: scanForRelation(scans, "teacher"),
    sessionScan: scanForRelation(scans, "session"),
  };
}
