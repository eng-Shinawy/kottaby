/**
 * HandshakeCodeCard — component suite.
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): every
 * render branch of the student handshake-code card gets ONE render case,
 * driven across BOTH locales:
 *
 *   loading · happy-path code display (incl. the LTR-isolation pin of the
 *   code chip) · copy success (clipboard double resolves → localized
 *   confirmation) · copy failure (clipboard double rejects → localized
 *   fallback notice) · copy failure with NO clipboard API
 *   (`navigator.clipboard === undefined` — the non-secure-context shape →
 *   the SAME localized fallback notice) · FORBIDDEN denial
 *   (PermissionDeniedFallback) · STUDENT_NOT_FOUND (own-row miss edge) ·
 *   generic transport error
 *
 * Translation discipline: assertions reference ONLY the PRELOADED label
 * objects resolved through `HandshakeCode.getLabels(getTranslations(locale))`
 * and `Errors.getLabels(...)` — ZERO hardcoded Arabic/English copy lives
 * here. The one exception class is fixture DATA (the handshake-code string,
 * asserted to pass the canonical `isHandshakeCode` guard — not eyeballed)
 * plus technical error-code tokens.
 *
 * Clipboard discipline: `navigator.clipboard` is swapped for an in-test
 * double (captures every `writeText` payload; success/failure selectable per
 * case) or shadowed with `undefined` (the no-Clipboard-API case), and
 * restored after each test — no permissions, no real OS clipboard.
 *
 * Static discipline verified alongside (grep):
 *   - `useLazyQuery` appears NOWHERE in the component or its consumers;
 *   - no `.skip(`/`.only(` markers exist in this suite.
 */

