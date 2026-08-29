/**
 * ApplicantStatusCard — component suite.
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): every
 * render branch of the status-card visual state matrix gets ONE render case,
 * driven across BOTH locales:
 *
 *   loading · error-denied (FORBIDDEN) · generic-error · null-certified ·
 *   pending · in_evaluation · failed-active-cooldown (future ISO) ·
 *   failed-eligible · passed
 *
 * Translation discipline: assertions reference ONLY the PRELOADED label objects
 * resolved through `Applicant.getLabels(getTranslations(locale))` and
 * `Errors.getLabels(...)` — ZERO hardcoded Arabic/English copy lives here.
 * The one exception class is fixture DATA (ids, e-mail-free payloads, an
 * ASCII name) plus the cooldown timestamp, which is recomputed with a
 * local `Intl.DateTimeFormat` clone of the documented option set (the
 * byte-consistency technique used by the service-layer suite).
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
import {
  ApplicantStatus,
  type MyApplicantProfileQuery_myApplicantProfile,
} from "@/frontend/graphql/generated/gql/graphql";
import { myApplicantProfileQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { ApplicantStatusCard } from "@/frontend/views/teachers/dashboard";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Applicant as ApplicantNs } from "@/shared/locale/namespaces/applicant";
import { Errors as ErrorsNs } from "@/shared/locale/namespaces/errors";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

/** A far-future instant so the mocked row is deterministically mid-cooldown. */
const FUTURE_COOLDOWN_ISO = "2099-01-15T10:30:00.000Z";

/** Deterministic profile payload builder mirroring the closed 7-field shape. */
function applicantProfileFixture(
  overrides?: Partial<MyApplicantProfileQuery_myApplicantProfile>
): MyApplicantProfileQuery_myApplicantProfile {
  return {
    id: 42424,
    status: ApplicantStatus.Pending,
    verificationAttempts: 0,
    lastAttemptAt: null,
    cooldownUntil: null,
    cooldownActive: false,
    canPurchaseVerification: true,
    ...overrides,
  };
}

interface ProfileCaseMockOptions {
  readonly overrides?: Partial<MyApplicantProfileQuery_myApplicantProfile>;
}

/** Single-operation Apollo mock answering the shared document with a payload. */
function profileSuccessMock({ overrides }: ProfileCaseMockOptions = {}): MockLink.MockedResponse {
  return {
    request: { query: myApplicantProfileQueryDocument },
    result: { data: { myApplicantProfile: applicantProfileFixture(overrides) } },
  };
}

/** Single-operation Apollo mock denying the caller at the scope layer.
 *
 * The deny is authored as a raw `result.errors[]` entry exactly where the
 * transport boundary puts `extensions.code`; Apollo's MockedProvider wraps
 * it into a genuine `CombinedGraphQLErrors`, which `extractErrorCode`
 * traverses (`errors[0].extensions.code`) — the same extraction path the
 * production error-link uses under `frontend/providers/apollo/utils.ts`.
 */
function deniedGraphQLError(code: string): MockLink.MockedResponse {
  return {
    request: { query: myApplicantProfileQueryDocument },
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
      <ApplicantStatusCard />
    </MockedProvider>,
    { locale }
  );
}

/** Recomputes the cooldown stamp independently of the implementation. */
function expectedCooldownStamp(iso: string, locale: AppLocale): string {
  const formatter = new Intl.DateTimeFormat(locale === "en" ? "en" : "ar", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date(iso));
}

afterEach(cleanup);

