/**
 * Cross-actor journey — parent handshake-code discovery.
 *
 * Executes the ordered cross-actor step list (steps 1→8) against REAL services
 * on the REAL test database: sequential, actor-attributed steps where one
 * actor's committed state change is observed by another actor. Cast actors:
 * Student (Yusuf) + three governance-variant students (Bilal, Mariam, Omar),
 * Parent (Fatima), Second Parent (Karim); the registration service plays the
 * System actor. Teacher/Admin/Supervisor/Anonymous actors are DENIED at the
 * GraphQL scope layer and are cross-referenced there, not re-tested here.
 *
 * TEST-FIRST (expected RED state): this file statically imports
 * `StudentHandshakeService`, which does not exist yet — the service surface
 * lands in the service task, which re-runs this journey to green. Until then
 * the ONLY failure is the missing service module; the harness (cast fixtures,
 * tracked teardown) is proven independently green by the smoke test in
 * `test/workflows/helpers/journey-fixtures.smoke.test.ts`.
 *
 * Service surface this journey expects (signatures fixed upstream of the
 * service task):
 *   StudentHandshakeService.getMyHandshakeCode(studentUserId: number, locale: string): Promise<string>
 *   StudentHandshakeService.findStudentByHandshakeCode(code: string, locale: string, tx?: DBTransaction):
 *     Promise<HandshakeCodeLookupReturnType | null>
 *
 * GraphQL tier cross-reference (role-matrix integration tests): the
 * `FORBIDDEN`/`UNAUTHORIZED` role-matrix denials for `myHandshakeCode` and
 * `findStudentByHandshakeCode` are asserted over HTTP by the GraphQL
 * integration tier; the journey layer calls services directly with
 * actor-derived ids and has no scope machinery by design.
 *
 * Notification boundary (AGENTS.md rule 5): the discovery flows emit NO
 * notifications (pure reads by contract) and no notification dispatch module
 * exists in the tree yet — there is no external channel to intercept. The
 * observable side-effect contract is asserted directly instead: zero
 * notification and audit rows attributable to any tracked actor (Step 8).
 * When a dispatch boundary lands, journeys whose steps emit notifications
 * MUST spy it — never real email/SMS/push.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { StudentRepository } from "@/backend/db/repo";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { StudentHandshakeService } from "@/backend/services/students/student-handshake.service";
import type { HandshakeCodeLookupReturnType } from "@/backend/types";
import { HANDSHAKE_CODE_PATTERN } from "@/shared/constants/handshake-code.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  catchJourneyError,
  createJourneyCast,
  type JourneyCastType,
  linkStudentToParentFixture,
  type ParentActorType,
  type StudentActorType,
  setGovernanceFixture,
} from "@/test/workflows/helpers";

const LOCALE = "en";

/** Translated error copy source — never hardcoded English expectation strings (AGENTS.md rule 6). */
const errorsTranslations = getServerTranslations(LOCALE).errorsTranslations;

/** One cast per suite: registrations commit; teardown hard-deletes every tracked id. */
const cast: JourneyCastType = createJourneyCast("handshake");

interface JourneyCastState {
  readonly yusuf: StudentActorType;
  readonly bilal: StudentActorType;
  readonly mariam: StudentActorType;
  readonly omar: StudentActorType;
  readonly fatima: ParentActorType;
  readonly karim: ParentActorType;
  /** Valid-format code derived to match NO students row — the nonexistent-code channel. */
  readonly absentProbeCode: string;
}

let state: JourneyCastState | null = null;

/** Step 3's committed observation — reused by steps 4 and 5. */
let unlinkedDiscoveryPayload: HandshakeCodeLookupReturnType | null = null;

function requireState(): JourneyCastState {
  if (state === null) {
    throw new Error("journey state missing: cast was not provisioned");
  }
  return state;
}

function requireUnlinkedPayload(): HandshakeCodeLookupReturnType {
  if (unlinkedDiscoveryPayload === null) {
    throw new Error("journey state missing: step 3 discovery payload");
  }
  return unlinkedDiscoveryPayload;
}

