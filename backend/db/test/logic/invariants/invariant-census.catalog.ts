/**
 * Invariant census — the machine-readable registry binding every documented
 * state-machine invariant (`docs/specs/state-machine-invariants.md`, the
 * canonical 67-ID source) to the named test(s) that verify it, together with
 * each invariant's enforcement tier, coverage verdict, and the disposition the
 * verification program applies to the row.
 *
 * The census is the single audit surface for the "every invariant is tested"
 * claim: the doc ↔ census ↔ test-file bijection is enforced by the co-located
 * drift oracle (`invariant-census-drift.test.ts`), which walks every row and
 * binding below. Row/binding contract consumed by the oracle:
 *
 *  - `id` — the doc's `INV-*` token; the oracle extracts every `INV-[A-Z]+\d+`
 *    token from the doc and asserts set-equality in BOTH directions.
 *  - `docLine` — line of the invariant's statement row inside the doc.
 *  - `bindings[].testPath` — repo-root-relative POSIX path of the bound test
 *    file; the oracle asserts the file exists on disk.
 *  - `bindings[].testName` — a verbatim title fragment of a `test(...)` /
 *    `describe(...)` inside that file; the oracle asserts the fragment is
 *    greppable in the file's content. A renamed or deleted test fails CI.
 *  - `docDrift` — present exactly on the rows whose shipped semantics differ
 *    from the doc wording (annotated on the doc, never silently rewritten).
 *  - `ledgerRef` — present exactly on the PIN rows; a live `D-4xx` string in
 *    the deferred-items ledger naming the schema-hardening ticket pointer.
 *
 * Dispositions:
 *  - VERIFY-BY-REFERENCE  — an existing named test already proves the
 *    invariant; the census binds it (sibling suites are cited, never forked).
 *  - EXTEND              — an existing suite gains the named assertions.
 *  - NEW-PROBE            — a new test file / journey is authored.
 *  - PIN-APP-LAYER+DOC-DRIFT — no DB-level enforcement exists (or shipped
 *    semantics differ from the doc); tests pin the app-layer behavior and the
 *    ledger points at the future hardening ticket.
 *
 * Bindings whose tests have not landed yet carry the planned `testName`; the
 * oracle stays red for those rows by design until the owning suite lands, so a
 * row can never silently lose its proof.
 */

export type InvariantMachine = "S" | "TV" | "A" | "B" | "W" | "U" | "P" | "PAY" | "HW" | "PR" | "E" | "PC";

export type InvariantVerdict = "COVERED" | "PARTIAL" | "GAP";

export type InvariantDisposition = "VERIFY-BY-REFERENCE" | "EXTEND" | "NEW-PROBE" | "PIN-APP-LAYER+DOC-DRIFT";

export interface InvariantCensusBinding {
  /** Repo-root-relative POSIX path of the bound test file. */
  readonly testPath: string;
  /** Greppable test/describe title fragment inside that file. */
  readonly testName: string;
  /** This binding's tier (SVC / REPO / DB CHECK / TRIGGER / SCHEMA / STATIC / JRN / SDL / wire / route). */
  readonly tier?: string;
}

export interface InvariantCensusEntry {
  /** Doc token, e.g. "INV-S1". */
  readonly id: string;
  readonly machine: InvariantMachine;
  /** Line of the invariant's statement row in the canonical doc. */
  readonly docLine: number;
  /** Abridged invariant statement. */
  readonly statement: string;
  /** Where enforcement lives (may span several tiers). */
  readonly enforcementTier: string;
  readonly verdict: InvariantVerdict;
  readonly disposition: InvariantDisposition;
  /** Present on rows with doc-vs-shipped drift (annotated on the doc, never rewritten). */
  readonly docDrift?: string;
  /** Present on PIN rows: the deferred-items ledger row naming the future hardening ticket. */
  readonly ledgerRef?: string;
  readonly notes?: string;
  /** ≥ 1 named test binding per row. */
  readonly bindings: readonly InvariantCensusBinding[];
}

/** The canonical 67-invariant doc the drift oracle parses for `INV-` tokens. */
export const CENSUS_DOC_PATH = "docs/specs/state-machine-invariants.md";

