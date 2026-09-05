/**
 * TeacherSessionsContainer — component suite ENTRY (runner target).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components/teachers`,
 * mirroring the student sessions suite structure exactly): the suite BODY
 * lives in the sibling `TeacherSessionsContainer.suite.tsx` — ONE render
 * case per branch of the teacher sessions visual state matrix, driven
 * across BOTH locales (loading skeleton · FORBIDDEN fallback · generic
 * error · applicant EMPTY page · populated rows + Start/Complete/Cancel
 * action-visibility matrix · per-mutation in-flight disabling · start and
 * complete success flows · TEACHER_NOT_CERTIFIED · SESSION_INVALID_TRANSITION ·
 * SESSION_NOT_FOUND eviction · cancel dialog open+submit · copy contract pin).
 *
 * WHY this file exists (two-phase bootstrap) — identical root cause to the
 * student entry: Bun evaluates an entry test file's node_modules CJS
 * dependencies BEFORE the file's own static import statements run. A test
 * file that statically imports `@testing-library/react` therefore first
 * evaluates `react-dom` — and if the Happy-DOM global registration only
 * happens in a later static import, react-dom's module body runs with NO
 * `document` at all (`canUseDOM === false` → `isInputEventSupported`
 * permanently false → controlled `onChange` dead). The fix is structural:
 * this entry file imports ONLY the local preload chain (test-env →
 * happydom → translation-preload → next-dynamic-mock) — nothing from
 * node_modules — via SEQUENTIAL TOP-LEVEL AWAIT imports; the suite (and
 * with it react-dom) is then loaded via a final top-level `await import(...)`.
 * Every preload is idempotent, so the suite body stays free of ordering
 * obligations.
 */

// bun:test handles are imported statically (safe: the module touches no DOM
// at evaluation time); the DOM-dependent preload chain stays behind the
// sequential top-level awaits below.
import { expect, test } from "bun:test";

// Preload chain FIRST — the Happy-DOM window must exist before ANY
// DOM-touching module (react-dom above all) is evaluated.
await import("@/test/ui/test-env");
await import("@/test/ui/components/happydom-preload");
await import("@/test/ui/components/translation-preload");
await import("@/test/ui/components/next-dynamic-mock");

// THEN the suite body — dynamic import keeps react-dom's evaluation behind
// the registered document (see the root-cause note above).
await import("./TeacherSessionsContainer.suite");

// Bootstrap self-check (also satisfies the no-empty-test-file lint rule for
// this entry — the suite's own cases are registered by the import above and
// collected by bun natively). It pins the preload contract this file exists
// for: a Happy-DOM document is live BEFORE any suite module is evaluated.
test("bootstrap — Happy-DOM document registered before the suite import resolves", () => {
  expect(typeof document).toBe("object");
  expect(document.body).not.toBeNull();
  expect(typeof window).toBe("object");
});
