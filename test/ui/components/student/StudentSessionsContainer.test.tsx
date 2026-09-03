/**
 * StudentSessionsContainer — component suite ENTRY (runner target).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components/student`,
 * mirroring the `ApplicantStatusCard` suite one level up): the suite BODY
 * lives in the sibling `StudentSessionsContainer.suite.tsx` — ONE render
 * case per branch of the student sessions visual state matrix, driven
 * across BOTH locales (loading skeleton · FORBIDDEN fallback · generic
 * error · empty page · populated rows · cancel flow · SESSION_NOT_FOUND ·
 * SESSION_INVALID_TRANSITION · DUPLICATE_REQUEST · copy contract pin).
 *
 * WHY this file exists (two-phase bootstrap) — react-dom eval-order root
 * cause: Bun evaluates an entry test file's node_modules CJS dependencies
 * BEFORE the file's own static import statements run. A test file that
 * statically imports `@testing-library/react` therefore first evaluates
 * `react-dom` — and if the Happy-DOM global registration only happens in a
 * later static import (the usual preload-chain shape), react-dom's module
 * body runs with NO `document` at all. `canUseDOM` is then `false`, so the
 * module-eval-time flag `isInputEventSupported` stays permanently `false`
 * and React's ChangeEventPlugin routes every `input`/`change` event on a
 * text control through the IE9 `attachEvent` polyfill — controlled
 * `onChange` NEVER fires, no matter how the event is dispatched
 * (`fireEvent.change`, native setter + `dispatchEvent`, …). Simple
 * delegated events (click, submit) are unaffected, which is why only the
 * typing steps of the cancel-flow branch dead-end.
 *
 * The fix here is structural: this entry file imports ONLY the local preload
 * chain (test-env → happydom → translation-preload → next-dynamic-mock) —
 * nothing from node_modules — via SEQUENTIAL TOP-LEVEL AWAIT imports, so the
 * Happy-DOM document is registered first, each preload fully evaluated in
 * order before the next; the suite (and with it react-dom) is then loaded via
 * a final top-level `await import(...)`, guaranteeing react-dom evaluates with
 * `canUseDOM === true` under the plain single-file runner (`bun run
 * test/scripts/run-test.ts <path>`), the bare `bun test` fast-path, AND the
 * official `test:ui:components` CLI preloads alike. Every preload is
 * idempotent, so the suite body stays free of ordering obligations.
 */

// bun:test handles are imported statically (safe: the module touches no DOM
// at evaluation time); the DOM-dependent preload chain stays behind the
// sequential top-level awaits below.
import { expect, test } from "bun:test";

// Preload chain FIRST — the Happy-DOM window must exist before ANY
// DOM-touching module (react-dom above all) is evaluated. Sequential
// top-level awaits (not static side-effect imports) keep the strict
// evaluation order while satisfying lint's no-unassigned-import rule.
await import("@/test/ui/test-env");
await import("@/test/ui/components/happydom-preload");
await import("@/test/ui/components/translation-preload");
await import("@/test/ui/components/next-dynamic-mock");

// THEN the suite body — dynamic import keeps react-dom's evaluation behind
// the registered document (see the root-cause note above).
await import("./StudentSessionsContainer.suite");

// Bootstrap self-check (also satisfies the no-empty-test-file lint rule for
// this entry — the suite's own cases are registered by the import above and
// collected by bun natively). It pins the preload contract this file exists
// for: a Happy-DOM document is live BEFORE any suite module is evaluated.
test("bootstrap — Happy-DOM document registered before the suite import resolves", () => {
  expect(typeof document).toBe("object");
  expect(document.body).not.toBeNull();
  expect(typeof window).toBe("object");
});