// One block per locale keeps RTL/LTR both exercised over the FULL branch
// matrix while every case stays independently readable.
for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = ApplicantNs.getLabels(getTranslations(locale));
  const te = ErrorsNs.getLabels(getTranslations(locale));

  describe(`ApplicantStatusCard (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("branch 1 — query in flight renders the busy skeleton card", () => {
      // `delay: Infinity` keeps the operation permanently in flight (MockLink
      // returns a never-settling Observable for it). An EMPTY mock list would
      // NOT leave the query pending — MockLink emits an async unmatched-
      // operation error instead.
      const { container } = renderCard(
        [{ request: { query: myApplicantProfileQueryDocument }, delay: Infinity }],
        locale
      );

      const skeleton = screen.getByTestId("applicant-status-card-loading");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      expect(container.querySelector("[data-testid='applicant-status-card']")).toBeNull();
      // No settled copy may leak into the skeleton.
      expect(container.textContent?.includes(t.statusPending)).toBe(false);
      expect(container.textContent?.includes(t.certifiedSummary)).toBe(false);
    });

    test("branch 2 — FORBIDDEN denial renders PermissionDeniedFallback", async () => {
      const errors = ErrorsNs.getLabels(getTranslations(locale));
      const { container } = renderCard([deniedGraphQLError("FORBIDDEN")], locale);

      await waitFor(() => {
        expect(screen.getByText(errors.forbiddenRole)).toBeDefined();
      });
      expect(screen.getByText(errors.forbidden)).toBeDefined();
      // The deny surface REPLACES the card entirely — never bare null.
      expect(container.querySelector("[data-testid='applicant-status-card']")).toBeNull();
    });

    test("branch 3 — non-denial failure surfaces the generic inline alert", async () => {
      const { container } = renderCard([deniedGraphQLError("INTERNAL_SERVER_ERROR")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.internalServerError)).toBeDefined();
      });
      // The permission fallback must NOT appear for non-deny codes.
      expect(screen.queryByText(te.forbiddenRole)).toBeNull();
      expect(container.querySelector("[data-testid='applicant-status-card']")).not.toBeNull();
    });

    test(`branch 4 — ${locale}: null payload renders the certified summary + surfaces hint (no status chip)`, async () => {
      const { container } = renderCard(
        [{ request: { query: myApplicantProfileQueryDocument }, result: { data: { myApplicantProfile: null } } }],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(t.certifiedSummary)).toBeDefined();
      });
      expect(screen.getByText(t.certifiedSurfacesHint)).toBeDefined();
      // Honesty probes: neither status labels nor any lifecycle chip text.
      expect(container.textContent?.includes(t.statusPending)).toBe(false);
      expect(container.textContent?.includes(t.statusInEvaluation)).toBe(false);
      expect(container.textContent?.includes(t.statusFailed)).toBe(false);
      expect(container.textContent?.includes(t.statusPassed)).toBe(false);
    });

    test("branch 5 — Pending chip + awaiting-purchase prompt + storefront CTA", async () => {
      const { container } = renderCard([profileSuccessMock()], locale);

      await waitFor(() => {
        expect(screen.getByText(t.pendingPrompt)).toBeDefined();
      });
      expect(screen.getByText(t.statusPending)).toBeDefined();
      // The storefront CTA is a REAL navigation now — /plans hosts the
      // verification plan the applicant must acquire.
      const storefrontCta = screen.getByRole("link", { name: t.pendingPlansCta });
      expect(storefrontCta.getAttribute("href")).toBe("/plans");
      expect(container.textContent?.includes(t.certifiedSummary)).toBe(false);
      expect(container.textContent?.includes(t.eligibleToReapply)).toBe(false);
    });

    test("branch 6 — InEvaluation chip + attempts counter + progress hint", async () => {
      renderCard(
        [profileSuccessMock({ overrides: { status: ApplicantStatus.InEvaluation, verificationAttempts: 2 } })],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(t.inEvaluationHint)).toBeDefined();
      });
      expect(screen.getByText(t.statusInEvaluation)).toBeDefined();
      expect(screen.getByText(t.attemptCountLabel)).toBeDefined();
      expect(screen.getByText(2)).toBeDefined();
    });

    test("branch 7 — Failed+active cooldown: expanded expiry line + DISABLED CTA, eligible copy suppressed", async () => {
      const { container } = renderCard(
        [
          profileSuccessMock({
            overrides: {
              status: ApplicantStatus.Failed,
              cooldownActive: true,
              cooldownUntil: FUTURE_COOLDOWN_ISO,
              canPurchaseVerification: false,
              verificationAttempts: 1,
            },
          }),
        ],
        locale
      );

      const expectedLine = t.cooldownExpiryLine.replace(
        "{cooldownUntil}",
        expectedCooldownStamp(FUTURE_COOLDOWN_ISO, locale)
      );
      await waitFor(() => {
        expect(screen.getByText(expectedLine)).toBeDefined();
      });
      expect(screen.getByText(t.statusFailed)).toBeDefined();

      const reapplyButton = screen.getByRole("button", { name: t.reapplyCta });
      expect(reapplyButton.getAttribute("disabled")).not.toBeNull();

      // Honesty probe: the expired-cooldown invitation must NOT show
      // while the waiting period runs.
      expect(container.textContent?.includes(t.eligibleToReapply)).toBe(false);
      // Raw ICU placeholder must never leak into DOM (parity pin echo).
      expect(container.textContent?.includes("{cooldownUntil}")).toBe(false);
    });

    test("branch 8 — Failed+eligible: ENABLED re-apply CTA navigating to the /plans storefront", async () => {
      const { container } = renderCard(
        [profileSuccessMock({ overrides: { status: ApplicantStatus.Failed, verificationAttempts: 3 } })],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(t.eligibleToReapply)).toBeDefined();
      });
      // Re-apply is now a REAL navigation (next/link → /plans): the CTA
      // renders as a link carrying the reapply label, pointing at the
      // storefront where the verification plan lives.
      const reapplyLink = screen.getByRole("link", { name: t.reapplyCta });
      expect(reapplyLink.getAttribute("href")).toBe("/plans");
      expect(screen.getByText(t.statusFailed)).toBeDefined();
      // Cooldown-line copy belongs exclusively to branch 7 — the static
      // prefix of the ICU template must NOT leak into the eligible story.
      const cooldownPrefix = t.cooldownExpiryLine.split("{cooldownUntil}")[0] ?? "";
      expect(container.textContent?.includes(cooldownPrefix)).toBe(false);
    });

    test("branch 9 — Passed: passed chip + certified narrative", async () => {
      renderCard(
        [profileSuccessMock({ overrides: { status: ApplicantStatus.Passed, canPurchaseVerification: false } })],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(t.certifiedSummary)).toBeDefined();
      });
      expect(screen.getByText(t.statusPassed)).toBeDefined();
      // No purchase/exam action copy inside the passed story.
      expect(screen.queryByRole("button", { name: t.reapplyCta })).toBeNull();
      // Honesty: pending/failed families stay out of this branch.
      expect(screen.queryByText(t.statusFailed)).toBeNull();
      expect(screen.queryByText(t.statusPending)).toBeNull();
    });
  });
}
