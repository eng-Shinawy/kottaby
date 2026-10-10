/**
 * Drizzle adapter for the matching benchmark — the one module that touches
 * the database. Every query and write is strictly scoped to the seed run's
 * escaped prefix pattern, so sibling data in the shared test database can
 * never contaminate the census, the exclusion oracle, or the window flips.
 *
 * Import discipline: this module references the shared database client TYPE
 * only. The client module is imported dynamically by the benchmark entry
 * point AFTER the destructive-target guard has allowed the run, so no pool
 * or client object is ever constructed before the guard decides.
 *
 * The benchmark's only writes are (a) temporarily marking seeded teachers
 * outside the current volume window offline (the window-narrowing flips,
 * restored by the orchestrator on every path) and (b) inserting a
 * bench-owned caller identity when the seed run carries no suitable
 * student — prefix-stamped rows the run's prefix-scoped cleanup removes.
 */

import { and, eq, inArray, like, sql } from "drizzle-orm";
import { session } from "@/backend/db/schema/classes/session";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import type { BenchCallerInsert, BenchCallerPlan, StudentCandidateRow } from "@/scripts/perf/lib/bench-matching-plan";

/** Resolved caller identities plus how many bench-owned rows were inserted. */
export interface ResolvedBenchCallers {
  readonly noFilter: number;
  readonly language: number;
  readonly inserted: number;
}

/**
 * Resolves the two matrix callers from the caller plan, inserting
 * bench-owned rows for any missing kind. The refusal factory lets the
 * entrypoint keep its operator-error type without this module importing it.
 */
export async function ensureCallers(
  database: BenchDatabase,
  plan: BenchCallerPlan,
  refusal: (message: string) => Error,
  index = 0,
  resolved: { noFilter: number | null; language: number | null; inserted: number } = {
    noFilter: null,
    language: null,
    inserted: 0,
  }
): Promise<ResolvedBenchCallers> {
  if (index >= plan.inserts.length) {
    if (resolved.noFilter === null || resolved.language === null) {
      throw refusal("no usable caller identity could be resolved for the benchmark");
    }
    return { noFilter: resolved.noFilter, language: resolved.language, inserted: resolved.inserted };
  }
  const insert = plan.inserts[index];
  const callerId = await database.insertBenchCaller(insert);
  const isLanguageCaller = insert.primaryLanguage !== "arabic";
  return ensureCallers(database, plan, refusal, index + 1, {
    noFilter: isLanguageCaller ? resolved.noFilter : callerId,
    language: isLanguageCaller ? callerId : resolved.language,
    inserted: resolved.inserted + 1,
  });
}

/** The Drizzle client type, referenced without importing the client module at load time. */
type BenchDbClient = typeof import("@/backend/db/client")["db"];

/** Bound on one offline/online flip statement (mirrors the seeder's batch cap). */
const FLIP_BATCH_SIZE = 500;

/** The prefix-scoped LIKE pattern every database access is bound to. */
export function prefixScanPattern(prefix: string): string {
  return `${escapeLikeWildcards(prefix)}%`;
}

/** The database seam the benchmark orchestrates over. */
export interface BenchDatabase {
  /** Seed-scoped teachers satisfying the matcher's row-level eligibility, by id ascending. */
  findEligibleTeacherIds(prefix: string): Promise<number[]>;
  /** Seed-scoped teacher ids holding at least one `started` session (the exclusion oracle). */
  findStartedTeacherIds(prefix: string): Promise<number[]>;
  /** Marks the given teacher ids offline/online; resolves to the flipped row count. */
  setTeachersOffline(ids: readonly number[]): Promise<number>;
  setTeachersOnline(ids: readonly number[]): Promise<number>;
  /** Seed-scoped student identities, by id ascending. */
  listStudentCandidates(prefix: string): Promise<StudentCandidateRow[]>;
  /** Inserts one bench-owned caller (users + students); resolves to the new user id. */
  insertBenchCaller(insert: BenchCallerInsert): Promise<number>;
  close(): Promise<void>;
}