export const INVARIANT_CENSUS: Readonly<Record<InvariantMachine, readonly InvariantCensusEntry[]>> = {
  S: [
    {
      id: "INV-S1",
      machine: "S",
      docLine: 42,
      statement: "A session cannot transition from completed back to started or scheduled (completed is terminal).",
      enforcementTier: "SVC matrix · REPO · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/classes/session-lifecycle.enforcement.test.ts",
          testName: "every off-matrix pair is denied (5×5 sweep: terminals, no-ops, backwards moves)",
          tier: "SVC",
        },
        {
          testPath: "test/workflows/sessions/session-state-machine.journey.test.ts",
          testName: "completed → start is denied (INV-S1: completed is terminal), zero writes",
          tier: "JRN",
        },
      ],
    },
    {
      id: "INV-S2",
      machine: "S",
      docLine: 43,
      statement: "A session cannot transition from cancelled to any other state (cancelled is terminal).",
      enforcementTier: "SVC · REPO · JRN",
      verdict: "COVERED",
      disposition: "EXTEND",
      notes:
        "Two documented off-matrix amendments exist (sweepExpiredCompletedOnce completed→cancelled; openPostConfirmationDisputeOnce completed→disputed) and are whitelisted, never defects.",
      bindings: [
        {
          testPath: "test/workflows/sessions/session-state-machine.journey.test.ts",
          testName: "cancelled → complete is denied (INV-S2: cancelled is terminal), zero writes",
          tier: "JRN",
        },
        {
          testPath: "test/workflows/sessions/session-state-machine.journey.test.ts",
          testName: "cancelled → dispute is denied (INV-S2: cancelled is terminal), zero writes",
          tier: "JRN",
        },
      ],
    },
    {
      id: "INV-S3",
      machine: "S",
      docLine: 44,
      statement:
        "A teacher_transaction (type = earning) is created only when a session transitions to completed AND the student confirms (dual confirmation).",
      enforcementTier: "SVC · REPO",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/classes/session-lifecycle.service.test.ts",
          testName:
            "confirmSessionCompletion happy path: student stamp + hold release + EXACTLY ONE earning credit (ledger row + wallet increment) in one flow",
          tier: "SVC",
        },
        {
          testPath: "backend/services/classes/session-lifecycle.service.test.ts",
          testName: "the unit's cross-surface channels are the wallet-credit slice",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-S4",
      machine: "S",
      docLine: 45,
      statement: "A session must have both teacher_id and student_id (NOT NULL).",
      enforcementTier: "SCHEMA",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/db/test/repo/classes/session.repository.test.ts",
          testName: "INV-S4: a session row without its teacher party is rejected by the NOT NULL constraint (23502)",
          tier: "SCHEMA",
        },
      ],
    },
    {
      id: "INV-S5",
      machine: "S",
      docLine: 46,
      statement: "The teacher must be a certified Sheikh (teacher.is_approved = true) at the time of session creation.",
      enforcementTier: "SVC · REPO",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/classes/session-lifecycle.service.test.ts",
          testName:
            "teacher-lock certification branches: an unapproved teacher AND a null-flag teacher are both TEACHER_NOT_CERTIFIED",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-S6",
      machine: "S",
      docLine: 47,
      statement: "While a session is in started state, the teacher's is_online must be false (in-session lock).",
      enforcementTier: "SVC · REPO · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/classes/session-lifecycle.service.test.ts",
          testName: "SessionLifecycleService — INV-S6 in-session lock (runInRollback)",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-S7",
      machine: "S",
      docLine: 48,
      statement: "A session report (reports) can only be submitted for a session that has reached completed state.",
      enforcementTier: "SVC",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/classes/session-report.service.test.ts",
          testName:
            "wrong status for each of scheduled/started/cancelled/disputed ⇒ SESSION_INVALID_TRANSITION; zero rows",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-S8",
      machine: "S",
      docLine: 49,
      statement:
        "Homework (home_work) is linked to a session and can only be created when the session report is submitted.",
      enforcementTier: "SVC · SCHEMA",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      notes: "The static sessionId.notNull pin is the single home bound by both INV-S8 and INV-HW1.",
      bindings: [
        {
          testPath: "backend/db/schema/classes/report-homework-schema.static-assertions.test.ts",
          testName: "INV-S8: homeWork.sessionId.notNull === true and reports.sessionId.notNull === true (schema pins)",
          tier: "STATIC",
        },
        {
          testPath: "backend/services/classes/session-report.service.test.ts",
          testName:
            "INV-S8: HomeWorkRepository.insertHomeWork has exactly ONE production call site (inside the report transaction)",
          tier: "SVC",
        },
        {
          testPath: "backend/db/test/logic/invariants/session-invariants.test.ts",
          testName: "INV-S8: every home_work row implies a matching reports row (LEFT JOIN zero probe)",
          tier: "DB",
        },
      ],
    },
  ],

  TV: [
    {
      id: "INV-TV1",
      machine: "TV",
      docLine: 87,
      statement:
        "An applicant cannot be certified without either (a) 5 evaluation sessions with 5 distinct certified Shuyukh and passing, or (b) direct admin onboarding (cold-start).",
      enforcementTier: "SVC · REPO · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/teachers/evaluation-rubric.service.test.ts",
          testName: "below-quorum submission: commits alone, the read-model is sealed",
          tier: "SVC",
        },
        {
          testPath: "backend/services/teachers/evaluation-rubric.service.test.ts",
          testName: "five 80s PASS: the teacher row is minted certified",
          tier: "SVC",
        },
        {
          testPath: "backend/services/teachers/evaluation-rubric.service.test.ts",
          testName: "FAIL finalization: the guarded transition stamps the tajweed cooldown exactly",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-TV2",
      machine: "TV",
      docLine: 88,
      statement: "The 5 evaluation sessions must be with 5 distinct certified Shuyukh (no evaluator twice).",
      enforcementTier: "SVC · REPO · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      notes: "Distinct-evaluator memory is per-cycle: a fresh activation re-admits previously used evaluators.",
      bindings: [
        {
          testPath: "backend/services/teachers/evaluation-booking.service.test.ts",
          testName: "distinctness — the same evaluator cannot be booked twice in one cycle",
          tier: "SVC",
        },
        {
          testPath: "backend/db/test/repo/teachers/evaluation.repository.test.ts",
          testName:
            "a duplicate (session, evaluator) insert raises the RAW 23505 on evaluations_session_evaluator_unique",
          tier: "SCHEMA",
        },
      ],
    },
    {
      id: "INV-TV3",
      machine: "TV",
      docLine: 89,
      statement: "A cooldown period must fully expire before an applicant can re-purchase the verification plan.",
      enforcementTier: "SVC",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/teachers/applicant-lifecycle.service.test.ts",
          testName: "ALLOWS when cooldown expires EXACTLY now (strict > comparator)",
          tier: "SVC",
        },
        {
          testPath: "backend/services/teachers/verification-purchase.service.test.ts",
          testName: "cooldown-active applicant → localized cooldown denial — zero writes",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-TV4",
      machine: "TV",
      docLine: 90,
      statement: "Tajweed cooldown = 1 month (30 days); Hifz cooldown = 3 months (90 days). These are minimums.",
      enforcementTier: "SVC · REPO · JRN",
      verdict: "COVERED",
      disposition: "EXTEND",
      docDrift:
        "Cooldown state lives on applicants.cooldown_until (backend/db/schema/teachers/applicants.ts:23), never on students.suspended_period_days as the doc's §2.1 state table claims; durations are pinned as day-count constants (shared/constants/evaluation-rubric.constants.ts:21,:24).",
      bindings: [
        {
          testPath: "shared/constants/evaluation-rubric.constants.test.ts",
          testName: "INV-TV4: TAJWEED_COOLDOWN_DAYS === 30 and HIFZ_COOLDOWN_DAYS === 90 (literal-type tripwire)",
          tier: "STATIC",
        },
      ],
    },
    {
      id: "INV-TV5",
      machine: "TV",
      docLine: 91,
      statement:
        "The Admin override can supersede the automated aggregation result in any direction (certify, reject, or grant re-evaluation).",
      enforcementTier: "SVC · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/teachers/applicant-lifecycle.service.test.ts",
          testName: "certify a FAILED applicant inserts the teacher row certified",
          tier: "SVC",
        },
        {
          testPath: "backend/services/teachers/applicant-lifecycle.service.test.ts",
          testName: "a NON-ADMIN actor is denied by the service-side admin gate with zero writes and zero audit rows",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-TV6",
      machine: "TV",
      docLine: 92,
      statement:
        "A failed applicant who is converted to a student retains student privileges (can subscribe to plans and attend sessions) during the cooldown period.",
      enforcementTier: "SVC · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "test/workflows/teachers/applicant-student-conversion.journey.test.ts",
          testName:
            "step 9 — journey 2: the converted actor purchases a STUDENT plan during the cooldown and books a real session against the credited lane",
          tier: "JRN",
        },
      ],
    },
    {
      id: "INV-TV7",
      machine: "TV",
      docLine: 93,
      statement: "teacher_verification record stores tajweed_level and hifz_level assessments for the applicant.",
      enforcementTier: "SCHEMA only — no producer",
      verdict: "GAP",
      disposition: "NEW-PROBE",
      docDrift:
        "No runtime writer exists — nothing writes or reads teacher_verification; weakness levels actually live in evaluations.weakness_area (backend/db/schema/teachers/evaluations.ts:50). A rubric-write assertion is forbidden; the schema contract is the only honest coverage.",
      ledgerRef: "D-401",
      bindings: [
        {
          testPath: "backend/db/test/repo/teachers/teacher-verification.repository.test.ts",
          testName:
            "INV-TV7 schema contract: tajweed_level and hifz_level are nullable varchar(50) columns with the teacher FK and index",
          tier: "SCHEMA",
        },
        {
          testPath: "backend/db/test/repo/teachers/teacher-verification.repository.test.ts",
          testName: "INV-TV7: a round-trip insert inside runInRollback reads back verbatim",
          tier: "SCHEMA",
        },
      ],
    },
  ],

  A: [
    {
      id: "INV-A1",
      machine: "A",
      docLine: 120,
      statement: "Only certified teachers (is_approved = true) can set their status to Available.",
      enforcementTier: "SVC · REPO · JRN · wire",
      verdict: "COVERED",
      disposition: "EXTEND",
      bindings: [
        {
          testPath: "backend/services/teachers/teacher-availability.service.test.ts",
          testName:
            "INV-A1: a toggle-vs-demoteToUncertified interleave under lockForCertificationCheck ends internally consistent in both orderings (no uncertified-online bypass)",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-A2",
      machine: "A",
      docLine: 121,
      statement: "While a teacher is in an active session (session.status = started), their is_online must be false.",
      enforcementTier: "SVC · REPO · JRN · wire",
      verdict: "COVERED",
      disposition: "EXTEND",
      bindings: [
        {
          testPath: "backend/db/test/repo/teachers/teacher.repository.test.ts",
          testName: "INV-A2 — no writer can produce is_online=true while a started session exists",
          tier: "REPO",
        },
      ],
    },
    {
      id: "INV-A3",
      machine: "A",
      docLine: 122,
      statement:
        "A teacher in In-Session state is hidden from the Available Teachers directory for all other students.",
      enforcementTier: "REPO compose-rule · JRN",
      verdict: "COVERED",
      disposition: "NEW-PROBE",
      docDrift:
        'A student-facing directory EXISTS — browseAvailableTeachers (backend/graphql/query/teachers/teacher-matching.query.ts:81, student-only scopes :123-128); the doc\'s "remains owned by the directory/alternatives surfaces" claim at :127 is stale.',
      bindings: [
        {
          testPath: "backend/graphql/test/teacher-matching.integration.test.ts",
          testName: "INV-A3: a student caller does not see an in-session teacher in the browseAvailableTeachers page",
          tier: "SDL",
        },
        {
          testPath: "backend/graphql/test/teacher-matching.integration.test.ts",
          testName: "INV-A3: anonymous/teacher/staff roles are denied at the scope step",
          tier: "SDL",
        },
      ],
    },
    {
      id: "INV-A4",
      machine: "A",
      docLine: 123,
      statement:
        "Upon session conclusion, the teacher's status returns to Available only if they are still active (app open).",
      enforcementTier: "REPO marker · JRN",
      verdict: "COVERED",
      disposition: "EXTEND",
      docDrift:
        'The shipped restore is marker-gated (teacher.was_online_before_lock restores the pre-lock availability intent), not activity-conditioned; the "still active" freshness leg is delegated to the inactivity sweep (backend/db/repo/teachers/teacher.repository.ts:774-814, which writes only false).',
      bindings: [
        {
          testPath: "test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts",
          testName:
            "INV-A4: a marker=true restore returns Available; the next sweep re-offlines the gone-stale teacher (never an activity-conditioned restore)",
          tier: "JRN",
        },
      ],
    },
  ],

  B: [
    {
      id: "INV-B1",
      machine: "B",
      docLine: 152,
      statement:
        "Session balances (balance_hifz, balance_tajweed, balance_reviews, balance_trial) are non-negative integers (default 0).",
      enforcementTier: "DB CHECK",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/db/repo/students/__tests__/student-grant-free-trial-once.test.ts",
          testName:
            "direct raw UPDATE with balance_trial = -1 is rejected by the students_balance_trial_check CHECK constraint",
          tier: "DB CHECK",
        },
        {
          testPath: "backend/db/repo/students/__tests__/student-lane-debit.test.ts",
          testName: "direct negative paid-lane balances are rejected by the DB CHECK constraints (backstop)",
          tier: "DB CHECK",
        },
      ],
    },
    {
      id: "INV-B2",
      machine: "B",
      docLine: 153,
      statement:
        "The full session count from a plan is credited to the respective balance immediately upon subscription activation.",
      enforcementTier: "SVC · REPO",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/billing/subscription-activation.service.test.ts",
          testName: "the exact balance delta equals the plan's sessionCount — one lane, siblings untouched",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-B3",
      machine: "B",
      docLine: 154,
      statement:
        "Unused sessions expire at the end of the interval_days window with no carryover; the trial lane is exempt.",
      enforcementTier: "SVC · REPO · JRN · cron",
      verdict: "COVERED",
      disposition: "EXTEND",
      notes:
        "Exact-count assertions scope the shared-database sweep to fixture users via the scopeSweepToUsers spyOn seam.",
      bindings: [
        {
          testPath: "backend/services/billing/subscription-expiry.service.test.ts",
          testName:
            "INV-B3: a cancel-preserved lane may be zeroed by a later covering sweep (cancelled is NON-covering)",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-B4",
      machine: "B",
      docLine: 155,
      statement:
        "A student cannot request a session if the relevant balance is 0 (or expired); the trial lane extends eligibility.",
      enforcementTier: "SVC · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/classes/session-lifecycle.booking.test.ts",
          testName: "never-subscribed empty lane: INSUFFICIENT_BALANCE regression intact",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-B5",
      machine: "B",
      docLine: 156,
      statement:
        "Session balances are segregated: Hifz decrements balance_hifz, Tajweed decrements balance_tajweed, review sessions decrement balance_reviews; the trial lane never co-mingles into a paid lane.",
      enforcementTier: "REPO frozen map",
      verdict: "PARTIAL",
      disposition: "PIN-APP-LAYER+DOC-DRIFT",
      docDrift:
        "The doc's reviews-decrement clause has no surface: HeldBalanceLane has no Reviews member (backend/enum/scheduling/held-balance-lane.enum.ts:17-21) and zero decrement writers exist for balance_reviews — the reviews lane is credit-only. The implemented segregation (trial/hifz/tajweed) is pinned; a runtime reviews-booking test is unwritable.",
      ledgerRef: "D-406",
      bindings: [
        {
          testPath: "backend/db/repo/students/__tests__/student-lane-debit.test.ts",
          testName: "lane → column resolution is pinned to enum-member map keys (no caller strings)",
          tier: "REPO",
        },
      ],
    },
    {
      id: "INV-B6",
      machine: "B",
      docLine: 157,
      statement: "The Admin can manually extend subscription validity windows (end_date).",
      enforcementTier: "SVC · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/billing/subscription-admin.service.test.ts",
          testName: "extends an active subscription: exact window shift + exactly one Update audit row",
          tier: "SVC",
        },
        {
          testPath: "test/workflows/billing/subscription-admin-lifecycle.journey.test.ts",
          testName: "step 2 — admin: extend S +30d → end_date += 30d exactly; one Update audit row",
          tier: "JRN",
        },
      ],
    },
    {
      id: "INV-B7",
      machine: "B",
      docLine: 158,
      statement: "A trial credit is granted at most once per student record (trial_granted_at IS NULL arbiter).",
      enforcementTier: "REPO · SVC",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/db/repo/students/__tests__/student-grant-free-trial-once.test.ts",
          testName: "second call on the same student returns false and leaves balance + marker unchanged",
          tier: "REPO",
        },
      ],
    },
    {
      id: "INV-B8",
      machine: "B",
      docLine: 159,
      statement: "Session allowance consumption decrements balance_trial BEFORE any paid intent lane.",
      enforcementTier: "SVC · JRN",
      verdict: "COVERED",
      disposition: "EXTEND",
      bindings: [
        {
          testPath: "backend/services/classes/session-lifecycle.booking.test.ts",
          testName:
            "INV-B8: with both lanes positive the trial is decremented first (heldBalanceLane === Trial, paid lane byte-identical)",
          tier: "SVC",
        },
      ],
    },
  ],

  W: [
    {
      id: "INV-W1",
      machine: "W",
      docLine: 213,
      statement: "wallet.balance must be >= 0 (check constraint).",
      enforcementTier: "DB CHECK · REPO",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      notes: "Sibling-owned suite (financial-safety-verification) — bound by reference, never re-authored.",
      bindings: [
        {
          testPath: "backend/db/test/repo/billing/wallet.repository.test.ts",
          testName:
            "direct negative writes at the DB tier are rejected by the named wallet and ledger CHECK constraints",
          tier: "DB CHECK",
        },
      ],
    },
    {
      id: "INV-W2",
      machine: "W",
      docLine: 214,
      statement: "wallet.total_earning must be >= 0 (check constraint).",
      enforcementTier: "DB CHECK",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      notes: "Sibling-owned suite (financial-safety-verification) — bound by reference, never re-authored.",
      bindings: [
        {
          testPath: "backend/db/test/repo/billing/wallet.repository.test.ts",
          testName:
            "direct negative writes at the DB tier are rejected by the named wallet and ledger CHECK constraints",
          tier: "DB CHECK",
        },
      ],
    },
    {
      id: "INV-W3",
      machine: "W",
      docLine: 215,
      statement: "Each teacher has exactly one wallet (teacher_id is unique on wallet).",
      enforcementTier: "DB UNIQUE · REPO",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      bindings: [
        {
          testPath: "backend/db/test/repo/billing/wallet.repository.test.ts",
          testName: "INV-W3: a raw second wallet INSERT bypassing ON CONFLICT raises 23505 on wallet_teacher_id_unique",
          tier: "DB UNIQUE",
        },
      ],
    },
    {
      id: "INV-W4",
      machine: "W",
      docLine: 216,
      statement: "An earning transaction is created only upon dual confirmation of session completion.",
      enforcementTier: "SVC · JRN",
      verdict: "COVERED",
      disposition: "EXTEND",
      bindings: [
        {
          testPath: "backend/services/classes/session-lifecycle.service.test.ts",
          testName:
            "INV-W4: arbitration-Complete — the wallet is never ensured and confirmedByStudentAt is null (no credit without student confirm)",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-W5",
      machine: "W",
      docLine: 217,
      statement:
        "A withdrawal starts as pending and settles to completed (admin approve) or failed (admin reject) — guarded settlement plus the amended prevent_teacher_transaction_update trigger.",
      enforcementTier: "REPO · SVC · TRIGGER · JRN",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      bindings: [
        {
          testPath: "backend/db/test/logic/billing/financial-immutability.test.ts",
          testName: "INV-W5: a pending→pending no-op rewrite raises (settlement is the only permitted update)",
          tier: "TRIGGER",
        },
        {
          testPath: "backend/db/test/logic/billing/financial-immutability.test.ts",
          testName: "INV-W5: re-opening a decided withdrawal (completed→failed) raises",
          tier: "TRIGGER",
        },
        {
          testPath: "backend/db/test/logic/billing/financial-immutability.test.ts",
          testName: "INV-W5: a description rewrite on a pending withdrawal raises (column freeze)",
          tier: "TRIGGER",
        },
        {
          testPath: "backend/db/test/logic/billing/financial-immutability.test.ts",
          testName: "INV-W5: a session_id NULL-swap on a pending withdrawal raises (IS NOT DISTINCT FROM arm)",
          tier: "TRIGGER",
        },
      ],
    },
    {
      id: "INV-W6",
      machine: "W",
      docLine: 218,
      statement:
        "Financial records (student_payments, teacher_transaction) are immutable once created. Corrections via new adjustment transactions only.",
      enforcementTier: "TRIGGER · REPO · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      notes: "Sibling-owned suite (financial-safety-verification) — bound by reference, never re-authored.",
      bindings: [
        {
          testPath: "backend/db/test/logic/billing/financial-immutability.test.ts",
          testName: "direct UPDATE on a teacher_transaction row is rejected and the row stays unchanged",
          tier: "TRIGGER",
        },
      ],
    },
    {
      id: "INV-W7",
      machine: "W",
      docLine: 219,
      statement:
        "An earning transaction is linked to a session_id; a withdrawal or bonus transaction may have a null session_id.",
      enforcementTier: "REPO signature (no DB CHECK)",
      verdict: "PARTIAL",
      disposition: "PIN-APP-LAYER+DOC-DRIFT",
      docDrift:
        "No DB CHECK ties earning rows to a session link — backend/db/schema/billing/teacher-transaction.ts:38 is a plain nullable FK; enforcement is the creditEarningOnce repo signature (backend/db/repo/billing/wallet.repository.ts:81) plus the dual-confirmation composition. A DB-tier earning-without-session probe would pass today and is forbidden.",
      ledgerRef: "D-402",
      bindings: [
        {
          testPath: "backend/db/test/repo/billing/wallet.repository.test.ts",
          testName: "INV-W7: creditEarningOnce ledger rows carry the fixture sessionId (signature-level enforcement)",
          tier: "REPO",
        },
      ],
    },
    {
      id: "INV-W8",
      machine: "W",
      docLine: 220,
      statement: "teacher_transaction.amount must be >= 0 (check constraint).",
      enforcementTier: "DB CHECK (> 0 shipped)",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      docDrift:
        'The shipped CHECK is amount > 0 (backend/db/schema/billing/teacher-transaction.ts:50), stricter than the doc\'s >= 0 — a zero-amount row is rejected; the doc is annotated, never "fixed".',
      bindings: [
        {
          testPath: "backend/db/test/repo/billing/wallet.repository.test.ts",
          testName:
            "direct negative writes at the DB tier are rejected by the named wallet and ledger CHECK constraints",
          tier: "DB CHECK",
        },
        {
          testPath: "backend/db/test/repo/billing/wallet.repository.test.ts",
          testName: "zero and maximal decimal(10,2) amounts behave as plain bound strings",
          tier: "DB CHECK",
        },
      ],
    },
  ],

  U: [
    {
      id: "INV-U1",
      machine: "U",
      docLine: 253,
      statement: "A soft-deleted student's historical sessions, reports, and financial transactions are preserved.",
      enforcementTier: "REPO guarded-UPDATE · FK",
      verdict: "GAP",
      disposition: "NEW-PROBE",
      bindings: [
        {
          testPath: "backend/db/test/logic/students/student_status_history.test.ts",
          testName:
            "INV-U1: session/reports/student_payments rows are byte-identical across the full suspend→block→soft-delete→reactivate ladder",
          tier: "REPO",
        },
        {
          testPath: "backend/db/test/logic/students/student_status_history.test.ts",
          testName: "INV-U1: login is denied while deleted; reactivation keeps history intact",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-U2",
      machine: "U",
      docLine: 254,
      statement: "A suspended student cannot request new sessions during the suspension period.",
      enforcementTier: "SVC",
      verdict: "COVERED",
      disposition: "EXTEND",
      docDrift:
        "The booking guard denies on the raw suspended boolean (backend/services/classes/session-lifecycle.governance.ts:53) — a LAPSED suspension still blocks booking, deliberately stricter than the login window predicate (login-lapse ALLOWED is pinned in backend/services/admin/user-governance.service.test.ts:1357).",
      bindings: [
        {
          testPath: "backend/services/classes/session-lifecycle.service.test.ts",
          testName:
            "INV-U2: a LAPSED suspension still denies booking FORBIDDEN (raw-boolean guard, stricter than the login window)",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-U3",
      machine: "U",
      docLine: 255,
      statement: "A blocked student cannot access the platform.",
      enforcementTier: "SVC (login/refresh/SSR)",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      notes:
        "Refresh-token arms run on committed-credential fixtures with deleteUsersByIds teardown — refreshToken opens its own transaction, so runInRollback is not used.",
      bindings: [
        {
          testPath: "backend/db/test/logic/auth/auth.service.test.ts",
          testName:
            "INV-U3: refreshToken denies a still-valid pre-block token with ForbiddenError(accountBlocked), plus deleted and active-suspension arms",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-U4",
      machine: "U",
      docLine: 256,
      statement: "No user, student, or teacher record can be hard-deleted.",
      enforcementTier: "STATIC grep-lock · DB trigger · FK",
      verdict: "COVERED",
      disposition: "PIN-APP-LAYER+DOC-DRIFT",
      docDrift:
        "The GUC-gated prevent_users_delete DB trigger exists (backend/db/migration/14-prevent-users-delete.sql; armed in production, pooled test connections pin the users_delete_guard=off opt-out) as the DB-tier backstop ahead of the FK ON DELETE RESTRICT chain; the grep-lock remains the app-layer enforcement; an unreferenced-user raw DELETE succeeds only under the trigger's test opt-out (documented accepted boundary behind the armed production guard).",
      ledgerRef: "D-404",
      bindings: [
        {
          testPath: "backend/graphql/test/inv-u4-grep-lock.test.ts",
          testName:
            "scans backend/db/repo + backend/services for .delete() targeting protected entities — ZERO findings",
          tier: "STATIC",
        },
        {
          testPath: "backend/db/test/logic/shared/data-integrity.probe.test.ts",
          testName: "the guard trigger is installed on users as an enabled row-level BEFORE DELETE trigger",
          tier: "DB",
        },
        {
          testPath: "backend/db/test/logic/students/student_status_history.test.ts",
          testName:
            "INV-U4 backstop: a referenced-user raw DELETE raises the restrict FK violation in a savepoint (SQLSTATE 23001 on PG≥18, 23503 on PG≤17); an unreferenced-user DELETE succeeds then rolls back",
          tier: "FK",
        },
      ],
    },
    {
      id: "INV-U5",
      machine: "U",
      docLine: 257,
      statement: "A student's session balances are preserved across suspension/blocking/soft-delete.",
      enforcementTier: "REPO (SET clauses exclude lanes)",
      verdict: "PARTIAL",
      disposition: "NEW-PROBE",
      bindings: [
        {
          testPath: "backend/db/test/logic/students/student_status_transition.test.ts",
          testName:
            "INV-U5: the target's own four balance lanes and trialGrantedAt are byte-identical across every governance transition",
          tier: "REPO",
        },
      ],
    },
  ],

  P: [
    {
      id: "INV-P1",
      machine: "P",
      docLine: 276,
      statement: "A parent cannot monitor a student without the student's explicit confirmation of the link request.",
      enforcementTier: "REPO · SVC · JRN · chaos",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      notes:
        "Five-layer evidence exists (static corpus, guarded link, one-winner race, denial oracle, wire); the single-writer corpus is the load-bearing binding.",
      bindings: [
        {
          testPath: "backend/services/parents/parent-link.static-locks.test.ts",
          testName: "lock (a) — students.parent_id single-writer (INV-P1)",
          tier: "REPO",
        },
      ],
    },
    {
      id: "INV-P2",
      machine: "P",
      docLine: 277,
      statement: "In the MVP, parent access is strictly read-only.",
      enforcementTier: "SDL · SVC · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/graphql/test/schema-surface.test.ts",
          testName: "mutation set grows ONLY by the sanctioned additions",
          tier: "SDL",
        },
      ],
    },
    {
      id: "INV-P3",
      machine: "P",
      docLine: 278,
      statement: "A parent receives real-time notification when a linked child's session completes.",
      enforcementTier: "SVC · JRN",
      verdict: "COVERED",
      disposition: "EXTEND",
      notes:
        "The producer is report submission (backend/services/classes/session-report.service.ts:306), not the completed flip.",
      bindings: [
        {
          testPath: "test/workflows/parents/parent-session-completion-deep-link.journey.test.ts",
          testName:
            "INV-P3: a linked child with a completed-but-unreported session ⇒ zero parent notification rows and zero spied publishes",
          tier: "JRN",
        },
      ],
    },
    {
      id: "INV-P4",
      machine: "P",
      docLine: 279,
      statement: "Parent-child link data model: students.parent_id FK and students.handshake_code.",
      enforcementTier: "SCHEMA · REPO",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      docDrift:
        "The monitoring portal exposes SEVEN SDL query fields (backend/graphql/test/schema-surface.test.ts:709-717); docs/parents/monitoring-portal.md:248/:250/:268 still say five.",
      bindings: [
        {
          testPath: "backend/db/test/logic/students/handshake-code-generation-locks.test.ts",
          testName:
            "50 consecutive student registrations: every code non-null, pattern-exact, mutually unique, with exact row defaults",
          tier: "SCHEMA",
        },
      ],
    },
  ],

  PAY: [
    {
      id: "INV-PAY1",
      machine: "PAY",
      docLine: 304,
      statement: "student_payments.amount must be >= 0 (check constraint).",
      enforcementTier: "DB CHECK (> 0 shipped)",
      verdict: "GAP",
      disposition: "EXTEND",
      docDrift:
        "The shipped CHECK is amount > 0 (backend/db/schema/billing/student-payments.ts:74), stricter than the doc's >= 0 — a 0.00 insert MUST be asserted to reject. No UPDATE-leg probe: the immutability trigger raises first.",
      bindings: [
        {
          testPath: "backend/db/test/logic/billing/student-payment.repository.test.ts",
          testName: "INV-PAY1: -1.00 and 0.00 inserts are both rejected by student_payments_amount_check (23514)",
          tier: "DB CHECK",
        },
      ],
    },
    {
      id: "INV-PAY2",
      machine: "PAY",
      docLine: 305,
      statement:
        "Payment records are immutable (guarded pending→paid/failed transition is the single permitted exception).",
      enforcementTier: "TRIGGER",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/db/test/logic/billing/student-payment.repository.test.ts",
          testName: "pending→paid: markPaidOnce flips only the status and freezes every financial column",
          tier: "TRIGGER",
        },
        {
          testPath: "backend/db/test/logic/billing/student-payment.repository.test.ts",
          testName: "DELETE: the append-only ledger cannot be deleted — the delete guard raises",
          tier: "TRIGGER",
        },
      ],
    },
    {
      id: "INV-PAY3",
      machine: "PAY",
      docLine: 306,
      statement: "A subscription is activated (and session balance credited) only upon paid status.",
      enforcementTier: "SVC",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/billing/subscription-activation.service.test.ts",
          testName:
            "failed delivery: payment decided failed, failure notification persisted + published, subscription untouched, no credit",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-PAY4",
      machine: "PAY",
      docLine: 307,
      statement: "student_payments records a payment_gateway (NOT NULL pgEnum).",
      enforcementTier: "SCHEMA pgEnum",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      docDrift:
        "The payment_gateway pgEnum carries 9 shipped values (backend/db/schema/enums.ts:67-77: stripe, paypal, paymob, fawry, offline_cash, bank_transfer, scholarship, other, mock); the doc lists 5.",
      bindings: [
        {
          testPath: "backend/db/test/logic/billing/student-payment.repository.test.ts",
          testName:
            "INV-PAY4: a bogus gateway raises 22P02, a NULL gateway raises 23502, and enum_range equals the 9 shipped values",
          tier: "SCHEMA pgEnum",
        },
      ],
    },
    {
      id: "INV-PAY5",
      machine: "PAY",
      docLine: 308,
      statement:
        "Admin direct onboarding with offline payment (cash/transfer/scholarship) bypasses student_payments; the audit trail lives on the subscriptions payment columns.",
      enforcementTier: "SVC",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/admin/student-onboarding.service.test.ts",
          testName:
            "offline cash onboards an unlinked student: full five-table write set, two audit rows, zero ledger movement",
          tier: "SVC",
        },
        {
          testPath: "backend/services/admin/student-onboarding.service.test.ts",
          testName: "a gateway payment method is rejected with the offline-whitelist copy",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-PAY6",
      machine: "PAY",
      docLine: 309,
      statement:
        "Exactly one pending → paid activation ever executes per subscription (guarded single-statement UPDATE arbiter).",
      enforcementTier: "REPO · SVC · JRN · route",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/db/test/logic/billing/student-payment.repository.test.ts",
          testName: "pending→paid: markPaidOnce flips only the status and freezes every financial column",
          tier: "REPO",
        },
        {
          testPath: "backend/services/billing/subscription-activation.service.test.ts",
          testName: "late confirmed after failed → rejected & logged (replay-incompatible), zero mutation",
          tier: "SVC",
        },
        {
          testPath: "backend/services/billing/subscription-activation.service.test.ts",
          testName: "zero-credit replay proof: balance and decided rows are byte-identical across a duplicate delivery",
          tier: "SVC",
        },
        {
          testPath: "app/api/payments/webhook/test/payments-webhook-route.test.ts",
          testName:
            "an N=6 retrial-shaped burst of the SAME signed callback → every delivery 200, exactly ONE settlement ack, the rest replay acks",
          tier: "route",
        },
      ],
    },
    {
      id: "INV-PAY7",
      machine: "PAY",
      docLine: 310,
      statement:
        "A verified callback whose amount or currency disagrees with the stored ledger row is quarantined: zero mutation, one bounded log, 200 processed:false ack.",
      enforcementTier: "SVC · route · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/billing/subscription-activation.service.test.ts",
          testName: "currency mismatch quarantines: zero mutation, error logged with correlation ids only",
          tier: "SVC",
        },
        {
          testPath: "app/api/payments/webhook/test/payments-webhook-route.test.ts",
          testName: "unknown reference / quarantine ack posture → 200 { data: { processed: false } }",
          tier: "route",
        },
      ],
    },
  ],

  HW: [
    {
      id: "INV-HW1",
      machine: "HW",
      docLine: 319,
      statement: "Homework (home_work) is linked to exactly one session_id (NOT NULL).",
      enforcementTier: "SCHEMA",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      notes: "The static sessionId.notNull pin is the single home bound by both INV-S8 and INV-HW1.",
      bindings: [
        {
          testPath: "backend/db/test/repo/classes/home-work.repository.test.ts",
          testName:
            "INV-HW1: a NULL session_id raises 23502; an orphan session_id raises 23503 on home_work_session_id_session_id_fkey; a session-row delete cascades the homework row",
          tier: "SCHEMA",
        },
        {
          testPath: "backend/db/schema/classes/report-homework-schema.static-assertions.test.ts",
          testName: "INV-S8: homeWork.sessionId.notNull === true and reports.sessionId.notNull === true (schema pins)",
          tier: "STATIC",
        },
      ],
    },
    {
      id: "INV-HW2",
      machine: "HW",
      docLine: 320,
      statement: "current_grade and revision_grade are 0-100 (check constraints).",
      enforcementTier: "DB CHECK · SVC guard",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      bindings: [
        {
          testPath: "backend/db/test/repo/classes/home-work.repository.test.ts",
          testName:
            "INV-HW2: gradeHomeWorkOnce (bypassing service validation) with 101/-1 raises 23514 on home_work_current_grade_check / home_work_revision_grade_check (row survives)",
          tier: "DB CHECK",
        },
      ],
    },
    {
      id: "INV-HW3",
      machine: "HW",
      docLine: 321,
      statement: "The first session has no prior homework to evaluate; homework is only assigned (not graded).",
      enforcementTier: "SVC composition",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/services/classes/session-report.service.test.ts",
          testName: "happy path WITH homework (jadid + madi) ⇒ assignment row mapped field-by-field",
          tier: "SVC",
        },
        {
          testPath: "backend/services/classes/session-report.service.test.ts",
          testName:
            "first session, previousGrades PRESENT with no ungraded target ⇒ silent no-op success (genuine first session)",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-HW4",
      machine: "HW",
      docLine: 322,
      statement: "Subsequent sessions grade the previous session's homework and assign new homework.",
      enforcementTier: "SVC · REPO · JRN",
      verdict: "COVERED",
      disposition: "EXTEND",
      bindings: [
        {
          testPath: "backend/services/classes/session-report.service.test.ts",
          testName:
            "INV-HW4: with two ungraded rows, previousGrades land on the NEWEST prior row only (the grading probe has no grade predicate)",
          tier: "SVC",
        },
      ],
    },
  ],

  PR: [
    {
      id: "INV-PR1",
      machine: "PR",
      docLine: 327,
      statement: "Progress (progress) links a student to a lesson (student_id, lesson_id).",
      enforcementTier: "SCHEMA",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      bindings: [
        {
          testPath: "backend/db/test/repo/classes/progress.repository.test.ts",
          testName:
            "INV-PR1: a NULL student_id raises 23502; orphan student/lesson ids raise 23503 on both named FKs; a legal lesson_id = NULL row persists (set-null artifact)",
          tier: "SCHEMA",
        },
      ],
    },
    {
      id: "INV-PR2",
      machine: "PR",
      docLine: 328,
      statement: "Progress is updated (incremented) upon successful completion of a Tajweed session.",
      enforcementTier: "SVC · JRN",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/db/test/logic/classes/student-progress.service.test.ts",
          testName: "first completed tajweed session inserts the pointer at the second lesson",
          tier: "SVC",
        },
        {
          testPath: "test/workflows/classes/tajweed-progress-increment.test.ts",
          testName:
            "step 4 — Student confirms S1: teacher wallet credited exactly the fee AND the pointer row commits in the SAME transaction pointing at lesson 2",
          tier: "JRN",
        },
      ],
    },
    {
      id: "INV-PR3",
      machine: "PR",
      docLine: 329,
      statement: "Lessons belong to plans (lessons.plan_id).",
      enforcementTier: "SVC gate (plan_id nullable by design)",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      docDrift:
        'lessons.plan_id is nullable BY DESIGN (backend/db/schema/classes/lessons.ts:21, ON DELETE SET NULL survival artifact); "belongs to plans" is enforced at the service write surface (backend/services/classes/lesson.service.ts:172-173), not by a DB NOT NULL — no NOT NULL probe exists.',
      bindings: [
        {
          testPath: "backend/db/test/logic/classes/lesson.service.test.ts",
          testName:
            "INV-PR3: a wire-shaped planId: null ⇒ LESSON_PLAN_NOT_FOUND (the only plan-membership write surface)",
          tier: "SVC",
        },
      ],
    },
  ],

  E: [
    {
      id: "INV-E1",
      machine: "E",
      docLine: 338,
      statement: "evaluations.score is 0-100 (check constraint).",
      enforcementTier: "DB CHECK · SVC guard",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      bindings: [
        {
          testPath: "backend/db/test/repo/teachers/evaluation.repository.test.ts",
          testName:
            "INV-E1: insertOnce with concrete 101/-1 raises raw 23514 on evaluations_score_check (savepoint; column nullable — concrete integers)",
          tier: "DB CHECK",
        },
        {
          testPath: "backend/db/schema/teachers/evaluations-schema.static-assertions.test.ts",
          testName:
            "INV-E1: the evaluations CHECK list is exactly [evaluations_score_check]; the is_deleted/deleted_at columns exist",
          tier: "STATIC",
        },
      ],
    },
    {
      id: "INV-E2",
      machine: "E",
      docLine: 339,
      statement: "Evaluations can be soft-deleted (is_deleted, deleted_at) but not hard-deleted.",
      enforcementTier: "REPO read-exclusion (no delete guard)",
      verdict: "PARTIAL",
      disposition: "PIN-APP-LAYER+DOC-DRIFT",
      docDrift:
        'No prevent_evaluations_delete trigger exists; the "not hard-deleted" half is enforced only by surface absence (test teardowns hard-delete successfully), so a raw DELETE-rejection test is forbidden — source pins are the honest coverage.',
      ledgerRef: "D-403",
      bindings: [
        {
          testPath: "backend/db/test/repo/teachers/evaluation.repository.test.ts",
          testName:
            "INV-E2: EvaluationRepository exposes no .delete( call and no delete/softDelete/update symbol (surface-absence source pins)",
          tier: "STATIC",
        },
      ],
    },
    {
      id: "INV-E3",
      machine: "E",
      docLine: 340,
      statement: "An evaluation is linked to a user_id (the evaluated user) and optionally a session_id.",
      enforcementTier: "SCHEMA",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      notes: "Actual columns are evaluated_id (cascade) and evaluator_id (restrict) — the doc says user_id.",
      bindings: [
        {
          testPath: "backend/db/test/repo/teachers/evaluation.repository.test.ts",
          testName: "INV-E3: an orphan evaluator id raises 23503 on evaluations_evaluator_id_users_id_fkey (savepoint)",
          tier: "SCHEMA",
        },
        {
          testPath: "backend/db/test/repo/teachers/evaluation.repository.test.ts",
          testName:
            "INV-E3: a session hard-deleted on a committed fixture ⇒ the evaluation survives with sessionId === null (set-null)",
          tier: "SCHEMA",
        },
      ],
    },
    {
      id: "INV-E4",
      machine: "E",
      docLine: 341,
      statement: "Teacher evaluations (submitted by students) update teacher.average_rating (0-5 scale).",
      enforcementTier: "SVC · REPO · JRN · wire",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/db/test/repo/teachers/teacher.repository.test.ts",
          testName: "a rating beyond the 0-5 clamp raises the RAW teacher_average_rating_check violation",
          tier: "REPO",
        },
      ],
    },
    {
      id: "INV-E5",
      machine: "E",
      docLine: 342,
      statement:
        "Student evaluations are aggregated from session reports and grades for cumulative performance metrics.",
      enforcementTier: "SVC (academic tracking)",
      verdict: "PARTIAL",
      disposition: "EXTEND",
      notes: "Maps to the academic-tracking surface, not the evaluations table.",
      bindings: [
        {
          testPath: "backend/services/admin/admin-academic-tracking.service.test.ts",
          testName:
            "INV-E5: one composite — homework grades (both tracks) + report history + progressRowCount + attention flag for one known student",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-E6",
      machine: "E",
      docLine: 343,
      statement: "Evaluation records are permanently retained for dispute resolution and teacher re-evaluations.",
      enforcementTier: "set-null design + U4 transitivity (no guard)",
      verdict: "GAP",
      disposition: "PIN-APP-LAYER+DOC-DRIFT",
      docDrift:
        "No retention guard exists; the testable core is the set-null survival pin (a session hard-delete leaves the evaluation row with sessionId null). Full retention would need a DELETE-guard migration.",
      ledgerRef: "D-403",
      bindings: [
        {
          testPath: "backend/db/test/repo/teachers/evaluation.repository.test.ts",
          testName:
            "INV-E3: a session hard-deleted on a committed fixture ⇒ the evaluation survives with sessionId === null (set-null)",
          tier: "SCHEMA",
        },
      ],
    },
  ],

  PC: [
    {
      id: "INV-PC1",
      machine: "PC",
      docLine: 358,
      statement:
        "A deactivated plan (is_active = false) never appears in the public catalog (planCatalog) and cannot be purchased.",
      enforcementTier: "REPO · SVC · SDL",
      verdict: "COVERED",
      disposition: "VERIFY-BY-REFERENCE",
      bindings: [
        {
          testPath: "backend/db/test/logic/billing/plan-catalog.repository.test.ts",
          testName: "findActiveById returns null for a deactivated plan and an unknown id (active-only predicate)",
          tier: "REPO",
        },
        {
          testPath: "backend/services/billing/subscription-purchase.service.test.ts",
          testName: "inactive plan and unknown plan both deny as not purchasable — zero writes",
          tier: "SVC",
        },
      ],
    },
    {
      id: "INV-PC2",
      machine: "PC",
      docLine: 359,
      statement:
        "Deactivation or forward-only plan edits never alter or invalidate existing subscriptions or credited balances.",
      enforcementTier: "SVC zero-coupling",
      verdict: "PARTIAL",
      disposition: "NEW-PROBE",
      bindings: [
        {
          testPath: "test/workflows/billing/plan-catalog-invariance.journey.test.ts",
          testName:
            "INV-PC2: purchase → admin deactivate + edit ⇒ subscription row and credited lane byte-identical; a subsequent booking on the credited lane succeeds",
          tier: "JRN",
        },
      ],
    },
    {
      id: "INV-PC3",
      machine: "PC",
      docLine: 360,
      statement:
        "Plan rows are never hard-deleted from PostgreSQL; deactivation flips is_active and sets deactivated_at.",
      enforcementTier: "SDL · writer-absence (no DB guard)",
      verdict: "PARTIAL",
      disposition: "PIN-APP-LAYER+DOC-DRIFT",
      docDrift:
        "No prevent_plans_delete trigger exists; PlanRepository exposes no delete method and an unreferenced-plan raw DELETE succeeds (documented accepted boundary — lessons.plan_id is set-null, backend/db/schema/classes/lessons.ts:21; only subscriptions_plan_id_fkey restricts).",
      ledgerRef: "D-405",
      bindings: [
        {
          testPath: "backend/db/test/logic/invariants/plan-catalog-invariants.test.ts",
          testName: "INV-PC3: PlanRepository exposes no delete method (writer-absence source pin)",
          tier: "SDL",
        },
        {
          testPath: "backend/db/test/logic/invariants/plan-catalog-invariants.test.ts",
          testName:
            "INV-PC3: a referenced-plan raw DELETE is rejected by the subscriptions_plan_id_plans_id_fkey restrict FK (SQLSTATE 23001 on PG≥18, 23503 on PG≤17); an unreferenced-plan DELETE succeeds then rolls back",
          tier: "SCHEMA",
        },
      ],
    },
  ],
};

/** Flat view of the census — exactly one row per documented invariant (67). */
export const CENSUS_ROWS: readonly InvariantCensusEntry[] = [
  ...INVARIANT_CENSUS.S,
  ...INVARIANT_CENSUS.TV,
  ...INVARIANT_CENSUS.A,
  ...INVARIANT_CENSUS.B,
  ...INVARIANT_CENSUS.W,
  ...INVARIANT_CENSUS.U,
  ...INVARIANT_CENSUS.P,
  ...INVARIANT_CENSUS.PAY,
  ...INVARIANT_CENSUS.HW,
  ...INVARIANT_CENSUS.PR,
  ...INVARIANT_CENSUS.E,
  ...INVARIANT_CENSUS.PC,
];
