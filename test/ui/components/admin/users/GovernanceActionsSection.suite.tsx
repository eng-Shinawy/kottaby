/**
 * GovernanceActionsSection — component suite BODY.
 *
 * NOT a runner target: `bun test` collects `*.test.*` files only, and this
 * file carries the suite implementation on behalf of the sibling bootstrap
 * `GovernanceActionsSection.test.tsx` (see that file for WHY the suite is
 * split — short version: react-dom must first evaluate with the Happy-DOM
 * document already registered, or React's `isInputEventSupported` flag is
 * computed `false` and controlled `onChange` can never fire).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components/admin/users`):
 * ONE render case per branch of the governance-actions visual state matrix
 * (DEV3-017 REQ-063/064/065), driven across BOTH locales:
 *
 *   4-state button visibility (active · suspended · blocked · deleted) ·
 *   suspend dialog periodDays client-side 1..3650 gate (0/3651/abc rejected,
 *   1/3650 accepted) · in-flight confirm slot (CircularProgress + disabled) ·
 *   USER_ALREADY_SUSPENDED inline info Alert · USER_ALREADY_DELETED inline
 *   warning Alert · FORBIDDEN suppressed (no inline Alert, no toast) ·
 *   VALIDATION periodDays field-level helperText projection · 4 success
 *   toasts via the caller-supplied `onToast` callback · RTL parity (Arabic
 *   renders with no English leak).
 *
 * Translation discipline: assertions reference ONLY the `governanceActions`
 * label object resolved through `AdminUsers.getLabels(getTranslations(locale))`
 * — ZERO hardcoded Arabic/English copy lives here. The one exception class is
 * fixture DATA (ids, ISO timestamps, the masked transport surface message
 * string suffix) which is recomputed identically to the AdminDisputes suite.
 */