/** Locale-stable comparator for sorted key-set assertions. */
function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Derives a valid-format handshake code that differs from `existing` (nonexistent-code probe). */
function deriveAbsentHandshakeCode(existing: string): string {
  const lastChar = existing.slice(-1);
  const replacement = lastChar === "0" ? "1" : "0";
  return `${existing.slice(0, -1)}${replacement}`;
}

describe("Journey — parent handshake-code discovery (steps 1→8)", () => {
  beforeAll(async () => {
    // System actor provisions the full cast through the REAL registration
    // service — each registration is its own committed transaction.
    const yusuf = await cast.registerStudentActor("Yusuf Rahman");
    const bilal = await cast.registerStudentActor("Bilal Said");
    const mariam = await cast.registerStudentActor("Mariam Fouad");
    const omar = await cast.registerStudentActor("Omar Adel");
    const fatima = await cast.registerParentActor("Fatima Nour");
    const karim = await cast.registerParentActor("Karim Mansour");
    state = {
      yusuf,
      bilal,
      mariam,
      omar,
      fatima,
      karim,
      absentProbeCode: deriveAbsentHandshakeCode(yusuf.handshakeCode),
    };
  });

  test("Step 1 — System: registration generated canonical, unique, non-null handshake codes", () => {
    const s = requireState();
    const codes = [s.yusuf.handshakeCode, s.bilal.handshakeCode, s.mariam.handshakeCode, s.omar.handshakeCode];
    for (const code of codes) {
      // Canonical-format precondition: matching HANDSHAKE_CODE_PATTERN implies
      // non-null, non-empty, `KSB-` + exactly 8 uppercase hex characters.
      expect(code).toMatch(HANDSHAKE_CODE_PATTERN);
    }
    // Uniqueness across the whole cast (DB-level uniqueness is separately
    // locked by the constraint lock suite; the journey pins the generator).
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("Step 2 — Student (Yusuf): self-read returns own code verbatim; foreign ids never leak another student's code", async () => {
    const s = requireState();
    // Actor: Student (Yusuf). Identity is his own user id — in production the
    // resolver passes ctx.user.id (never a client argument).
    const ownCode = await StudentHandshakeService.getMyHandshakeCode(s.yusuf.userId, LOCALE);
    expect(ownCode).toBe(s.yusuf.handshakeCode);

    // Cross-fixture isolation: a second student's surface yields HIS code —
    // Yusuf's id can never surface Bilal's code.
    const bilalCode = await StudentHandshakeService.getMyHandshakeCode(s.bilal.userId, LOCALE);
    expect(bilalCode).toBe(s.bilal.handshakeCode);
    expect(bilalCode).not.toBe(ownCode);

    // Service-contract edge: a user with NO students row (the
    // parent) surfaces NotFoundError — STUDENT_NOT_FOUND, localized message.
    const parentEdge = await catchJourneyError(() =>
      StudentHandshakeService.getMyHandshakeCode(s.fatima.userId, LOCALE)
    );
    expect(parentEdge).toBeInstanceOf(NotFoundError);
    if (!(parentEdge instanceof NotFoundError)) {
      throw new Error("expected a NotFoundError from the parent-id edge");
    }
    expect(parentEdge.code).toBe("STUDENT_NOT_FOUND");
    expect(parentEdge.message).toContain(errorsTranslations.studentHandshakeNotFound);
  });

  // Step 2b — denial cross-reference (documented, NOT re-tested here):
  // Parent (Fatima) calling `myHandshakeCode` → FORBIDDEN; Anonymous →
  // UNAUTHORIZED. Both denials are owned by the GraphQL scope layer
  // (`$all: { authenticated: true, role: [UserRole.Student] }` authScopes)
  // and asserted by the GraphQL tier's role-matrix integration tests.

  test("Step 3 — Parent (Fatima): exact-code discovery returns the minimal two-key payload", async () => {
    const s = requireState();
    // Actor: Parent (Fatima) — not yet linked, holding Yusuf's real code.
    const result = await StudentHandshakeService.findStudentByHandshakeCode(s.yusuf.handshakeCode, LOCALE);
    if (result === null) {
      throw new Error("expected a discovery payload for Yusuf's real code");
    }
    unlinkedDiscoveryPayload = result;
    // Payload closure: EXACTLY two keys — maskedName + linkable, no ids.
    expect(Object.keys(result).toSorted(compareStrings)).toEqual(["linkable", "maskedName"]);
    // Masked identity — never the raw full name.
    expect(result.maskedName).not.toBe(s.yusuf.fullName);
    // Unlinked child resolves linkable: true.
    expect(result.linkable).toBe(true);
  });

  test("Step 4 — Parent (Fatima): lowercase resolves identically; garbage rejects pre-DB; valid-missing is null", async () => {
    const s = requireState();
    // A lowercase variant of the REAL code normalizes into the exact same
    // discovery outcome as Step 3.
    const lowered = await StudentHandshakeService.findStudentByHandshakeCode(
      s.yusuf.handshakeCode.toLowerCase(),
      LOCALE
    );
    expect(lowered).toEqual(requireUnlinkedPayload());

    // Fail-closed: structurally invalid inputs reject with
    // ValidationError (VALIDATION) and the localized invalid-format message —
    // BEFORE any DB read (asserted at the service tier by its own suite).
    const invalidProbes = ["KSB-", "KSB-TOOLLONG99", "%KSB-ABCD1234", "   ", "ksb-abcd123g"];
    const errors = await Promise.all(
      invalidProbes.map(probe =>
        catchJourneyError(() => StudentHandshakeService.findStudentByHandshakeCode(probe, LOCALE))
      )
    );
    for (const error of errors) {
      expect(error).toBeInstanceOf(ValidationError);
      if (!(error instanceof ValidationError)) {
        throw new Error("expected a ValidationError for a structurally invalid code");
      }
      expect(error.code).toBe("VALIDATION");
      expect(error.message).toContain(errorsTranslations.handshakeCodeInvalid);
    }

    // Valid-format-but-missing code → null, NOT an error. Harness
    // grounding first: the derived probe code matches no students row in this
    // database (guards against a freak collision with fixture or seed codes).
    expect(await StudentRepository.findDiscoveryByHandshakeCode(s.absentProbeCode)).toBeNull();
    const miss = await StudentHandshakeService.findStudentByHandshakeCode(s.absentProbeCode, LOCALE);
    expect(miss).toBeNull();
  });

  test("Step 5 — Second Parent (Karim): already-linked child resolves linkable:false with zero parent identity", async () => {
    const s = requireState();
    // Actor: System/linker fixture — the future link-request mutation
    // emulated by a committed direct write (production link flow does not
    // exist yet).
    const linkedParentId = await linkStudentToParentFixture(s.yusuf.userId, s.fatima.userId);
    expect(linkedParentId).toBe(s.fatima.userId);

    // Actor: Second Parent (Karim) — searches the SAME code after the link.
    const karimResult = await StudentHandshakeService.findStudentByHandshakeCode(s.yusuf.handshakeCode, LOCALE);
    if (karimResult === null) {
      throw new Error("expected the already-linked discovery payload");
    }
    expect(karimResult.linkable).toBe(false);
    // Zero incumbent-parent identity, zero ids, zero contact data — still
    // EXACTLY the two sanctioned keys.
    expect(Object.keys(karimResult).toSorted(compareStrings)).toEqual(["linkable", "maskedName"]);
    // Linking flips only the linkable signal; the mask is unchanged.
    expect(karimResult.maskedName).toBe(requireUnlinkedPayload().maskedName);

    // Actor: Parent (Fatima) — ANY searching parent observes the identical state.
    const fatimaResult = await StudentHandshakeService.findStudentByHandshakeCode(s.yusuf.handshakeCode, LOCALE);
    expect(fatimaResult).toEqual(karimResult);

    // Belt-and-braces: neither parent's identity nor any id survives serialization.
    const serialized = JSON.stringify(karimResult);
    expect(serialized).not.toContain(String(s.fatima.userId));
    expect(serialized).not.toContain(s.fatima.email);
    expect(serialized).not.toContain(String(s.karim.userId));
    expect(serialized).not.toContain(s.karim.email);
  });

  test("Step 6a — governance isDeleted collapses discovery to null, byte-identical to a nonexistent code", async () => {
    const s = requireState();
    // Ground: the SAME code is discoverable BEFORE the governance flip.
    const before = await StudentHandshakeService.findStudentByHandshakeCode(s.bilal.handshakeCode, LOCALE);
    if (before === null) {
      throw new Error("expected a discovery payload before the isDeleted flip");
    }
    expect(before.linkable).toBe(true);

    // Actor: Admin-domain fixture — the child user becomes soft-deleted.
    const governance = await setGovernanceFixture(s.bilal.userId, { isDeleted: true });
    expect(governance.isDeleted).toBe(true);

    // Actor: Parent (Fatima) re-searches the SAME code — governed children are
    // unfindable, indistinguishable from a code that never existed.
    const after = await StudentHandshakeService.findStudentByHandshakeCode(s.bilal.handshakeCode, LOCALE);
    expect(after).toBeNull();
    expect(after).toEqual(await StudentHandshakeService.findStudentByHandshakeCode(s.absentProbeCode, LOCALE));
  });

  test("Step 6b — governance isBlocked collapses discovery to null, byte-identical to a nonexistent code", async () => {
    const s = requireState();
    const before = await StudentHandshakeService.findStudentByHandshakeCode(s.mariam.handshakeCode, LOCALE);
    if (before === null) {
      throw new Error("expected a discovery payload before the isBlocked flip");
    }
    expect(before.linkable).toBe(true);

    // Actor: Admin-domain fixture — the child user becomes blocked.
    const governance = await setGovernanceFixture(s.mariam.userId, { isBlocked: true });
    expect(governance.isBlocked).toBe(true);

    // Actor: Parent (Fatima) re-searches the SAME code.
    const after = await StudentHandshakeService.findStudentByHandshakeCode(s.mariam.handshakeCode, LOCALE);
    expect(after).toBeNull();
    expect(after).toEqual(await StudentHandshakeService.findStudentByHandshakeCode(s.absentProbeCode, LOCALE));
  });

  test("Step 6c — active suspension collapses discovery to null, byte-identical to a nonexistent code", async () => {
    const s = requireState();
    const before = await StudentHandshakeService.findStudentByHandshakeCode(s.omar.handshakeCode, LOCALE);
    if (before === null) {
      throw new Error("expected a discovery payload before the suspension flip");
    }
    expect(before.linkable).toBe(true);

    // Actor: Admin-domain fixture — the child user enters an ACTIVE suspension
    // window (started an hour ago, runs for 30 days).
    const governance = await setGovernanceFixture(s.omar.userId, {
      suspended: true,
      suspendedAt: new Date(Date.now() - 60 * 60 * 1000),
      suspendedPeriodDays: 30,
    });
    expect(governance.suspended).toBe(true);

    // Actor: Parent (Fatima) re-searches the SAME code.
    const after = await StudentHandshakeService.findStudentByHandshakeCode(s.omar.handshakeCode, LOCALE);
    expect(after).toBeNull();
    expect(after).toEqual(await StudentHandshakeService.findStudentByHandshakeCode(s.absentProbeCode, LOCALE));
  });

  // Step 7 — record-only (NOT re-tested here): a deleted or blocked CALLER is
  // denied at the upstream context boundary — the fail-closed auth context
  // resolves no session for governed users, so the request never reaches a
  // resolver or service. That auth-context boundary is owned and verified by
  // the auth domain's own suites; the journey records the cross-reference
  // instead of duplicating it.

  afterAll(async () => {
    // Measure side-effects FIRST (the actor rows must still exist for the
    // attributable-row probes), but ASSERT only AFTER teardown: an assertion
    // throwing before `cast.teardown()` would skip the hard delete entirely
    // and leak every committed fixture row in the shared test DB.
    const sideEffects = await cast.countSideEffectRows();

    // Step 8 — teardown: every tracked fixture id hard-deleted in FK-safe
    // order; residue probes on every touched table return empty.
    await cast.teardown();
    const residue = await cast.residueCounts();

    // After registration, every journey step is a pure read — zero
    // notification and audit rows may be attributable to any tracked actor.
    expect(sideEffects.notifications).toBe(0);
    expect(sideEffects.auditLogs).toBe(0);
    expect(residue.users).toBe(0);
    expect(residue.students).toBe(0);
    expect(residue.parents).toBe(0);
    expect(residue.notifications).toBe(0);
    expect(residue.auditLogs).toBe(0);
  });
});
