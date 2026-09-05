/**
 * SUB-LOOP-UNCOMMITTED — Output Filtering
 *
 * Extracted from `sub-loop-uncommitted.ts`. Contains the helpers that filter
 * project-wide tool output (tsgo, biome, oxlint, lint, jscpd) down to the
 * lines and files relevant to the uncommitted-file set.
 */

// ─── Output Filtering ──────────────────────────────────────────────────────

/**
 * Check if a line mentions any of the target files.
 */
export function lineMentionsAnyFile(line: string, files: string[]): boolean {
  return files.some(f => line.includes(f));
}

/**
 * Collect continuation lines following an error-block header.
 * Stops at the next error-block header or a blank line.
 * Returns the collected lines and the index of the last consumed line.
 */
export function collectErrorBlockContinuation(
  lines: string[],
  startIndex: number,
  errorBlockRegex: RegExp
): { continuationLines: string[]; lastIndex: number } {
  const continuationLines: string[] = [];
  let lastIndex = startIndex;
  for (let j = startIndex + 1; j < lines.length; j++) {
    if (errorBlockRegex.exec(lines[j]) || lines[j].trim() === "") break;
    continuationLines.push(lines[j]);
    lastIndex = j;
  }
  return { continuationLines, lastIndex };
}

/**
 * Filter tsgo output for lines mentioning any of the target files.
 */
export function filterTsgoForFiles(tsgoOutput: string, files: string[]): string {
  const lines = tsgoOutput.split("\n");
  const matchingLines: string[] = [];
  const errorBlockRegex = /^(.+\.tsx?)\(\d+,\d+\):/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const isErrorBlock = errorBlockRegex.exec(line);
    if (!lineMentionsAnyFile(line, files)) {
      i++;
      continue;
    }
    matchingLines.push(line);

    if (!isErrorBlock) {
      i++;
      continue;
    }
    // Collect the error block (header + continuation lines)
    const { continuationLines, lastIndex } = collectErrorBlockContinuation(lines, i, errorBlockRegex);
    matchingLines.push(...continuationLines);
    i = lastIndex + 1;
  }

  return matchingLines.length > 0 ? matchingLines.join("\n") : "";
}

/**
 * Extract the list of files that have errors in the filtered output.
 */
export function extractFailedFiles(filteredOutput: string, allFiles: string[]): string[] {
  const failed = new Set<string>();
  for (const file of allFiles) {
    if (filteredOutput.includes(file)) {
      failed.add(file);
    }
  }
  return [...failed];
}
