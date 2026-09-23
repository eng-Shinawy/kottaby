/**
 * Teacher Sessions Cache Arms — pure matrix tests for
 * `teacherActionsForSession`.
 *
 * Verifies the lifecycle → affordance matrix:
 *  - `Scheduled` → `["start"]`
 *  - `Started`    → `["complete", "homework"]` (order stable — Complete
 *    BEFORE Homework, mirroring the lifecycle time-arrow)
 *  - `Completed`  → `["report"]`, plus `"submitEvaluation"` on evaluation
 *    rows that still owe a rubric submission (order stable — the report
 *    descriptor stays first; the pending set decides "still owes")
 *  - `Cancelled`   → `[]`
 *  - `Disputed`    → `[]`
 *
 * Plus label identity: every action's `label` is the EXACT pinned key from
 * the `SessionsLabels` type (the type-erasure of the en leaf's resolved
 * copy is the source of truth — never hardcoded strings).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the
 * mandated runner: `bun run test/scripts/run-test.ts frontend/views/teacher/sessions/teacherSessionCacheArms.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
  type DisputeResolution,
  type MyTeacherSessionsQuery_myTeacherSessions_items,
  SessionIntent,
  SessionStatus,
  SessionType,
} from "@/frontend/graphql/generated/gql/graphql";
import { teacherActionsForSession } from "@/frontend/views/teacher/sessions/teacherSessionCacheArms";
import type { InFlightSlots } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import { sessionsEn } from "@/shared/locale/en/sessions";

/** An empty in-flight slot book (no mutation in flight). */
const EMPTY_IN_FLIGHT_SLOTS: InFlightSlots = {};

/** A slot book with one `complete` in-flight for session `"42"`. */
const COMPLETE_IN_FLIGHT_FOR_42: InFlightSlots = {
  "42": new Set(["complete" as const]),
};

/** A slot book with one `start` in-flight for session `"42"`. */
const START_IN_FLIGHT_FOR_42: InFlightSlots = {
  "42": new Set(["start" as const]),
};

/** A canonical dispute-resolution value (the null sentinel — no dispute ever filed). */
const NO_DISPUTE_RESOLUTION: DisputeResolution | null = null;

/** An empty pending-rubric set — no row owes a rubric submission. */
const EMPTY_PENDING_RUBRIC: ReadonlySet<string> = new Set();

/** A pending-rubric set where session "42" still owes its rubric submission. */
const PENDING_RUBRIC_FOR_42: ReadonlySet<string> = new Set(["42"]);

/** Builds a minimal session row with the given id + status, satisfying the
 *  full codegen row contract — every required field is present, with the
 *  nullable legs set to `null` and the lifecycle status under test. The
 *  session type defaults to the non-evaluation variant so only the
 *  rubric-affordance rows opt into the evaluation type. */
function sessionOf(
  id: string,
  status: SessionStatus,
  sessionType: SessionType = SessionType.ReEvaluation
): MyTeacherSessionsQuery_myTeacherSessions_items {
  return {
    id,
    status,
    intent: SessionIntent.Hifz,
    sessionType,
    fee: "0",
    feeHeld: false,
    studentId: "0",
    teacherId: "0",
    startedAt: null,
    endedAt: null,
    confirmationDeadline: null,
    confirmedByStudentAt: null,
    confirmedByTeacherAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    cancelReason: null,
    disputeReason: null,
    disputedAt: null,
    resolutionNote: null,
    resolutionOutcome: NO_DISPUTE_RESOLUTION,
    resolvedAt: null,
  };
}

/** A no-op intent handler — the matrix never invokes it in this suite. */
const noopIntent = (_sessionId: string): void => {
  /* the matrix does not invoke intents at this tier */
};

/** The wiring under test with NO mutation in flight + all CTAs wired. */
function wiringOf(
  inFlightSlots: InFlightSlots = EMPTY_IN_FLIGHT_SLOTS,
  pendingRubricSessionIds: ReadonlySet<string> = EMPTY_PENDING_RUBRIC
) {
  return {
    t: sessionsEn,
    inFlightSlots,
    onStart: noopIntent,
    onComplete: noopIntent,
    onHomework: noopIntent,
    onReport: noopIntent,
    onSubmitEvaluation: noopIntent,
    pendingRubricSessionIds,
  };
}

