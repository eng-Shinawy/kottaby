import { useMutation } from "@apollo/client/react";
import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useEffect, useState } from "react";
import { ApplicantStatus, UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { adminCertifyTeacherColdStartMutationDocument } from "@/frontend/graphql/sharedDocuments/admin";
import { StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { type AdminUserCertifyTarget, CertifyTeacherDialog } from "@/frontend/views/admin/users/dialogs";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminUsers } from "@/shared/locale/namespaces";

/**
 * Storybook surface for `CertifyTeacherDialog` — the admin cold-start
 * teacher-certification confirmation dialog mounted from the user-detail
 * hero (and from `AdminUserDetailInlineDialogs` on the real page).
 *
 * The dialog itself is presentational (labels + target + callbacks), but
 * the harness wires a REAL `useMutation` against
 * `adminCertifyTeacherColdStartMutationDocument` on
 * `StoryApolloProvider` so Confirm runs the full MockLink round trip —
 * the AlreadyCertifiedError variant auto-clicks Confirm once after mount so
 * the mutation rejection lands in the dialog's inline warning alert
 * (mocked as a raw `result.errors[]` entry carrying
 * `extensions.code: "TEACHER_ALREADY_CERTIFIED"`, exactly the shape the
 * transport boundary produces).
 */

const TARGET_USER: AdminUserCertifyTarget = {
  id: 7,
  fullName: "Yusuf Al-Amin",
  email: "yusuf.alamin@example.com",
};

/** Successful cold-start certification (post-write `AdminUserDetail` payload). */
function certifySuccessMock(makeEvaluator: boolean): MockLink.MockedResponse {
  return {
    request: {
      query: adminCertifyTeacherColdStartMutationDocument,
      variables: { userId: TARGET_USER.id, makeEvaluator },
    },
    result: {
      data: {
        adminCertifyTeacherColdStart: {
          __typename: "AdminUserDetail",
          id: TARGET_USER.id,
          role: UserRole.Teacher,
          isDeleted: false,
          suspended: false,
          isBlocked: false,
          applicant: { __typename: "ApplicantProfile", id: 11, status: ApplicantStatus.Passed },
          teacher: {
            __typename: "AdminTeacherSnapshot",
            isApproved: true,
            isEvaluator: makeEvaluator,
            isOnline: false,
            averageRating: null,
          },
        },
      },
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Rejecting certification — TEACHER_ALREADY_CERTIFIED conflict. */
const ALREADY_CERTIFIED_MOCK: MockLink.MockedResponse = {
  request: {
    query: adminCertifyTeacherColdStartMutationDocument,
    variables: { userId: TARGET_USER.id, makeEvaluator: true },
  },
  result: {
    errors: [
      {
        message: "TEACHER_ALREADY_CERTIFIED (masked transport surface)",
        extensions: { code: "TEACHER_ALREADY_CERTIFIED" },
      },
    ],
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

interface CertifyHarnessProps {
  readonly mocks: readonly MockLink.MockedResponse[];
  readonly loading?: boolean;
  /** Click the evaluator checkbox once after mount (EvaluatorUnchecked). */
  readonly autoUncheck?: boolean;
  /** Click Confirm once after mount (error-projection variants). */
  readonly autoConfirm?: boolean;
}

/**
 * Harness — keeps the mutation on the harness side (mirroring the page
 * wiring), and drives optional one-shot DOM clicks for the variants whose
 * interest IS a post-interaction state (unchecked checkbox, inline error
 * alert). Clicks run against the dialog portal once after mount.
 *
 * Two layers are REQUIRED: `useMutation` must run in a component that is a
 * DESCENDANT of `StoryApolloProvider` — hooks called by the component that
 * renders the provider itself see no Apollo context (invariant violation).
 */
function CertifyHarness({ mocks, ...innerProps }: CertifyHarnessProps): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <CertifyHarnessInner {...innerProps} />
    </StoryApolloProvider>
  );
}

function CertifyHarnessInner({
  loading = false,
  autoUncheck = false,
  autoConfirm = false,
}: Omit<CertifyHarnessProps, "mocks">): ReactNode {
  const [certify] = useMutation(adminCertifyTeacherColdStartMutationDocument);
  const [certifying, setCertifying] = useState(false);
  const labels = useAppTranslation(AdminUsers);

  useEffect(() => {
    if (!autoUncheck && !autoConfirm) return undefined;
    const timer = window.setTimeout(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog) return;
      if (autoUncheck) dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      if (autoConfirm) {
        const confirm = [...dialog.querySelectorAll("button")].find(
          button => button.textContent === labels.certifyDialog.confirm
        );
        confirm?.click();
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [autoUncheck, autoConfirm, labels]);

  return (
    <CertifyTeacherDialog
      labels={labels}
      targetUser={TARGET_USER}
      loading={loading || certifying}
      onResolve={async makeEvaluator => {
        // `null` = cancel (story ends); the NO-try/catch contract applies —
        // rejections propagate into the dialog's inline alert.
        if (makeEvaluator === null) return;
        setCertifying(true);
        try {
          await certify({ variables: { userId: TARGET_USER.id, makeEvaluator } });
        } finally {
          setCertifying(false);
        }
      }}
    />
  );
}

const meta = {
  title: "Admin/Certify Teacher Dialog",
  component: CertifyHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks", "loading", "autoUncheck", "autoConfirm"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CertifyHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Armed dialog — warning banner naming the target + pre-checked evaluator grant. */
export const Default: Story = {
  args: { mocks: [certifySuccessMock(true)] },
};

/** Evaluator checkbox unchecked (the harness unticks it once after mount). */
export const EvaluatorUnchecked: Story = {
  args: { mocks: [certifySuccessMock(false)], autoUncheck: true },
};

/** In-flight confirm — both buttons disabled while the mutation runs. */
export const Loading: Story = {
  args: { mocks: [certifySuccessMock(true)], loading: true },
};

/**
 * TEACHER_* conflict projection: the harness clicks Confirm once, the
 * mutation rejects with `TEACHER_ALREADY_CERTIFIED`, and the dialog renders
 * the Errors-namespace copy in an inline warning alert — dialog stays open.
 */
export const AlreadyCertifiedError: Story = {
  args: { mocks: [ALREADY_CERTIFIED_MOCK], autoConfirm: true },
};
