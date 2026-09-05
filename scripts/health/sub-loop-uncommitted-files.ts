/**
 * SUB-LOOP-UNCOMMITTED — Uncommitted Files Discovery
 *
 * Extracted from `sub-loop-uncommitted.ts`. Contains `getUncommittedFiles`,
 * which discovers the set of staged + unstaged + untracked TypeScript/
 * JavaScript files via `git status --porcelain`.
 */

import { runCommand } from "@/scripts/health/shared/sub-loop-types";

// ─── Uncommitted Files Discovery ───────────────────────────────────────────

/**
 * Get the list of uncommitted files (staged + unstaged, modified + added).
 * Returns relative paths, filtered to .ts/.tsx/.mts/.mts files only.
 * Excludes deleted files (status 'D').
 */
/**
 * Get the list of uncommitted files (staged + unstaged, modified + added + untracked).
 * Returns relative paths, filtered to .ts/.tsx/.mts/.mjs/.js/.jsx files only.
 * Excludes deleted files (status 'D').
 */
export function getUncommittedFiles(): string[] {
  // -uall ensures untracked directories are expanded to individual files
  const result = runCommand("git", ["status", "--porcelain", "-uall", "-z"]);
  if (result.exitCode !== 0) {
    throw new Error(`git status failed: ${result.output}`);
  }

  const files: string[] = [];
  const entries = result.output.split("\0");
  let i = 0;

  while (i < entries.length) {
    const entry = entries[i];
    if (!entry) {
      i++;
      continue;
    }

    const status = entry.substring(0, 2);
    const isRename = status[0] === "R" || status[1] === "R";

    if (isRename) {
      // For renames in NUL format, entry i is "R  old/path.ts", entry i+1 is "new/path.ts"
      const newPath = entries[i + 1];
      if (newPath && /\.(ts|tsx|mts|mjs|js|jsx)$/.test(newPath)) {
        files.push(newPath);
      }
      i += 2;
      continue;
    }

    // Skip deleted files
    const isDeleted = status[0] === "D" || status[1] === "D";
    if (!isDeleted) {
      const path = entry.substring(3);
      if (/\.(ts|tsx|mts|mjs|js|jsx)$/.test(path)) {
        files.push(path);
      }
    }
    i++;
  }

  return [...new Set(files)];
}