describe("teacherActionsForSession — lifecycle → affordance matrix", () => {
  test("Scheduled → EXACTLY one 'start' action with the startSession label", () => {
    const actions = teacherActionsForSession(sessionOf("1", SessionStatus.Scheduled), wiringOf());
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("start");
    expect(actions[0]?.label).toBe(sessionsEn.startSession);
    expect(actions[0]?.disabled).toBe(false);
  });

  test("Started → EXACTLY ['complete', 'homework'] in STABLE ORDER (Complete before Homework)", () => {
    const actions = teacherActionsForSession(sessionOf("1", SessionStatus.Started), wiringOf());
    expect(actions).toHaveLength(2);
    expect(actions[0]?.id).toBe("complete");
    expect(actions[0]?.label).toBe(sessionsEn.completeSession);
    expect(actions[1]?.id).toBe("homework");
    expect(actions[1]?.label).toBe(sessionsEn.viewHomeworkAction);
  });

  test("Completed → EXACTLY one 'report' action with the sessionReportAction label", () => {
    const actions = teacherActionsForSession(sessionOf("1", SessionStatus.Completed), wiringOf());
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("report");
    expect(actions[0]?.label).toBe(sessionsEn.sessionReportAction);
  });

  test("Cancelled → EMPTY actions array (no affordances)", () => {
    const actions = teacherActionsForSession(sessionOf("1", SessionStatus.Cancelled), wiringOf());
    expect(actions).toHaveLength(0);
  });

  test("Disputed → EMPTY actions array (no affordances)", () => {
    const actions = teacherActionsForSession(sessionOf("1", SessionStatus.Disputed), wiringOf());
    expect(actions).toHaveLength(0);
  });

  test("all non-terminal actions carry an onIntent (the container owns the mutation launch)", () => {
    const scheduled = teacherActionsForSession(sessionOf("1", SessionStatus.Scheduled), wiringOf());
    const started = teacherActionsForSession(sessionOf("1", SessionStatus.Started), wiringOf());
    const completed = teacherActionsForSession(sessionOf("1", SessionStatus.Completed), wiringOf());
    for (const action of [...scheduled, ...started, ...completed]) {
      expect(typeof action.onIntent).toBe("function");
    }
  });
});

describe("teacherActionsForSession — in-flight discipline (lifecycle slots)", () => {
  test("Scheduled row disables its Start CTA when ITS OWN start slot is in flight", () => {
    const actions = teacherActionsForSession(
      sessionOf("42", SessionStatus.Scheduled),
      wiringOf(START_IN_FLIGHT_FOR_42)
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.disabled).toBe(true);
  });

  test("Started row disables its Complete CTA when ITS OWN complete slot is in flight (Homework unaffected)", () => {
    const actions = teacherActionsForSession(
      sessionOf("42", SessionStatus.Started),
      wiringOf(COMPLETE_IN_FLIGHT_FOR_42)
    );
    expect(actions).toHaveLength(2);
    expect(actions[0]?.id).toBe("complete");
    expect(actions[0]?.disabled).toBe(true);
    // Homework CTA carries NO in-flight slot — never disabled by lifecycle slots.
    expect(actions[1]?.id).toBe("homework");
    expect(actions[1]?.disabled).toBeUndefined();
  });

  test("Sibling rows stay interactive when one row's slot is in flight (no cross-row contamination)", () => {
    const siblingActions = teacherActionsForSession(
      sessionOf("OTHER", SessionStatus.Started),
      wiringOf(COMPLETE_IN_FLIGHT_FOR_42)
    );
    expect(siblingActions[0]?.disabled).toBe(false);
  });

  test("Homework CTA never carries a `disabled` flag (the dialog owns loading; the CTA is status-pure — no N+1)", () => {
    const actions = teacherActionsForSession(sessionOf("1", SessionStatus.Started), wiringOf(EMPTY_IN_FLIGHT_SLOTS));
    const homeworkAction = actions.find(action => action.id === "homework");
    expect(homeworkAction?.disabled).toBeUndefined();
  });

  test("Report CTA never carries a `disabled` flag (the dialog owns loading; the CTA is status-pure)", () => {
    const actions = teacherActionsForSession(sessionOf("1", SessionStatus.Completed), wiringOf(EMPTY_IN_FLIGHT_SLOTS));
    const reportAction = actions.find(action => action.id === "report");
    expect(reportAction?.disabled).toBeUndefined();
  });

  test("Submit-evaluation CTA never carries a `disabled` flag (the dialog owns loading; the CTA is status-pure)", () => {
    const actions = teacherActionsForSession(
      sessionOf("42", SessionStatus.Completed, SessionType.TeacherEvaluation),
      wiringOf(EMPTY_IN_FLIGHT_SLOTS, PENDING_RUBRIC_FOR_42)
    );
    const rubricAction = actions.find(action => action.id === "submitEvaluation");
    expect(rubricAction?.disabled).toBeUndefined();
  });
});

