/**
 * Pure EXPLAIN plan analysis for the query auditor: parses the rows a
 * `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` read returns into a normalized
 * plan tree, walks every node (nested plans, CTE subplans, join trees,
 * gather/worker nodes — any node shape PostgreSQL emits), and extracts the
 * two facts the gates consume: the Seq Scan nodes with their estimated row
 * counts, and the scan serving the matching pipeline's `session` NOT
 * EXISTS subplan.
 *
 * Everything here is defensive by design: malformed or hostile plan
 * shapes never crash — unreadable subtrees are pruned with an honest
 * parse note, reference cycles are cut by a visited set, notes are
 * bounded, and a fully unreadable plan reports `readable: false` so the
 * gates fail closed instead of silently passing.
 */

/** The composite access path the matching pipeline's NOT EXISTS exclusion is expected to ride. */
export const EXPECTED_MATCHING_SESSION_INDEX = "session_teacher_id_status_idx";

/** Relation scanned by the matching read's NOT EXISTS subplan. */
export const SESSION_RELATION_NAME = "session";

/** Normalized plan node (children pre-extracted from the `Plans` array). */
export interface ExplainPlanNode {
  readonly nodeType: string;
  readonly relationName: string | null;
  readonly indexName: string | null;
  readonly planRows: number | null;
  readonly totalCost: number | null;
  readonly plans: readonly ExplainPlanNode[];
}

/** One Seq Scan node: the scanned relation and the planner's row estimate (null = unreadable). */
export interface SeqScanFact {
  readonly relationName: string | null;
  readonly estimatedRows: number | null;
}

/** The access path one plan uses to scan a named relation. */
export interface RelationScanFact {
  readonly nodeType: string;
  readonly indexName: string | null;
}

/** Full analysis of one EXPLAIN result: the facts plus the honesty notes. */
export interface ExplainPlanAnalysis {
  readonly readable: boolean;
  readonly rootNodeType: string | null;
  readonly totalCost: number | null;
  readonly seqScans: readonly SeqScanFact[];
  readonly sessionScan: RelationScanFact | null;
  readonly parseNotes: readonly string[];
}

/** Upper bound on collected parse notes (bounded state under hostile input). */
const MAX_PARSE_NOTES = 50;

const EXPLAIN_RESULT_KEY = "QUERY PLAN";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number field, or null when the plan omitted or corrupted it. */
function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function note(notes: string[], message: string): void {
  if (notes.length < MAX_PARSE_NOTES) {
    notes.push(message);
  }
}

/**
 * Narrows one raw JSON plan node into the normalized shape; returns null
 * on any deviation (non-object, missing node type, already-visited
 * reference). Children recurse through the shared visited set so a cyclic
 * or shared-reference structure is pruned, never walked forever.
 */
function toPlanNode(value: unknown, visited: Set<object>, notes: string[]): ExplainPlanNode | null {
  if (!isRecord(value) || visited.has(value)) {
    if (isRecord(value)) {
      note(notes, "cyclic or repeated plan node pruned");
    }
    return null;
  }
  const nodeType = value["Node Type"];
  if (typeof nodeType !== "string") {
    note(notes, "plan node without a readable node type pruned");
    return null;
  }
  visited.add(value);
  const children = value.Plans;
  const childList = Array.isArray(children) ? children : [];
  if (children !== undefined && !Array.isArray(children)) {
    note(notes, `node ${nodeType} carries a non-array Plans member; its children were pruned`);
  }
  const plans: ExplainPlanNode[] = [];
  for (const child of childList) {
    const parsed = toPlanNode(child, visited, notes);
    if (parsed !== null) {
      plans.push(parsed);
    }
  }
  return {
    nodeType,
    relationName: typeof value["Relation Name"] === "string" ? value["Relation Name"] : null,
    indexName: typeof value["Index Name"] === "string" ? value["Index Name"] : null,
    planRows: finiteNumber(value["Plan Rows"]),
    totalCost: finiteNumber(value["Total Cost"]),
    plans,
  };
}

/**
 * Seq Scan classification: the plain scan and its parallel-aware variant
 * are both full relation scans; every index-backed node type is not.
 */
export function isSeqScanNodeType(nodeType: string): boolean {
  return nodeType === "Seq Scan" || nodeType === "Parallel Seq Scan";
}

/**
 * Scale-aware threshold test (inclusive at the limit): a Seq Scan breaches
 * when its estimated rows reach the threshold. An unreadable estimate
 * breaches too — the gate never passes on a count it could not read.
 */
export function seqScanBreachesThreshold(fact: SeqScanFact, threshold: number): boolean {
  return fact.estimatedRows === null ? true : fact.estimatedRows >= threshold;
}

interface WalkState {
  readonly seqScans: SeqScanFact[];
  sessionScan: RelationScanFact | null;
  readonly notes: string[];
}

function walkPlan(node: ExplainPlanNode, state: WalkState): void {
  if (isSeqScanNodeType(node.nodeType)) {
    state.seqScans.push({ relationName: node.relationName, estimatedRows: node.planRows });
    if (node.planRows === null) {
      note(
        state.notes,
        `Seq Scan on ${node.relationName ?? "(unknown relation)"} has an unreadable Plan Rows estimate`
      );
    }
  }
  if (state.sessionScan === null && node.relationName === SESSION_RELATION_NAME) {
    state.sessionScan = { nodeType: node.nodeType, indexName: node.indexName };
  }
  for (const child of node.plans) {
    walkPlan(child, state);
  }
}

/** The single JSON member of the `QUERY PLAN` column the database returns, or null when unreadable. */
function explainResultMember(explainRows: unknown, notes: string[]): Record<string, unknown> | null {
  if (!Array.isArray(explainRows) || explainRows.length === 0) {
    note(notes, "EXPLAIN returned no readable rows");
    return null;
  }
  const firstRow = explainRows[0];
  if (!isRecord(firstRow)) {
    note(notes, "the first EXPLAIN row is not an object");
    return null;
  }
  const container = firstRow[EXPLAIN_RESULT_KEY];
  if (!Array.isArray(container) || container.length === 0) {
    note(notes, "the EXPLAIN result container is missing or empty");
    return null;
  }
  const member = container[0];
  if (!isRecord(member)) {
    note(notes, "the EXPLAIN result member is not an object");
    return null;
  }
  return member;
}

/**
 * Analyzes one EXPLAIN result end to end: root extraction, full node
 * walk, seq-scan collection, and the session-relation access path. Any
 * unreadable shape yields `readable: false` with honest notes — the
 * caller's gates then fail closed.
 */
export function analyzeExplainRows(explainRows: unknown): ExplainPlanAnalysis {
  const notes: string[] = [];
  const member = explainResultMember(explainRows, notes);
  const root = member === null ? null : toPlanNode(member.Plan, new Set(), notes);
  if (root === null) {
    if (member !== null) {
      note(notes, "the root Plan node is missing or unreadable");
    }
    return { readable: false, rootNodeType: null, totalCost: null, seqScans: [], sessionScan: null, parseNotes: notes };
  }
  const state: WalkState = { seqScans: [], sessionScan: null, notes };
  walkPlan(root, state);
  return {
    readable: true,
    rootNodeType: root.nodeType,
    totalCost: root.totalCost,
    seqScans: state.seqScans,
    sessionScan: state.sessionScan,
    parseNotes: notes,
  };
}
