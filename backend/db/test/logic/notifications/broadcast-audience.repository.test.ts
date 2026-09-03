/**
 * BroadcastAudienceRepository tests — the four cohort shapes (`all`, `role`,
 * `country`, `plan`) across BOTH execution branches of
 * `resolveAudienceIds`.
 *
 * Per `backend/db/test/AGENTS.md` + `backend/db/test/logic/AGENTS.md`:
 *  - Transactional-branch cases run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call and direct Drizzle query. Uncommitted fixtures are
 *    invisible to the pool connection, so a successful in-tx resolution is
 *    itself the tx-propagation proof (pinned explicitly below).
 *  - The raw-SQL branch (`queryDb` fast path, no tx) cannot see uncommitted
 *    rows, so it is exercised against COMMITTED fixtures created in
 *    `beforeAll` and hard-deleted in `afterAll` (Rule 9 — the sanctioned
 *    static-fixture path, mirroring the sibling `user.repository.test.ts`).
 *  - Fixtures are created ONLY via `entity-setup.ts` helpers (`createTestUser`,
 *    `createTestPlan` — a committed helper wraps them in `db.transaction`)
 *    plus direct subscription inserts (no entity-setup helper exists for that
 *    table) — never seed data, never the repository under test for setup.
 *  - Every error case uses the `expectRepoError` try/catch helper — never
 *    `.rejects.toThrow()`.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): each of the four kinds resolves its expected
 *    cohort with `id ASC` ordering; the plan cohort counts a subscriber of
 *    ANY role (the generic `subscriptions.user_id` owner FK).
 *  - Tier 2 (boundary): empty cohorts (unmatched country, absent plan);
 *    window edges (subscription starting exactly now is active, ending
 *    exactly now is not — strict `<`); NULL governance columns read as
 *    eligible; suspended users stay INCLUDED.
 *  - Tier 3 (dedupe + match discipline): a user holding two active
 *    subscriptions to the plan resolves ONCE (DISTINCT); country matches
 *    exact bytes only — wildcard-shaped and near-miss selectors match
 *    nobody (no LIKE surface exists).
 *  - Tier 4 (hostile input): SQL-flavored companion payloads stay bound
 *    parameters (no concatenation, no side effects); companions irrelevant
 *    to the kind never leak into the cohort; a selector kind that bypassed
 *    upstream validation fails loudly.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { inArray, max, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { BroadcastAudienceRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import type { BroadcastAudienceSelector, DBTransaction } from "@/backend/types";

/** Uniquely-named country values — random per run so cohorts are exact sets. */
function uniqueCountry(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Shape of one direct subscription insert (no entity-setup helper exists). */
interface SubscriptionSpec {
  readonly userId: number;
  readonly planId: number;
  readonly status?: "active" | "pending" | "expired" | "cancelled" | "suspended";
  readonly startDate?: Date | null;
  readonly endDate?: Date | null;
}

/** Seeds one subscription row directly — setup only, never the repo under test. */
async function insertSubscription(tx: DBTransaction, spec: SubscriptionSpec): Promise<void> {
  const [row] = await tx
    .insert(subscriptions)
    .values({
      userId: spec.userId,
      planId: spec.planId,
      status: spec.status ?? "active",
      startDate: spec.startDate ?? null,
      endDate: spec.endDate ?? null,
    })
    .returning({ id: subscriptions.id });
  if (!row) {
    throw new Error("insertSubscription: insert returned no rows");
  }
}

/**
 * Builds a selector whose `type` bypassed the upstream validation — the
 * runtime shape an unvalidated wire payload would produce, since TS enums are
 * erased at runtime. The kind is swapped behind a widened alias (no narrowing
 * assertion), so the value the repository receives is statically typed yet
 * hostile. Used to pin the repository's fail-loud contract guard.
 */
function foreignKindSelector(kind: string): BroadcastAudienceSelector {
  const selector: BroadcastAudienceSelector = { type: BroadcastAudienceType.All };
  (selector as { type: string }).type = kind;
  return selector;
}

/** Ids of the committed raw-branch fixtures (captured for afterAll cleanup). */
const rawFixtures = {
  planId: 0,
  subscriberId: 0,
  teacherSubscriberId: 0,
  expiredSubscriberId: 0,
  governedStudentId: 0,
  countryA: uniqueCountry("RAW"),
  countryB: uniqueCountry("RAW"),
};
const committedUserIds: number[] = [];
const committedPlanIds: number[] = [];
const committedSubscriptionIds: number[] = [];

beforeAll(async () => {
  await db.transaction(async fxtx => {
    const plan = await createTestPlan(fxtx);
    rawFixtures.planId = plan.id;
    committedPlanIds.push(plan.id);

    const subscriber = await createTestUser(fxtx, { role: UserRole.Student, country: rawFixtures.countryA });
    const teacherSubscriber = await createTestUser(fxtx, { role: UserRole.Teacher });
    const expiredSubscriber = await createTestUser(fxtx, { role: UserRole.Student, country: rawFixtures.countryB });
    const governedStudent = await createTestUser(fxtx, { role: UserRole.Student, isDeleted: true });
    rawFixtures.subscriberId = subscriber.id;
    rawFixtures.teacherSubscriberId = teacherSubscriber.id;
    rawFixtures.expiredSubscriberId = expiredSubscriber.id;
    rawFixtures.governedStudentId = governedStudent.id;
    committedUserIds.push(subscriber.id, teacherSubscriber.id, expiredSubscriber.id, governedStudent.id);

    const now = Date.now();
    const rows = await fxtx
      .insert(subscriptions)
      .values([
        // Open-ended active subscription (both window edges NULL).
        { userId: subscriber.id, planId: plan.id, status: "active", startDate: null, endDate: null },
        // Bounded active window covering now().
        {
          userId: teacherSubscriber.id,
          planId: plan.id,
          status: "active",
          startDate: new Date(now - 3_600_000),
          endDate: new Date(now + 86_400_000),
        },
        // Lapsed window — NOT an active subscriber.
        {
          userId: expiredSubscriber.id,
          planId: plan.id,
          status: "expired",
          startDate: new Date(now - 7_200_000),
          endDate: new Date(now - 3_600_000),
        },
      ])
      .returning({ id: subscriptions.id });
    committedSubscriptionIds.push(...rows.map(row => row.id));
  });
});

afterAll(async () => {
  // Hard-delete ONLY the committed fixtures this file created (Rule 9).
  // Subscription rows first (restrict-delete FKs point at both parents),
  // then the fixture parents themselves.
  await db.delete(subscriptions).where(inArray(subscriptions.id, committedSubscriptionIds));
  await Promise.all([
    db.delete(plans).where(inArray(plans.id, committedPlanIds)),
    db.delete(users).where(inArray(users.id, committedUserIds)),
  ]);
});

describe("BroadcastAudienceRepository.resolveAudienceIds — transactional branch", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("Tier 1 — 'all' resolves governed users in id ASC order (suspended included, deleted/blocked excluded)", async () => {
    await runInRollback(async tx => {
      const student = await createTestUser(tx, { role: UserRole.Student });
      const teacher = await createTestUser(tx, { role: UserRole.Teacher });
      const parent = await createTestUser(tx, { role: UserRole.Parent });
      const deleted = await createTestUser(tx, { isDeleted: true });
      const blocked = await createTestUser(tx, { isBlocked: true });
      const suspended = await createTestUser(tx, { suspended: true });

      const resolved = await BroadcastAudienceRepository.resolveAudienceIds({ type: BroadcastAudienceType.All }, tx);

      expect(resolved).toContain(student.id);
      expect(resolved).toContain(teacher.id);
      expect(resolved).toContain(parent.id);
      // Suspension gates session requests, never inbox reads — still a recipient.
      expect(resolved).toContain(suspended.id);
      expect(resolved).not.toContain(deleted.id);
      expect(resolved).not.toContain(blocked.id);

      // Deterministic output even with seed data present: ascending + duplicate-free.
      expect(resolved).toEqual(resolved.toSorted((a, b) => a - b));
      expect(new Set(resolved).size).toBe(resolved.length);
    });
  });

  test("Tier 1 — 'role' resolves exactly that role's governed users", async () => {
    await runInRollback(async tx => {
      const teacher1 = await createTestUser(tx, { role: UserRole.Teacher });
      const teacher2 = await createTestUser(tx, { role: UserRole.Teacher });
      const student = await createTestUser(tx, { role: UserRole.Student });
      const deletedTeacher = await createTestUser(tx, { role: UserRole.Teacher, isDeleted: true });
      const blockedTeacher = await createTestUser(tx, { role: UserRole.Teacher, isBlocked: true });

      const resolved = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
        tx
      );

      expect(resolved).toContain(teacher1.id);
      expect(resolved).toContain(teacher2.id);
      expect(resolved).not.toContain(student.id);
      expect(resolved).not.toContain(deletedTeacher.id);
      expect(resolved).not.toContain(blockedTeacher.id);
      expect(resolved).toEqual(resolved.toSorted((a, b) => a - b));
    });
  });

  test("Tier 1 — 'country' resolves exactly the exact-match cohort, id ASC", async () => {
    await runInRollback(async tx => {
      const country = uniqueCountry("BRC");
      const first = await createTestUser(tx, { country });
      const second = await createTestUser(tx, { country });
      const elsewhere = await createTestUser(tx, { country: uniqueCountry("BRC") });

      const resolved = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Country, country },
        tx
      );

      // The value is unique per run, so the cohort is an exact set.
      expect(resolved).toEqual([first.id, second.id].toSorted((a, b) => a - b));
      expect(resolved).not.toContain(elsewhere.id);
    });
  });

  test("Tier 1 — 'plan' resolves exactly the active-window subscribers of that plan, any role", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx);
      const now = Date.now();
      const activeStudent = await createTestUser(tx, { role: UserRole.Student });
      const activeTeacher = await createTestUser(tx, { role: UserRole.Teacher });
      const pending = await createTestUser(tx, { role: UserRole.Student });
      const expired = await createTestUser(tx, { role: UserRole.Parent });
      const cancelled = await createTestUser(tx, { role: UserRole.Teacher });
      const unaffiliated = await createTestUser(tx, { role: UserRole.Student });

      await insertSubscription(tx, { userId: activeStudent.id, planId: plan.id });
      await insertSubscription(tx, { userId: activeTeacher.id, planId: plan.id });
      await insertSubscription(tx, { userId: pending.id, planId: plan.id, status: "pending" });
      await insertSubscription(tx, {
        userId: expired.id,
        planId: plan.id,
        status: "expired",
        endDate: new Date(now - 3_600_000),
      });
      await insertSubscription(tx, { userId: cancelled.id, planId: plan.id, status: "cancelled" });

      const resolved = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Plan, planId: plan.id },
        tx
      );

      // The owner FK is the generic subscriptions.user_id — the teacher's
      // verification-plan subscription counts the same as a student's.
      expect(resolved).toEqual([activeStudent.id, activeTeacher.id].toSorted((a, b) => a - b));
      expect(resolved).not.toContain(pending.id);
      expect(resolved).not.toContain(expired.id);
      expect(resolved).not.toContain(cancelled.id);
      expect(resolved).not.toContain(unaffiliated.id);
    });
  });

  // ─── Tier 2: boundary ───────────────────────────────────────────────

  test("Tier 2 — cohorts that match nobody resolve to [] (unmatched country, absent plan)", async () => {
    await runInRollback(async tx => {
      const [maxPlan] = await tx.select({ maxId: max(plans.id) }).from(plans);
      const absentPlanId = (maxPlan?.maxId ?? 0) + 1_000_000;

      const emptyCountry = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Country, country: uniqueCountry("VOID") },
        tx
      );
      const absentPlan = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Plan, planId: absentPlanId },
        tx
      );

      expect(emptyCountry).toEqual([]);
      expect(absentPlan).toEqual([]);
    });
  });

  test("Tier 2 — window edges: starting exactly now is active, ending exactly now is not", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx);
      const justStarted = await createTestUser(tx, { role: UserRole.Student });
      const justEnded = await createTestUser(tx, { role: UserRole.Student });

      // PostgreSQL freezes now() at transaction start, so INSIDE one tx an
      // edge equal to now() is exactly the boundary case. Seeding the edges
      // as SQL now() puts both subscriptions on the transaction's own clock —
      // fully deterministic, no JS/PG clock round-trip.
      await tx.insert(subscriptions).values([
        { userId: justStarted.id, planId: plan.id, status: "active", startDate: sql`now()`, endDate: null },
        { userId: justEnded.id, planId: plan.id, status: "active", startDate: null, endDate: sql`now()` },
      ]);

      const resolved = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Plan, planId: plan.id },
        tx
      );

      // now() >= coalesce(start_date, ...) is non-strict (equal edge included);
      // now() < end_date is strict (equal edge excluded).
      expect(resolved).toEqual([justStarted.id]);
      expect(resolved).not.toContain(justEnded.id);
    });
  });

  test("Tier 2 — NULL governance columns read as eligible (legacy rows)", async () => {
    await runInRollback(async tx => {
      const legacy = await createTestUser(tx, { isDeleted: null, isBlocked: null, suspended: null });

      const everyone = await BroadcastAudienceRepository.resolveAudienceIds({ type: BroadcastAudienceType.All }, tx);
      // The fixture keeps the default student role — same cohort, one pin on
      // the all-shape and one on the role-shape.
      const students = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Role, role: UserRole.Student },
        tx
      );

      expect(everyone).toContain(legacy.id);
      expect(students).toContain(legacy.id);
    });
  });

  // ─── Tier 3: dedupe + match discipline ──────────────────────────────

  test("Tier 3 — a user holding two active subscriptions to the plan resolves ONCE (DISTINCT)", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx);
      const doubleSubscriber = await createTestUser(tx, { role: UserRole.Student });
      await insertSubscription(tx, { userId: doubleSubscriber.id, planId: plan.id });
      await insertSubscription(tx, {
        userId: doubleSubscriber.id,
        planId: plan.id,
        startDate: new Date(Date.now() - 86_400_000),
      });

      const resolved = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Plan, planId: plan.id },
        tx
      );

      expect(resolved).toEqual([doubleSubscriber.id]);
      expect(resolved.filter(id => id === doubleSubscriber.id)).toHaveLength(1);
    });
  });

  test("Tier 3 — country matches EXACT bytes only: wildcard-shaped and near-miss selectors match nobody", async () => {
    await runInRollback(async tx => {
      const country = uniqueCountry("EGX");
      const only = await createTestUser(tx, { country });

      const exact = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Country, country },
        tx
      );
      const wildcardTail = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Country, country: `${country}%` },
        tx
      );
      const lowercase = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Country, country: country.toLowerCase() },
        tx
      );
      const trailingSpace = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Country, country: `${country} ` },
        tx
      );
      const leadingSpace = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Country, country: ` ${country}` },
        tx
      );

      expect(exact).toEqual([only.id]);
      expect(wildcardTail).toEqual([]);
      expect(lowercase).toEqual([]);
      expect(trailingSpace).toEqual([]);
      expect(leadingSpace).toEqual([]);
    });
  });

  // ─── Tier 4: hostile input ──────────────────────────────────────────

  test("Tier 4 — SQL-flavored companion values stay bound parameters (no concatenation, no side effects)", async () => {
    await runInRollback(async tx => {
      const tautology = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Country, country: "' OR '1'='1" },
        tx
      );
      const dropShaped = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Country, country: "x'; DROP TABLE users; --" },
        tx
      );

      // Concatenation would have widened the tautology probe to every user
      // row and broken the statement after it — binding keeps both empty.
      expect(tautology).toEqual([]);
      expect(dropShaped).toEqual([]);

      // The users table is intact and the cohort engine still resolves.
      const healthy = await createTestUser(tx, { role: UserRole.Student });
      const after = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Role, role: UserRole.Student },
        tx
      );
      expect(after).toContain(healthy.id);
    });
  });

  test("Tier 4 — companions irrelevant to the kind never leak into the cohort", async () => {
    await runInRollback(async tx => {
      const teacher = await createTestUser(tx, { role: UserRole.Teacher });
      const strayCountryStudent = await createTestUser(tx, { country: uniqueCountry("STRAY") });

      // The whole-base kind ignores the stray companions entirely — no
      // accidental narrowing by a field its kind does not consume.
      const resolved = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.All, country: uniqueCountry("STRAY"), planId: 4_000_000 },
        tx
      );

      expect(resolved).toContain(teacher.id);
      expect(resolved).toContain(strayCountryStudent.id);
    });
  });

  test("Tier 4 — a selector kind that bypassed upstream validation fails loudly", async () => {
    await runInRollback(async tx => {
      const error = await expectRepoError(() =>
        BroadcastAudienceRepository.resolveAudienceIds(foreignKindSelector("everything"), tx)
      );
      expect(error.message).toContain("unhandled audience selector kind");
    });
  });

  // ─── tx propagation + rollback isolation ────────────────────────────

  test("tx propagation — uncommitted fixtures resolve only through the supplied tx", async () => {
    const country = uniqueCountry("PROP");
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { country });
      const resolved = await BroadcastAudienceRepository.resolveAudienceIds(
        { type: BroadcastAudienceType.Country, country },
        tx
      );
      // Visible through the tx — the read ran on the caller's transaction.
      expect(resolved).toEqual([user.id]);
    });

    // After the forced rollback the same selector on the pool connection
    // resolves nobody: the committed database never saw the fixture.
    const afterRollback = await BroadcastAudienceRepository.resolveAudienceIds({
      type: BroadcastAudienceType.Country,
      country,
    });
    expect(afterRollback).toEqual([]);
  });
});

