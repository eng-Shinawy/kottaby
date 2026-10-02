/**
 * Locale-namespace parity harness — the shared utility kit of the
 * `<ns>-namespace.parity.test.ts` suites (ar+en leaf-set parity, dead-key
 * sweeps, ICU placeholder checks).
 *
 * Extracted so the depth-first leaf walker, the dotted-path reader, and the
 * ICU placeholder scanner cannot drift apart across namespace gates
 * (`backend/db/test/AGENTS.md` dedupe discipline, applied at the locale
 * layer). Namespace-qualified error copy is produced via `namespaceParityKit`.
 *
 * TEST-ONLY module: must never be imported from production code.
 */

/** Arabic-script probe — at least one Arabic-block character in the value. */
export const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/**
 * Builds the per-namespace parity utilities. The namespace name is embedded
 * in every thrown error so a violation names the offending gate.
 */
export function namespaceParityKit(namespace: string) {
  /**
   * Depth-first leaf paths of a locale map — grouped sub-blocks are flattened
   * into dotted paths so nested blocks keep the same zero-dead-key discipline
   * as top-level string slots. Throws on any node that is neither a string nor
   * a grouped labels block.
   */
  function leafPathsOf(localeMap: object, prefix = ""): string[] {
    const paths: string[] = [];
    for (const key of Object.keys(localeMap)) {
      const value: unknown = Reflect.get(localeMap, key);
      const path = prefix.length === 0 ? key : `${prefix}.${key}`;
      if (typeof value === "string") {
        paths.push(path);
        continue;
      }
      if (value !== null && typeof value === "object") {
        paths.push(...leafPathsOf(value, path));
        continue;
      }
      throw new Error(`${namespace}.${path} must be a non-empty localized string or a grouped labels block`);
    }
    return paths;
  }

  /** Locale-sorted leaf paths of a locale map (stable comparison key set). */
  function sortedLeafPathsOf(localeMap: object): string[] {
    return leafPathsOf(localeMap).toSorted((a, b) => a.localeCompare(b));
  }

  /** Reads one leaf value off a locale map by dotted path — throws otherwise. */
  function leafValueOf(localeMap: object, path: string, localeName: string): string {
    let node: unknown = localeMap;
    for (const segment of path.split(".")) {
      if (node === null || typeof node !== "object") {
        throw new Error(`${namespace}.${localeName}.${path} traverses a non-block node`);
      }
      node = Reflect.get(node, segment);
    }
    if (typeof node !== "string" || node.length === 0) {
      throw new Error(`${namespace}.${localeName}.${path} must be a non-empty localized string`);
    }
    return node;
  }

  return { leafPathsOf, sortedLeafPathsOf, leafValueOf };
}

/** Every `{name}` ICU placeholder occurring in a template, deduplicated + sorted. */
export function icuPlaceholdersOf(template: string): string[] {
  const seen = new Set<string>();
  const placeholder = /\{([A-Za-z]\w*)\}/g;
  let match = placeholder.exec(template);
  while (match !== null) {
    if (typeof match[1] === "string") {
      seen.add(match[1]);
    }
    match = placeholder.exec(template);
  }
  return [...seen].toSorted((a, b) => a.localeCompare(b));
}
