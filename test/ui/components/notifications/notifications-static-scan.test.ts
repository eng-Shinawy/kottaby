/**
 * Notifications views — REQ-028 static scan (tasks.md 4.3.TE).
 *
 * `frontend/views/notifications/**` renders notification content as TEXT
 * nodes through MUI `Typography` ONLY: emitter-provided copy is stored
 * verbatim (specs REQ-028 — the DB is plain varchar/text and the engine does
 * NOT sanitize HTML), so the XSS defense is structural —
 * `dangerouslySetInnerHTML` is PROHIBITED anywhere in the notification view
 * tree. This suite scans every source file in the subtree and fails on any
 * occurrence (including comments, so a future docblock mention cannot
 * smuggle a real usage past the gate).
 *
 * Pure filesystem tier — no server, no DOM, no network.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Root of the notification view tree (four levels up from this file). */
const VIEWS_DIRECTORY = join(import.meta.dir, "..", "..", "..", "..", "frontend", "views", "notifications");

/** Recursively collects every source file under the directory. */
function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files.toSorted((a, b) => a.localeCompare(b));
}

describe("notifications views — REQ-028 dangerouslySetInnerHTML static scan", () => {
  test("the view tree exists and is non-empty (the scan has a subject)", () => {
    const files = collectSourceFiles(VIEWS_DIRECTORY);
    expect(files.length).toBeGreaterThan(0);
  });

  test("no source file under frontend/views/notifications contains dangerouslySetInnerHTML", () => {
    for (const file of collectSourceFiles(VIEWS_DIRECTORY)) {
      const source = readFileSync(file, "utf8");
      expect(
        source.includes("dangerouslySetInnerHTML"),
        `${file} must render notification content as text nodes only (REQ-028)`
      ).toBe(false);
    }
  });
});