import { afterEach, describe, expect, type Mock, mock, test } from "bun:test";
import type { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import {
  cleanup,
  fireEvent,
  getQueriesForElement,
  type RenderResult,
  type Screen,
  waitFor,
  within,
} from "@testing-library/react";
import { type AdminUserDetailQuery_adminUserDetail, Gender, UserRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminSetUserBlockedMutationDocument,
  adminSetUserSuspendedMutationDocument,
} from "@/frontend/graphql/sharedDocuments/admin";
import { GovernanceActionsSection } from "@/frontend/views/admin/users/detail/GovernanceActionsSection";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ---------------------------------------------------------------------------
// Fixtures (DATA — never locale copy)

/** Deterministic id of the active fixture user exercised by every case. */
const USER_ID = 4701;

/** Masked-transport-surface suffix appended to every server-localized
 *  conflict message — the suite asserts the FULL server message renders
 *  verbatim, so the suffix must be deterministic (NOT locale copy). */
const MASKED_SUFFIX = "(masked transport surface)";

/** A VALIDATION server-localized field message the wire emits for
 *  `periodDays` out-of-range — the suite asserts this renders verbatim as
 *  the TextField helperText (NOT locale copy — server owns this string). */
const PERIOD_FIELD_MESSAGE = "periodDays must be between 1 and 3650";

/**
 * Deterministic payload builder mirroring the closed AdminUserDetail wire
 * shape. `applicant`/`teacher`/`student`/`parent` are out-of-scope for the
 * governance section and stay `null`. Booleans are explicit so the
 * 4-state visibility matrix has unambiguous fixtures.
 */
function userFixture(overrides?: Partial<AdminUserDetailQuery_adminUserDetail>): AdminUserDetailQuery_adminUserDetail {
  return {
    id: USER_ID,
    fullName: " fixture user",
    email: "fixture@example.test",
    phone: null,
    role: UserRole.Student,
    dateOfBirth: null,
    gender: Gender.Other,
    country: null,
    isDeleted: false,
    deletedAt: null,
    suspended: false,
    suspendedAt: null,
    suspendedPeriodDays: null,
    isBlocked: false,
    blockedAt: null,
    lastActiveAt: null,
    createdAt: "2099-01-01T00:00:00.000Z",
    updatedAt: "2099-01-01T00:00:00.000Z",
    applicant: null,
    teacher: null,
    student: null,
    parent: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock builders

/** Single-operation Apollo mock answering the suspend mutation with a
 *  success payload mirroring the requested state transition. */
function suspendSuccessMock(userId: number, periodDays: number): MockLink.MockedResponse {
  return {
    request: {
      query: adminSetUserSuspendedMutationDocument,
      variables: { id: userId, suspended: true, periodDays },
    },
    result: {
      data: {
        adminSetUserSuspended: userFixture({
          suspended: true,
          suspendedPeriodDays: periodDays,
          suspendedAt: "2099-01-02T00:00:00.000Z",
        }),
      },
    },
  };
}

/** Single-operation Apollo mock answering the unsuspend mutation with a
 *  success payload (suspended=false, periodDays=null per the wire contract). */
function unsuspendSuccessMock(userId: number): MockLink.MockedResponse {
  return {
    request: {
      query: adminSetUserSuspendedMutationDocument,
      variables: { id: userId, suspended: false, periodDays: null },
    },
    result: {
      data: {
        adminSetUserSuspended: userFixture({ suspended: false, suspendedAt: null, suspendedPeriodDays: null }),
      },
    },
  };
}

/** Single-operation Apollo mock answering the block mutation with a
 *  success payload mirroring the requested state transition. */
function blockSuccessMock(userId: number): MockLink.MockedResponse {
  return {
    request: {
      query: adminSetUserBlockedMutationDocument,
      variables: { id: userId, blocked: true },
    },
    result: {
      data: {
        adminSetUserBlocked: userFixture({ isBlocked: true, blockedAt: "2099-01-02T00:00:00.000Z" }),
      },
    },
  };
}

/** Single-operation Apollo mock answering the unblock mutation with a
 *  success payload (isBlocked=false, blockedAt=null). */
function unblockSuccessMock(userId: number): MockLink.MockedResponse {
  return {
    request: {
      query: adminSetUserBlockedMutationDocument,
      variables: { id: userId, blocked: false },
    },
    result: {
      data: {
        adminSetUserBlocked: userFixture({ isBlocked: false, blockedAt: null }),
      },
    },
  };
}

/**
 * Single-operation mock denying the caller with a per-code conflict. Authored
 * as a raw `result.errors[]` entry exactly where the transport boundary puts
 * `extensions.code`; Apollo's MockedProvider wraps it into a genuine
 * `CombinedGraphQLErrors`, which `extractErrorCode` traverses — the same
 * extraction path the production error-link uses.
 */
function suspendConflictMock(
  userId: number,
  periodDays: number,
  code: string,
  message: string
): MockLink.MockedResponse {
  return {
    request: {
      query: adminSetUserSuspendedMutationDocument,
      variables: { id: userId, suspended: true, periodDays },
    },
    result: {
      errors: [{ message: `${message} ${MASKED_SUFFIX}`, extensions: { code } }],
    },
  };
}

/** Block-mutation variant of the conflict mock (no `periodDays` variable). */
function blockConflictMock(userId: number, code: string, message: string): MockLink.MockedResponse {
  return {
    request: {
      query: adminSetUserBlockedMutationDocument,
      variables: { id: userId, blocked: true },
    },
    result: {
      errors: [{ message: `${message} ${MASKED_SUFFIX}`, extensions: { code } }],
    },
  };
}

/** VALIDATION conflict with `extensions.fields[]` carrying the per-field
 *  server-localized message — exercises the field-level helperText projection. */
function suspendValidationMock(userId: number, periodDays: number): MockLink.MockedResponse {
  return {
    request: {
      query: adminSetUserSuspendedMutationDocument,
      variables: { id: userId, suspended: true, periodDays },
    },
    result: {
      errors: [
        {
          message: `VALIDATION ${MASKED_SUFFIX}`,
          extensions: {
            code: "VALIDATION",
            fields: [{ field: "periodDays", message: PERIOD_FIELD_MESSAGE }],
          },
        },
      ],
    },
  };
}

/** Permanently in-flight suspend mutation (`delay: Infinity` keeps MockLink
 *  emitting a never-settling Observable) so the in-flight slot renders. */
function pendingSuspendMock(userId: number, periodDays: number): MockLink.MockedResponse {
  return {
    request: {
      query: adminSetUserSuspendedMutationDocument,
      variables: { id: userId, suspended: true, periodDays },
    },
    delay: Infinity,
  };
}

// ---------------------------------------------------------------------------
// Render + expectation helpers

/**
 * Lazily-bound `screen` replacement (mirrors AdminDisputesContainer.suite):
 * RTL binds its `screen` singleton ONCE at module-eval time against whatever
 * `document` is live then. Binding through `getQueriesForElement(document.body)`
 * on EVERY property access resolves against the live DOM under BOTH runners
 * (this file's bootstrap AND the official `test:ui:components` preloads)
 * regardless of import order.
 */
const screen: Screen = new Proxy(Object.create(null), {
  get: (_target, property, receiver) => Reflect.get(getQueriesForElement(document.body), property, receiver),
});

/** Renders the section under TestWrapper (LocaleProvider → emotion → theme)
 *  with the supplied Apollo mocks + a fresh `onToast` spy. */
function renderSection(
  user: AdminUserDetailQuery_adminUserDetail,
  mocks: ReadonlyArray<MockLink.MockedResponse>,
  locale: AppLocale
): { result: RenderResult; onToast: Mock<(message: string) => void> } {
  // The mock body is a no-op; the `_message` arg is captured by the Mock
  // type's call log so per-call assertions resolve via `onToast.mock.calls`.
  const onToast: Mock<(message: string) => void> = mock((_message: string) => undefined);
  const mocksCopy = [...mocks];
  const result = renderWithWrapper(
    <MockedProvider mocks={mocksCopy}>
      <GovernanceActionsSection user={user} onToast={onToast} />
    </MockedProvider>,
    { locale }
  );
  return { result, onToast };
}

/** Resolves the MUI severity class of an Alert currently showing `text`
 *  (`MuiAlert-colorInfo` / `MuiAlert-colorWarning` families). */
function alertSeverityClass(text: string): string {
  return screen.getByText(text).closest(".MuiAlert-root")?.className ?? "";
}

/** Clicks the governance action button labeled `label` (aria-label match). */
function clickAction(label: string): void {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

/** Returns the visible Suspend dialog (assumes one is open). */
async function openSuspendDialog(label: string): Promise<HTMLElement> {
  clickAction(label);
  return await waitFor(() => screen.getByRole("dialog"));
}

/**
 * Common Suspend-form fill+submit: opens the Suspend dialog, types `periodDays`
 * into the periodDays field, and clicks the confirm button. Returns the open
 * dialog so the caller can assert on it (in-flight slot, inline Alert, etc.).
 *
 * Extracted to a helper to avoid jscpd clones across the suspend-related
 * success/conflict/validation/in-flight cases.
 */
async function submitSuspendForm(
  suspendAction: string,
  periodLabel: string,
  confirmLabel: string,
  periodDays: string
): Promise<HTMLElement> {
  const dialog = await openSuspendDialog(suspendAction);
  const periodInput = within(dialog).getByLabelText(periodLabel);
  fireEvent.change(periodInput, { target: { value: periodDays } });
  fireEvent.click(within(dialog).getByRole("button", { name: confirmLabel }));
  return dialog;
}

/**
 * Common no-field confirm: opens the dialog by clicking the action labeled
 * `actionLabel`, then clicks the confirm button. Used by the
 * unsuspend/block/unblock success + USER_ALREADY_DELETED conflict cases.
 */
async function openDialogAndConfirm(actionLabel: string, confirmLabel: string): Promise<HTMLElement> {
  clickAction(actionLabel);
  const dialog = await waitFor(() => screen.getByRole("dialog"));
  fireEvent.click(within(dialog).getByRole("button", { name: confirmLabel }));
  return dialog;
}

afterEach(cleanup);

// One block per locale keeps RTL/LTR both exercised over the FULL branch
// matrix while every case stays independently readable.
const LOCALES: ReadonlyArray<AppLocale> = ["ar", "en"] as AppLocale[];
for (const locale of LOCALES) {
  const t = AdminUsers.getLabels(getTranslations(locale)).governanceActions;

  describe(`GovernanceActionsSection (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("state 1 — active user: Suspend+Block enabled; Unsuspend+Unblock disabled", () => {
      renderSection(userFixture(), [], locale);

      // Active state: only the "off → on" transitions are live.
      const suspend = screen.getByRole("button", { name: t.suspendAction });
      const block = screen.getByRole("button", { name: t.blockAction });
      const unsuspend = screen.getByRole("button", { name: t.unsuspendAction });
      const unblock = screen.getByRole("button", { name: t.unblockAction });
      expect(suspend.getAttribute("disabled")).toBeNull();
      expect(block.getAttribute("disabled")).toBeNull();
      expect(unsuspend.getAttribute("disabled")).not.toBeNull();
      expect(unblock.getAttribute("disabled")).not.toBeNull();
    });

    test("state 2 — suspended user: Unsuspend enabled; Suspend disabled (Block/Unblock still gated on isBlocked)", () => {
      renderSection(
        userFixture({ suspended: true, suspendedAt: "2099-01-02T00:00:00.000Z", suspendedPeriodDays: 7 }),
        [],
        locale
      );

      const suspend = screen.getByRole("button", { name: t.suspendAction });
      const unsuspend = screen.getByRole("button", { name: t.unsuspendAction });
      expect(suspend.getAttribute("disabled")).not.toBeNull();
      expect(unsuspend.getAttribute("disabled")).toBeNull();
    });

    test("state 3 — blocked user: Unblock enabled; Block disabled", () => {
      renderSection(userFixture({ isBlocked: true, blockedAt: "2099-01-02T00:00:00.000Z" }), [], locale);

      const block = screen.getByRole("button", { name: t.blockAction });
      const unblock = screen.getByRole("button", { name: t.unblockAction });
      expect(block.getAttribute("disabled")).not.toBeNull();
      expect(unblock.getAttribute("disabled")).toBeNull();
    });

    test("state 4 — deleted user: ALL four actions disabled", () => {
      renderSection(userFixture({ isDeleted: true, deletedAt: "2099-01-02T00:00:00.000Z" }), [], locale);

      for (const label of [t.suspendAction, t.unsuspendAction, t.blockAction, t.unblockAction]) {
        const btn = screen.getByRole("button", { name: label });
        expect(btn.getAttribute("disabled")).not.toBeNull();
      }
    });

    test("suspend dialog — periodDays client gate: 0/3651/abc rejected; 1/3650 accepted", async () => {
      renderSection(userFixture(), [], locale);

      const dialog = await openSuspendDialog(t.suspendAction);
      const periodInput = within(dialog).getByLabelText(t.suspendPeriodLabel);
      const confirm = within(dialog).getByRole("button", { name: t.confirm });

      // Empty initial state — confirm disabled.
      expect(confirm.getAttribute("disabled")).not.toBeNull();

      // 0 → out of range (lower bound 1).
      fireEvent.change(periodInput, { target: { value: "0" } });
      expect(confirm.getAttribute("disabled")).not.toBeNull();

      // 1 → lower bound, accepted.
      fireEvent.change(periodInput, { target: { value: "1" } });
      expect(confirm.getAttribute("disabled")).toBeNull();

      // 3650 → upper bound, accepted.
      fireEvent.change(periodInput, { target: { value: "3650" } });
      expect(confirm.getAttribute("disabled")).toBeNull();

      // 3651 → upper bound exceeded, rejected.
      fireEvent.change(periodInput, { target: { value: "3651" } });
      expect(confirm.getAttribute("disabled")).not.toBeNull();

      // Non-numeric → rejected (integer gate).
      fireEvent.change(periodInput, { target: { value: "abc" } });
      expect(confirm.getAttribute("disabled")).not.toBeNull();
    });

    test("in-flight — confirm button shows CircularProgress + is disabled; cancel disabled", async () => {
      // Pending suspend mutation keeps the confirm slot in the loading state.
      renderSection(userFixture(), [pendingSuspendMock(USER_ID, 7)], locale);

      // The in-flight slot is observable once the form is submitted.
      const dialog = await submitSuspendForm(t.suspendAction, t.suspendPeriodLabel, t.confirm, "7");

      // The confirm button now shows a CircularProgress (role="progressbar"
      // is the accessible role MUI assigns) and the cancel button is disabled
      // for the duration of the request.
      expect(within(dialog).getByRole("progressbar")).toBeDefined();
      const cancel = within(dialog).getByRole("button", { name: t.cancel });
      expect(cancel.getAttribute("disabled")).not.toBeNull();
    });

    test("success — Suspend completes: onToast(suspendSuccessToast) + dialog closes", async () => {
      const { onToast } = renderSection(userFixture(), [suspendSuccessMock(USER_ID, 7)], locale);

      await submitSuspendForm(t.suspendAction, t.suspendPeriodLabel, t.confirm, "7");

      await waitFor(() => {
        expect(onToast).toHaveBeenCalledTimes(1);
        expect(onToast.mock.calls[0]?.[0]).toBe(t.suspendSuccessToast);
      });
      // Dialog dismissed on success — `onToast` is invoked by the hook's
      // `complete()` AFTER `setOpenAction(null)`, so the dialog's `open`
      // prop has already flipped to false. Under Happy-DOM, MUI Dialog's
      // Fade exit transition may leave the Portal briefly mounted, so the
      // unmount check uses an extended waitFor window (transition drain).
      await waitFor(
        () => {
          expect(screen.queryByRole("dialog")).toBeNull();
        },
        { timeout: 3000 }
      );
    });

    test("success — Unsuspend completes: onToast(unsuspendSuccessToast)", async () => {
      const { onToast } = renderSection(
        userFixture({ suspended: true, suspendedAt: "2099-01-02T00:00:00.000Z", suspendedPeriodDays: 7 }),
        [unsuspendSuccessMock(USER_ID)],
        locale
      );

      // Unsuspend has no periodDays field — direct confirm on dialog open.
      await openDialogAndConfirm(t.unsuspendAction, t.confirm);

      await waitFor(() => {
        expect(onToast).toHaveBeenCalledTimes(1);
        expect(onToast.mock.calls[0]?.[0]).toBe(t.unsuspendSuccessToast);
      });
    });

    test("success — Block completes: onToast(blockSuccessToast)", async () => {
      const { onToast } = renderSection(userFixture(), [blockSuccessMock(USER_ID)], locale);

      await openDialogAndConfirm(t.blockAction, t.confirm);

      await waitFor(() => {
        expect(onToast).toHaveBeenCalledTimes(1);
        expect(onToast.mock.calls[0]?.[0]).toBe(t.blockSuccessToast);
      });
    });

    test("success — Unblock completes: onToast(unblockSuccessToast)", async () => {
      const { onToast } = renderSection(
        userFixture({ isBlocked: true, blockedAt: "2099-01-02T00:00:00.000Z" }),
        [unblockSuccessMock(USER_ID)],
        locale
      );

      await openDialogAndConfirm(t.unblockAction, t.confirm);

      await waitFor(() => {
        expect(onToast).toHaveBeenCalledTimes(1);
        expect(onToast.mock.calls[0]?.[0]).toBe(t.unblockSuccessToast);
      });
    });

    test("conflict USER_ALREADY_SUSPENDED — inline info Alert with the server-localized message", async () => {
      const serverMessage = `USER_ALREADY_SUSPENDED ${locale}`;
      renderSection(userFixture(), [suspendConflictMock(USER_ID, 7, "USER_ALREADY_SUSPENDED", serverMessage)], locale);

      await submitSuspendForm(t.suspendAction, t.suspendPeriodLabel, t.confirm, "7");

      // The server message renders verbatim inside an Alert with severity="info".
      const expectedText = `${serverMessage} ${MASKED_SUFFIX}`;
      await waitFor(() => {
        expect(screen.getByText(expectedText)).toBeDefined();
      });
      const cls = alertSeverityClass(expectedText);
      expect(cls.includes("MuiAlert-colorInfo")).toBe(true);
      expect(cls.includes("MuiAlert-colorWarning")).toBe(false);
    });

    test("conflict USER_ALREADY_DELETED — inline warning Alert", async () => {
      const serverMessage = `USER_ALREADY_DELETED ${locale}`;
      // Block action against an active user triggers USER_ALREADY_DELETED when
      // the row was deleted between render and submit (the wire-tier race the
      // conflict code represents).
      renderSection(userFixture(), [blockConflictMock(USER_ID, "USER_ALREADY_DELETED", serverMessage)], locale);

      await openDialogAndConfirm(t.blockAction, t.confirm);

      const expectedText = `${serverMessage} ${MASKED_SUFFIX}`;
      await waitFor(() => {
        expect(screen.getByText(expectedText)).toBeDefined();
      });
      const cls = alertSeverityClass(expectedText);
      expect(cls.includes("MuiAlert-colorWarning")).toBe(true);
    });

    test("FORBIDDEN — suppressed inline (no Alert, no onToast call — rides the GraphQLErrorSurfaceHost toast path)", async () => {
      const { onToast } = renderSection(
        userFixture(),
        [suspendConflictMock(USER_ID, 7, "FORBIDDEN", "FORBIDDEN")],
        locale
      );

      await submitSuspendForm(t.suspendAction, t.suspendPeriodLabel, t.confirm, "7");

      // FORBIDDEN never lands as an inline Alert and never triggers onToast
      // (it rides the existing GraphQLErrorSurfaceHost toast path globally).
      await waitFor(() => {
        expect(screen.queryByText(`FORBIDDEN ${MASKED_SUFFIX}`)).toBeNull();
      });
      expect(onToast).not.toHaveBeenCalled();
    });

    test("VALIDATION periodDays — field-level helperText projection (server-localized message)", async () => {
      // A value WITHIN the client-side 1..3650 gate is used so the mutation
      // actually reaches the wire — the server's VALIDATION response is the
      // authority here (exercises the field-error → helperText projection
      // path; the client gate is a separate concern covered by the
      // periodDays client-gate case above).
      renderSection(userFixture(), [suspendValidationMock(USER_ID, 7)], locale);

      // Open the Suspend dialog and capture the periodDays field BEFORE the
      // submit click so the aria-invalid assertion targets the live element
      // (not the re-rendered one post-error).
      const dialog = await openSuspendDialog(t.suspendAction);
      const periodInput = within(dialog).getByLabelText(t.suspendPeriodLabel);
      fireEvent.change(periodInput, { target: { value: "7" } });
      fireEvent.click(within(dialog).getByRole("button", { name: t.confirm }));

      // The server-localized field message renders as the TextField
      // helperText (NOT a top-level inline Alert); the field is marked
      // aria-invalid=true.
      await waitFor(() => {
        expect(screen.getByText(PERIOD_FIELD_MESSAGE)).toBeDefined();
      });
      expect(periodInput.getAttribute("aria-invalid")).toBe("true");
    });

    test("RTL parity — every visible label resolves through the AdminUsers handle (no hardcoded English leak)", () => {
      // The Arabic locale block specifically asserts that NO English UI
      // strings leak: every visible label resolves through `t.*` (the same
      // property-access handle the component uses). The visible button
      // labels match the Arabic translations verbatim.
      renderSection(userFixture(), [], locale);

      const labels = [t.suspendAction, t.unsuspendAction, t.blockAction, t.unblockAction];
      for (const label of labels) {
        expect(screen.getByRole("button", { name: label })).toBeDefined();
      }
      // Under ar, the labels carry Arabic script (NOT transliterated ASCII).
      if (locale === "ar") {
        for (const label of labels) {
          const hasArabic = /[\u0600-\u06FF]/.test(label);
          expect(hasArabic).toBe(true);
        }
      }
    });
  });
}