describe("teacherActionsForSession — rubric-evaluation affordance (pending-set + type gate)", () => {
  test("Completed evaluation row that still owes a submission → ['report', 'submitEvaluation'] in STABLE ORDER (Report first)", () => {
    const actions = teacherActionsForSession(
      sessionOf("42", SessionStatus.Completed, SessionType.TeacherEvaluation),
      wiringOf(EMPTY_IN_FLIGHT_SLOTS, PENDING_RUBRIC_FOR_42)
    );
    expect(actions).toHaveLength(2);
    expect(actions[0]?.id).toBe("report");
    expect(actions[1]?.id).toBe("submitEvaluation");
    expect(actions[1]?.label).toBe(sessionsEn.submitEvaluationAction);
  });

  test("Completed evaluation row whose submission already landed → ['report'] ONLY (the row loses its action)", () => {
    const actions = teacherActionsForSession(
      sessionOf("42", SessionStatus.Completed, SessionType.TeacherEvaluation),
      wiringOf(EMPTY_IN_FLIGHT_SLOTS, EMPTY_PENDING_RUBRIC)
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("report");
  });

  test("Completed non-evaluation row inside the pending set → ['report'] ONLY (the session-type gate holds)", () => {
    const actions = teacherActionsForSession(
      sessionOf("42", SessionStatus.Completed, SessionType.StudentSession),
      wiringOf(EMPTY_IN_FLIGHT_SLOTS, PENDING_RUBRIC_FOR_42)
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("report");
  });

  test("Pending membership never leaks the rubric CTA onto non-Completed rows", () => {
    for (const status of [
      SessionStatus.Scheduled,
      SessionStatus.Started,
      SessionStatus.Cancelled,
      SessionStatus.Disputed,
    ]) {
      const actions = teacherActionsForSession(
        sessionOf("42", status, SessionType.TeacherEvaluation),
        wiringOf(EMPTY_IN_FLIGHT_SLOTS, PENDING_RUBRIC_FOR_42)
      );
      expect(actions.find(action => action.id === "submitEvaluation")).toBeUndefined();
    }
  });

  test("Sibling completed evaluation rows stay gated independently (no cross-row contamination)", () => {
    const submittedSibling = teacherActionsForSession(
      sessionOf("OTHER", SessionStatus.Completed, SessionType.TeacherEvaluation),
      wiringOf(EMPTY_IN_FLIGHT_SLOTS, PENDING_RUBRIC_FOR_42)
    );
    expect(submittedSibling.find(action => action.id === "submitEvaluation")).toBeUndefined();
    const pendingSibling = teacherActionsForSession(
      sessionOf("42", SessionStatus.Completed, SessionType.TeacherEvaluation),
      wiringOf(EMPTY_IN_FLIGHT_SLOTS, PENDING_RUBRIC_FOR_42)
    );
    expect(pendingSibling.find(action => action.id === "submitEvaluation")).toBeDefined();
  });
});

describe("teacherActionsForSession — label identity (compile-time i18n keys, no hardcoded strings)", () => {
  test("every label is the EXACT pinned SessionsLabels key (label identity, not string equality)", () => {
    // The Start CTA's label is the type-pinned `startSession` key.
    expect(teacherActionsForSession(sessionOf("1", SessionStatus.Scheduled), wiringOf())[0]?.label).toBe(
      sessionsEn.startSession
    );
    // The Complete CTA's label is the type-pinned `completeSession` key.
    expect(
      teacherActionsForSession(sessionOf("1", SessionStatus.Started), wiringOf()).find(
        action => action.id === "complete"
      )?.label
    ).toBe(sessionsEn.completeSession);
    // The Homework CTA's label is the type-pinned `viewHomeworkAction` key (the pinned affordance name).
    expect(
      teacherActionsForSession(sessionOf("1", SessionStatus.Started), wiringOf()).find(
        action => action.id === "homework"
      )?.label
    ).toBe(sessionsEn.viewHomeworkAction);
    // The Report CTA's label is the type-pinned `sessionReportAction` key.
    expect(teacherActionsForSession(sessionOf("1", SessionStatus.Completed), wiringOf())[0]?.label).toBe(
      sessionsEn.sessionReportAction
    );
    // The Submit-evaluation CTA's label is the type-pinned `submitEvaluationAction` key.
    expect(
      teacherActionsForSession(
        sessionOf("42", SessionStatus.Completed, SessionType.TeacherEvaluation),
        wiringOf(EMPTY_IN_FLIGHT_SLOTS, PENDING_RUBRIC_FOR_42)
      ).find(action => action.id === "submitEvaluation")?.label
    ).toBe(sessionsEn.submitEvaluationAction);
  });
});

describe("teacherActionsForSession — action id union stays closed", () => {
  // Pin the closed union — every action id the matrix emits MUST be one of
  // the canonical ids. A future drift where someone widens the union
  // to `string` would surface here.
  test("every emitted action id is one of {start, complete, homework, report, submitEvaluation}", () => {
    const allStatuses = [
      SessionStatus.Scheduled,
      SessionStatus.Started,
      SessionStatus.Completed,
      SessionStatus.Cancelled,
      SessionStatus.Disputed,
    ];
    const seenIds = new Set<string>();
    for (const status of allStatuses) {
      for (const sessionType of [SessionType.TeacherEvaluation, SessionType.StudentSession]) {
        for (const action of teacherActionsForSession(
          sessionOf("1", status, sessionType),
          wiringOf(EMPTY_IN_FLIGHT_SLOTS, new Set(["1"]))
        )) {
          seenIds.add(action.id);
        }
      }
    }
    // The matrix covers exactly the lifecycle + the three dialog-opening
    // CTAs; the student-surface-only `confirm` and `rate` ids never appear
    // on the teacher surface.
    expect(seenIds).toEqual(new Set(["start", "complete", "homework", "report", "submitEvaluation"]));
  });
});