describe("BroadcastAudienceRepository.resolveAudienceIds — raw-SQL branch (committed fixtures)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("Tier 1 — 'all' resolves the governed committed cohort, id ASC, duplicate-free", async () => {
    const resolved = await BroadcastAudienceRepository.resolveAudienceIds({ type: BroadcastAudienceType.All });

    expect(resolved).toContain(rawFixtures.subscriberId);
    expect(resolved).toContain(rawFixtures.teacherSubscriberId);
    expect(resolved).toContain(rawFixtures.expiredSubscriberId);
    expect(resolved).not.toContain(rawFixtures.governedStudentId);
    expect(resolved).toEqual(resolved.toSorted((a, b) => a - b));
    expect(new Set(resolved).size).toBe(resolved.length);
  });

  test("Tier 1 — 'role' resolves the committed role cohort and still excludes governed rows", async () => {
    const students = await BroadcastAudienceRepository.resolveAudienceIds({
      type: BroadcastAudienceType.Role,
      role: UserRole.Student,
    });

    expect(students).toContain(rawFixtures.subscriberId);
    expect(students).toContain(rawFixtures.expiredSubscriberId);
    expect(students).not.toContain(rawFixtures.teacherSubscriberId);
    expect(students).not.toContain(rawFixtures.governedStudentId);

    const teachers = await BroadcastAudienceRepository.resolveAudienceIds({
      type: BroadcastAudienceType.Role,
      role: UserRole.Teacher,
    });
    expect(teachers).toContain(rawFixtures.teacherSubscriberId);
    expect(teachers).not.toContain(rawFixtures.subscriberId);
  });

  test("Tier 1 — 'country' resolves exactly the committed exact-match cohort", async () => {
    const resolved = await BroadcastAudienceRepository.resolveAudienceIds({
      type: BroadcastAudienceType.Country,
      country: rawFixtures.countryA,
    });

    expect(resolved).toEqual([rawFixtures.subscriberId]);
  });

  test("Tier 1 — 'plan' resolves exactly the committed active-window subscribers", async () => {
    const resolved = await BroadcastAudienceRepository.resolveAudienceIds({
      type: BroadcastAudienceType.Plan,
      planId: rawFixtures.planId,
    });

    // Bounded-active + open-ended subscribers in; lapsed window out.
    expect(resolved).toEqual([rawFixtures.subscriberId, rawFixtures.teacherSubscriberId].toSorted((a, b) => a - b));
    expect(resolved).not.toContain(rawFixtures.expiredSubscriberId);
  });

  // ─── Tier 2/3: boundary + match discipline ──────────────────────────

  test("Tier 2 — a plan id beyond the identity range resolves to []", async () => {
    const [maxPlan] = await db.select({ maxId: max(plans.id) }).from(plans);
    const absentPlanId = (maxPlan?.maxId ?? 0) + 1_000_000;

    const resolved = await BroadcastAudienceRepository.resolveAudienceIds({
      type: BroadcastAudienceType.Plan,
      planId: absentPlanId,
    });

    expect(resolved).toEqual([]);
  });

  test("Tier 3 — wildcard-shaped and near-miss country selectors match nobody on the raw branch", async () => {
    const wildcardTail = await BroadcastAudienceRepository.resolveAudienceIds({
      type: BroadcastAudienceType.Country,
      country: `${rawFixtures.countryA}%`,
    });
    const lowercase = await BroadcastAudienceRepository.resolveAudienceIds({
      type: BroadcastAudienceType.Country,
      country: rawFixtures.countryA.toLowerCase(),
    });
    const otherCountry = await BroadcastAudienceRepository.resolveAudienceIds({
      type: BroadcastAudienceType.Country,
      country: rawFixtures.countryB,
    });

    expect(wildcardTail).toEqual([]);
    expect(lowercase).toEqual([]);
    // The second committed country resolves its own subscriber — the probes
    // above fail on matching, not on data absence.
    expect(otherCountry).toEqual([rawFixtures.expiredSubscriberId]);
  });
});