/** The governance-free predicate the matching read itself applies to the owning account. */
const GOVERNANCE_FREE = sql`${users.isDeleted} is distinct from true and ${users.suspended} is distinct from true and ${users.isBlocked} is distinct from true`;

/** Prefix-scoped Drizzle adapter over the real database client. */
export class DrizzleBenchDatabase implements BenchDatabase {
  constructor(private readonly db: BenchDbClient) {}

  async findEligibleTeacherIds(prefix: string): Promise<number[]> {
    const pattern = prefixScanPattern(prefix);
    const rows = await this.db
      .select({ id: teacher.id })
      .from(teacher)
      .innerJoin(users, eq(users.id, teacher.id))
      .where(and(like(users.email, pattern), eq(teacher.isOnline, true), eq(teacher.isApproved, true), GOVERNANCE_FREE))
      .orderBy(teacher.id);
    return rows.map(row => row.id);
  }

  async findStartedTeacherIds(prefix: string): Promise<number[]> {
    const pattern = prefixScanPattern(prefix);
    const rows = await this.db
      .selectDistinct({ id: session.teacherId })
      .from(session)
      .where(
        and(
          eq(session.status, SessionStatus.Started),
          inArray(session.teacherId, this.db.select({ id: users.id }).from(users).where(like(users.email, pattern)))
        )
      );
    return rows.map(row => row.id);
  }

  async setTeachersOffline(ids: readonly number[]): Promise<number> {
    return this.updateTeacherOnline(ids, false, 0, 0);
  }

  async setTeachersOnline(ids: readonly number[]): Promise<number> {
    return this.updateTeacherOnline(ids, true, 0, 0);
  }

  async listStudentCandidates(prefix: string): Promise<StudentCandidateRow[]> {
    const pattern = prefixScanPattern(prefix);
    return this.db
      .select({
        id: students.id,
        primaryLanguage: students.primaryLanguage,
        anotherLanguage: students.anotherLanguage,
      })
      .from(students)
      .innerJoin(users, eq(users.id, students.id))
      .where(like(users.email, pattern))
      .orderBy(students.id);
  }

  async insertBenchCaller(insert: BenchCallerInsert): Promise<number> {
    const inserted = await this.db
      .insert(users)
      .values({
        fullName: insert.fullName,
        email: insert.email,
        phone: insert.phone,
        passwordHash: insert.passwordHash,
        mustChangePassword: false,
        role: UserRole.Student,
        isDeleted: false,
        suspended: false,
        isBlocked: false,
        country: "Egypt",
        countryCode: "EG",
        locale: insert.locale,
        lastActiveAt: new Date(),
      })
      .returning({ id: users.id });
    const callerUserId = inserted[0].id;
    await this.db.insert(students).values({
      id: callerUserId,
      balanceHifz: 4,
      balanceReviews: 0,
      balanceTajweed: 0,
      balanceTrial: 0,
      handshakeCode: insert.handshakeCode,
      primaryLanguage: insert.primaryLanguage,
    });
    return callerUserId;
  }

  async close(): Promise<void> {
    const { closePool } = await import("@/backend/db/client");
    await closePool();
  }

  /** Recursive chunked drain: bounded `IN` lists, no await inside a loop body. */
  private async updateTeacherOnline(
    ids: readonly number[],
    online: boolean,
    index: number,
    flipped: number
  ): Promise<number> {
    if (index >= ids.length) {
      return flipped;
    }
    const batch = ids.slice(index, index + FLIP_BATCH_SIZE);
    const result = await this.db.update(teacher).set({ isOnline: online }).where(inArray(teacher.id, batch));
    return this.updateTeacherOnline(ids, online, index + FLIP_BATCH_SIZE, flipped + (result.rowCount ?? 0));
  }
}