// Apollo Client v4 restructured the testing surface: the component provider
// moved into the nested `testing/react` entrypoint, and the wire-shape types
// were consolidated under the non-deprecated `MockLink` namespace.
import { afterEach, describe, expect, test } from "bun:test";
import type { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import { cleanup, type RenderResult, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { myHandshakeCodeQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { HandshakeCodeCard } from "@/frontend/views/students/dashboard";
import { isHandshakeCode, normalizeHandshakeCode } from "@/shared/constants";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Errors as ErrorsNs } from "@/shared/locale/namespaces/errors";
import { HandshakeCode as HandshakeCodeNs } from "@/shared/locale/namespaces/handshakeCode";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

/**
 * Fixture code — canonical `KSB-XXXXXXXX` form, PROVEN valid through the
 * shared constants guard (never a hand-rolled "looks right" string).
 */
const FIXTURE_HANDSHAKE_CODE = "KSB-4F7A2C91";

/** Poll cadence while waiting for the card's own transient-clear timer to fire. */
const TRANSIENT_CLEAR_POLL_INTERVAL_MS = 50;

/**
 * Failure bound for the transient-clear poll — a generous multiple of the
 * card's confirmation window (the card owns the window, the test never
 * re-states it). NOT part of the happy path: the poll exits the moment the
 * clear is observed, long before this bound.
 */
const TRANSIENT_CLEAR_POLL_DEADLINE_MS = 3000;

/**
 * Deadline-aware replacement for a fixed real-timer sleep: polls `probe`
 * until it observes `true`, so there is NO sleep-vs-timer margin to flake on
 * — each iteration exits the instant the condition flips, and the deadline
 * exists only to fail fast (and well inside the per-test timeout budget).
 * Recursive formulation because the sleep is inherently sequential (the
 * `no-await-in-loop` rule rightly flags parallelizable awaits in loops).
 */
async function pollUntil(probe: () => boolean, deadlineAt: number, intervalMs: number): Promise<boolean> {
  if (probe()) {
    return true;
  }
  if (Date.now() >= deadlineAt) {
    return false;
  }
  await new Promise(resolve => setTimeout(resolve, intervalMs));
  return pollUntil(probe, deadlineAt, intervalMs);
}

// ----------------------------------------------------------------------------
// Apollo mocks
// ----------------------------------------------------------------------------

/** Single-operation mock answering the zero-variable self-read with a code. */
function successMock(code: string): MockLink.MockedResponse {
  return {
    request: { query: myHandshakeCodeQueryDocument },
    result: { data: { myHandshakeCode: code } },
  };
}

/**
 * Single-operation Apollo mock failing the caller at the scope/service layer.
 *
 * The failure is authored as a raw `result.errors[]` entry exactly where the
 * transport boundary puts `extensions.code`; Apollo's MockedProvider wraps it
 * into a genuine `CombinedGraphQLErrors`, which `extractErrorCode` traverses
 * (`errors[0].extensions.code`) — the same extraction path the production
 * error-link uses under `frontend/providers/apollo/utils.ts`.
 */
function failureMock(code: string): MockLink.MockedResponse {
  return {
    request: { query: myHandshakeCodeQueryDocument },
    result: {
      errors: [
        {
          message: `${code} (masked transport surface)`,
          extensions: { code },
        },
      ],
    },
  };
}

/** Renders the card under TestWrapper (LocaleProvider → emotion → theme). */
function renderCard(mocks: ReadonlyArray<MockLink.MockedResponse>, locale: AppLocale): RenderResult {
  const mocksCopy = [...mocks];
  return renderWithWrapper(
    <MockedProvider mocks={mocksCopy}>
      <HandshakeCodeCard />
    </MockedProvider>,
    { locale }
  );
}

// ----------------------------------------------------------------------------
// Clipboard doubles
// ----------------------------------------------------------------------------

/**
 * Clipboard strategy: `userEvent.setup()` attaches user-event's OWN capturing
 * clipboard stub to `navigator.clipboard` — its `writeText` records payloads
 * and `readText` replays them. The SUCCESS-path tests read the written
 * payload straight back out of that built-in stub (click → clipboard read,
 * mirroring the browser verification protocol).
 *
 * The FAILURE path needs a REJECTING clipboard, which the built-in stub
 * cannot do; {@link installRejectingClipboardDouble} swaps one in AFTER
 * `userEvent.setup()` (ordering matters — setup installs the built-in stub).
 */

/** Captured clipboard traffic for the rejecting double. */
interface RejectingClipboardDouble {
  readonly calls: string[];
}

/** Own-property shape of `navigator.clipboard` BEFORE any double install (undefined → prototype getter only). */
const originalOwnClipboard: PropertyDescriptor | undefined = Reflect.getOwnPropertyDescriptor(navigator, "clipboard");

let rejectingClipboard: RejectingClipboardDouble | null = null;

/**
 * Installs an ALWAYS-REJECTING clipboard double on `navigator`.
 *
 * happy-dom exposes `clipboard` as a getter-only PROTOTYPE accessor (a plain
 * assignment — or `Reflect.set` — silently fails), so an OWN data property is
 * defined to shadow it; `afterEach` restores the original shape.
 */
function installRejectingClipboardDouble(): void {
  const calls: string[] = [];
  rejectingClipboard = { calls };
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: (text: string) => {
        calls.push(text);
        return Promise.reject(new Error("clipboard denied"));
      },
    },
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

afterEach(() => {
  cleanup();
  rejectingClipboard = null;
  if (originalOwnClipboard) {
    Object.defineProperty(navigator, "clipboard", originalOwnClipboard);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

// One block per locale keeps RTL/LTR both exercised over the FULL branch
// matrix while every case stays independently readable.
for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = HandshakeCodeNs.getLabels(getTranslations(locale));
  const te = ErrorsNs.getLabels(getTranslations(locale));

  describe(`HandshakeCodeCard (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("branch 1 — query in flight renders the busy skeleton card", () => {
      // `delay: Infinity` keeps the operation permanently in flight (MockLink
      // returns a never-settling Observable for it). An EMPTY mock list would
      // NOT leave the query pending — MockLink emits an async unmatched-
      // operation error instead.
      const { container } = renderCard([{ request: { query: myHandshakeCodeQueryDocument }, delay: Infinity }], locale);

      const skeleton = screen.getByTestId("handshake-code-card-loading");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      expect(container.querySelector("[data-testid='handshake-code-card']")).toBeNull();
      // No settled copy may leak into the skeleton.
      expect(container.textContent?.includes(t.yourCodeTitle)).toBe(false);
      expect(container.textContent?.includes(t.copyCode)).toBe(false);
    });

    test("branch 5 — resolved code renders title + description + LTR-isolated chip + copy affordance", async () => {
      // Fixture realism gate: the code displayed to students must pass the
      // CANONICAL format guard — same gate the parent discovery input uses.
      expect(isHandshakeCode(normalizeHandshakeCode(FIXTURE_HANDSHAKE_CODE))).toBe(true);

      const { container } = renderCard([successMock(FIXTURE_HANDSHAKE_CODE)], locale);

      await waitFor(() => {
        expect(screen.getByTestId("handshake-code-card")).toBeDefined();
      });
      expect(screen.getByText(t.yourCodeTitle)).toBeDefined();
      expect(screen.getByText(t.yourCodeDescription)).toBeDefined();
      expect(screen.getByText(FIXTURE_HANDSHAKE_CODE)).toBeDefined();
      expect(screen.getByRole("button", { name: t.copyCode })).toBeDefined();

      // LTR-isolation pin — the code atom must read left-to-right inside the
      // RTL Arabic layout too: the `dir="ltr"` attribute pins direction at
      // the user-agent cascade level (a CSS `direction: ltr` declaration
      // would be FLIPPED to `rtl` by the Arabic stylis-plugin-rtl cache), and
      // `unicode-bidi: isolate` keeps the code its own directional run.
      const chip = screen.getByTestId("handshake-code-chip");
      expect(chip.getAttribute("dir")).toBe("ltr");
      expect(getComputedStyle(chip).direction).toBe("ltr");
      expect(getComputedStyle(chip).unicodeBidi).toBe("isolate");

      // No outcome copy before any copy attempt.
      expect(container.textContent?.includes(t.codeCopied)).toBe(false);
      expect(container.textContent?.includes(t.copyFailed)).toBe(false);
    });

    test("copy success — clipboard receives the exact code; localized confirmation announces politely", async () => {
      renderCard([successMock(FIXTURE_HANDSHAKE_CODE)], locale);
      const user = userEvent.setup();

      const copyButton = await screen.findByRole("button", { name: t.copyCode });
      await user.click(copyButton);

      // Localized confirmation appears in the polite live region.
      await waitFor(() => {
        expect(screen.getByText(t.codeCopied)).toBeDefined();
      });

      // Clipboard read-back through user-event's built-in stub: the payload
      // handed to `writeText` is EXACTLY the displayed code.
      const written = await navigator.clipboard.readText();
      expect(written).toBe(FIXTURE_HANDSHAKE_CODE);

      const card = screen.getByTestId("handshake-code-card");
      expect(card.querySelector("output")).not.toBeNull();
      // The failure notice must NOT appear on the success path.
      expect(screen.queryByText(t.copyFailed)).toBeNull();
    });

    test("copy failure — clipboard rejection surfaces the localized manual-copy notice", async () => {
      renderCard([successMock(FIXTURE_HANDSHAKE_CODE)], locale);
      const user = userEvent.setup();
      // AFTER setup: replace user-event's always-resolving stub with a
      // rejecting double (setup installs the built-in stub first).
      installRejectingClipboardDouble();
      const calls = rejectingClipboard?.calls ?? [];

      const copyButton = await screen.findByRole("button", { name: t.copyCode });
      await user.click(copyButton);

      // The rejected attempt still carried the exact code.
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(FIXTURE_HANDSHAKE_CODE);
      await waitFor(() => {
        expect(screen.getByText(t.copyFailed)).toBeDefined();
      });
      // The success confirmation must NOT appear on the failure path.
      expect(screen.queryByText(t.codeCopied)).toBeNull();
    });

    test("copy failure (no clipboard API) — undefined navigator.clipboard surfaces the localized manual-copy notice", async () => {
      renderCard([successMock(FIXTURE_HANDSHAKE_CODE)], locale);
      const user = userEvent.setup();
      // AFTER setup: shadow the clipboard with `undefined` — the
      // non-secure-context shape (`navigator.clipboard === undefined`).
      // happy-dom exposes `clipboard` as a getter-only PROTOTYPE accessor,
      // so an OWN data property carrying `undefined` is defined to shadow
      // whatever setup installed; the finally (and afterEach) restores.
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
        writable: true,
        enumerable: true,
      });
      try {
        const copyButton = await screen.findByRole("button", { name: t.copyCode });
        await user.click(copyButton);

        // `navigator.clipboard.writeText` on an undefined clipboard throws
        // synchronously inside the async handler — the same catch arm routes
        // it to the localized failure notice (never a crash, never success).
        await waitFor(() => {
          expect(screen.getByText(t.copyFailed)).toBeDefined();
        });
        expect(screen.queryByText(t.codeCopied)).toBeNull();
      } finally {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    });

    test("branch 2 — FORBIDDEN denial renders PermissionDeniedFallback", async () => {
      const { container } = renderCard([failureMock("FORBIDDEN")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.forbiddenRole)).toBeDefined();
      });
      expect(screen.getByText(te.forbidden)).toBeDefined();
      // The deny surface REPLACES the card entirely — never bare null.
      expect(container.querySelector("[data-testid='handshake-code-card']")).toBeNull();
    });

    test("branch 3 — STUDENT_NOT_FOUND (own-row miss) surfaces the specific localized state", async () => {
      const { container } = renderCard([failureMock("STUDENT_NOT_FOUND")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.studentHandshakeNotFound)).toBeDefined();
      });
      // Distinct from the generic transport-error state...
      expect(screen.queryByText(te.internalServerError)).toBeNull();
      // ...and from the permission-denied surface.
      expect(screen.queryByText(te.forbiddenRole)).toBeNull();
      // The settled card shell hosts the inline alert (still a card slot).
      expect(container.querySelector("[data-testid='handshake-code-card']")).not.toBeNull();
      // No code content leaks on the failure path.
      expect(container.textContent?.includes(FIXTURE_HANDSHAKE_CODE)).toBe(false);
    });

    test("branch 4 — non-denial failure surfaces the generic inline alert", async () => {
      const { container } = renderCard([failureMock("INTERNAL_SERVER_ERROR")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.internalServerError)).toBeDefined();
      });
      // The specific own-row-miss copy and the deny surface must NOT appear.
      expect(screen.queryByText(te.studentHandshakeNotFound)).toBeNull();
      expect(screen.queryByText(te.forbiddenRole)).toBeNull();
      expect(container.querySelector("[data-testid='handshake-code-card']")).not.toBeNull();
    });
  });
}

describe("HandshakeCodeCard (transient confirmation, en)", () => {
  const locale: AppLocale = "en";
  const t = HandshakeCodeNs.getLabels(getTranslations(locale));

  test("the localized copy confirmation self-clears after its transient window", async () => {
    renderCard([successMock(FIXTURE_HANDSHAKE_CODE)], locale);
    const user = userEvent.setup();

    const copyButton = await screen.findByRole("button", { name: t.copyCode });
    await user.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText(t.codeCopied)).toBeDefined();
    });
    // The notice is TRANSIENT: it auto-clears once the confirmation window
    // elapses. bun:test DOES ship fake timers (sinon-style — `setTimeout`
    // gains an own `clock`), but @testing-library's waitFor detects fake
    // timers only through a GLOBAL `jest`, which bun:test never exposes —
    // `jest.useFakeTimers()` would therefore stall every findBy*/waitFor in
    // this case (and no fake-timer precedent exists anywhere in the repo).
    // The robust conversion is a DEADLINE POLL: plain sleeps + direct queries
    // (no waitFor act-wrapper overhead — the reason the old fixed sleep was
    // chosen) that exits the moment the card's own clear timer has flushed.
    // The old 2600ms-vs-2000ms margin — the flake seed — is gone: the happy
    // path is "observed clear", the deadline is a pure failure bound.
    const cleared = await pollUntil(
      () => screen.queryByText(t.codeCopied) === null,
      Date.now() + TRANSIENT_CLEAR_POLL_DEADLINE_MS,
      TRANSIENT_CLEAR_POLL_INTERVAL_MS
    );
    expect(cleared).toBe(true);
    expect(screen.queryByText(t.codeCopied)).toBeNull();
    // The live region stays mounted (idle again) — never unmounts on success.
    expect(screen.getByTestId("handshake-code-card").querySelector("output")).not.toBeNull();
  });
});
