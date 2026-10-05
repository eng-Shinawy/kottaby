/**
 * TeacherMatchingService tests — the student-facing on-demand matching
 * browse (validation → caller resolution → language resolution → token
 * patterns → repository delegation → fail-closed projection → envelope).
 *
 * Per `backend/db/test/AGENTS.md` + the availability-suite contract:
 *  - 4-Tier mixed suite. Every DB-touching case runs inside
 *    `runInRollback` with `tx` propagated to the service (the browse is a
 *    pure read on the caller's executor — no transaction of its own).
 *  - Entities are created ONLY via `entity-setup.ts` helpers; no seed
 *    data, no production fixtures.
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` appears nowhere.
 *  - Denial messages are asserted against the EXACT translated copy
 *    resolved via `getServerTranslations(locale).errorsTranslations` —
 *    never raw keys, never hardcoded UI copy.
 *  - The repository boundary is spied with PASS-THROUGH delegation (never
 *    mocked away): filter shapes are pinned on the captured
 *    `NormalizedTeacherMatchingFilters` while the real read executes, and
 *    the service's read-only posture is proven by zero writes.
 *
 * Coverage map (the four-tier contract):
 *  - Tier 1 (branch/statement): the language-resolution truth table
 *    (primary-wins, secondary fallback, Arabic baseline incl. padded,
 *    short-form, and Arabic-script tokens → no filter), the country-pair
 *    Cartesian (code+text / legacy text only / neither) pinned on the
 *    captured filters, the hostile enum matrix (bogus/empty recitation,
 *    evaluation and bogus intent) denying with `VALIDATION` before ANY
 *    repository read, and both caller-miss branches (absent `users` row;
 *    real teacher user with no `students` row) denying with the localized
 *    `NotFoundError`.
 *  - Tier 2 (boundary): the 50/51-character language-token edge,
 *    whitespace-only and empty tokens, quote/backslash gates, unicode
 *    tokens end-to-end, unrated-sorting-after-rated, beyond-last-page
 *    honest totals, envelope defaults and explicit bounds, corrupt stored
 *    payloads degrading their own field without failing the page (and a
 *    corrupt certification payload excluding the row), hostile locales
 *    falling back to the default-locale copy, and the Arabic-script
 *    denial round-trip.
 *  - Tier 3 (chaos/concurrency): `Promise.allSettled` parallel browses on
 *    one executor resolve consistently (read-only safety), and a
 *    toggle-during-browse probe proving the returned page is a
 *    point-in-time snapshot (the earlier page object is never mutated by
 *    later state; the next browse re-reads committed state).
 *  - Tier 4 (security/abuse): `%`/`_` wildcard tokens are escaped at the
 *    service's single escape point and match ONLY literally (behavioral
 *    escape proof), the caller-miss denial logs EXACTLY ONCE with a
 *    bounded context (no PII) and the happy path logs NOTHING, smuggled
 *    id fields on the input never reach the query builder (BOLA/BOPLA),
 *    and static source pins (no spread into any builder, one escape
 *    import, no transactions, no console, no plan-artifact references).
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/services/teachers/teacher-matching.service.test.ts`.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  type NormalizedTeacherMatchingFilters,
  StudentRepository,
  TeacherRepository,
  UserRepository,
} from "@/backend/db/repo";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestTeacherRow, createTestUser } from "@/backend/db/test/entity-setup";
import { type DBTransaction, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import { DomainError, NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { TeacherMatchingService } from "@/backend/services/teachers/teacher-matching.service";
import type { DBQueryExecutor, TeacherMatchingSubmitInput } from "@/backend/types";
import { RecitationReading } from "@/shared/constants/recitation-reading.enum";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Default test locale (most cases run on English unless asserted otherwise). */
const LOCALE_EN = "en";

/** Arabic locale for the localized-denial parity probes. */
const LOCALE_AR = "ar";

/** Hostile empty locale — must fall back to the platform default-locale copy. */
const LOCALE_EMPTY = "";

/** Hostile unknown locale tag — must fall back to the platform default-locale copy. */
const LOCALE_UNKNOWN = "klingon-pirate";

/** The recitation token every eligible fixture teacher is certified for. */
const HAFS = RecitationReading.HAFS_AN_ASIM;

/**
 * A rare catalog reading used by the behavioral tiers — no production
 * writer has ever stored it, so a browse keyed on it can only match THIS
 * suite's fixtures and ordering/total assertions stay exact even on a
 * shared database.
 */
const RARE_READING = RecitationReading.KHALAF_AN_HAMZAH;

/** The subject token the browse intent resolves to (the subject vocabulary). */
const HIFZ_SUBJECT = SessionIntent.Hifz;

/** Parallel-browse volume for the read-safety chaos tier. */
const PARALLEL_BROWSE_COUNT = 8;

/** Default page bounds the browse restores for explicit `null` inputs. */
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Resolves the localized errors bundle for the supplied locale. The
 * translated copy is used for byte-exact denial assertions (never the raw
 * key, never the code echoed into the copy).
 */
function errorsFor(locale: string) {
  return getServerTranslations(locale).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code` contract. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Asserts a caught error is a `DomainError` carrying EXACTLY the expected
 * `extensions.code` and the exact translated message (never the raw key,
 * never the code echoed into the copy).
 */
function expectDomainDenial(error: Error, code: string, message: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(rejectionCode(error)).toBe(code);
  expect(error.message).toBe(message);
  expect(error.message).not.toContain(code);
}

/**
 * Installs a recording stub over `logger.logDomainError` so domain-rejection
 * logs never reach test stdout AND can be counted by the logging-contract
 * assertions. The stub's call history is cleared on each invocation so
 * tests can assert EXACT call counts without spillover from prior tests
 * (the shared logger singleton keeps the last-installed spy across tests).
 */
function silenceDomainLog() {
  const spy = spyOn(logger, "logDomainError");
  spy.mockClear();
  return spy.mockImplementation(() => {});
}

/**
 * Returns the recorded log call args at the given index — throws a fixture-
 * integrity error when the spy has fewer calls than expected (so the
 * `expect(...).toHaveLength(N)` assertion upstream is the single source of
 * truth for the call count, and any subsequent `.at(N)` access stays
 * type-safe without non-null assertions).
 */
function recordedLogCall(logSpy: ReturnType<typeof silenceDomainLog>, index = 0) {
  const call = logSpy.mock.calls.at(index);
  if (!call) {
    throw new Error(`log spy: expected at least ${index + 1} call(s), got ${logSpy.mock.calls.length}`);
  }
  return call;
}

/**
 * A student's browse choices (explicit `null`s restore the defaults).
 * The intent union is the student browse vocabulary — the staff-driven
 * evaluation flow is not a browse intent.
 */
function browseInput(
  recitation: RecitationReading,
  intent: SessionIntent.Hifz | SessionIntent.Tajweed,
  page: number | null = null,
  pageSize: number | null = null
): TeacherMatchingSubmitInput {
  return { recitation, intent, page, pageSize };
}

/**
 * Merges hostile runtime overrides onto a valid browse payload — the
 * transport-tamper idiom (no type assertion): a GraphQL resolver delivers
 * runtime-validated input, never type-guaranteed input, so the service
 * must reject smuggled enum values and drop smuggled id fields itself.
 */
function hostileInput(overrides: Record<string, unknown>): TeacherMatchingSubmitInput {
  const input = browseInput(HAFS, HIFZ_SUBJECT);
  Object.assign(input, overrides);
  return input;
}

/** The default browse this suite keys most behavioral cases on. */
function rareBrowse(page: number | null = null, pageSize: number | null = null): TeacherMatchingSubmitInput {
  return browseInput(RARE_READING, HIFZ_SUBJECT, page, pageSize);
}

/**
 * Installs a recording pass-through spy over the repository read: every
 * call is captured AND delegated to the real read (never mocked away), so
 * a test can pin the exact `NormalizedTeacherMatchingFilters` the service
 * built while the genuine repository pipeline executes. Restored by the
 * returned handle.
 */
function captureMatchingFilters(): {
  captured: NormalizedTeacherMatchingFilters[];
  stop: () => void;
} {
  const captured: NormalizedTeacherMatchingFilters[] = [];
  const realRead = TeacherRepository.listMatchingCandidates;
  const spy = spyOn(TeacherRepository, "listMatchingCandidates").mockImplementation(
    async (filters: NormalizedTeacherMatchingFilters, limit: number, offset: number, tx?: DBQueryExecutor) => {
      captured.push(filters);
      return realRead(filters, limit, offset, tx);
    }
  );
  return { captured, stop: () => spy.mockRestore() };
}

/** The escaped quoted-token pattern the service must build for a token. */
function expectedPattern(token: string): string {
  const quoted = `"${token}"`;
  return `%${escapeLikeWildcards(quoted)}%`;
}

/** Per-run unique language token — no other row can ever carry it. */
function uniqueLanguageToken(label: string): string {
  return `${label}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/**
 * Provisions a student caller (real `users` + `students` rows) with the
 * caller-side browse context: the country pair drives the ordering tier,
 * the profile languages drive the language resolution.
 */
async function createStudentCaller(
  tx: DBTransaction,
  profile: {
    primaryLanguage?: string | null;
    anotherLanguage?: string | null;
    country?: string | null;
    countryCode?: string | null;
  } = {}
): Promise<number> {
  const user = await createTestUser(tx, {
    role: "student",
    country: profile.country ?? null,
    countryCode: profile.countryCode ?? null,
  });
  await createTestStudent(tx, user.id, {
    primaryLanguage: profile.primaryLanguage ?? null,
    anotherLanguage: profile.anotherLanguage ?? null,
  });
  return user.id;
}

/**
 * Directory-profile fixture for one teacher: an online, certified Hafs +
 * Hifz teacher by default, with every attribute overridable. Payload
 * columns serialize exactly the way the quoted-token read path expects
 * (`["token"]` — each element anchored by surrounding quotes).
 */
async function createDirectoryTeacher(
  tx: DBTransaction,
  profile: {
    recitations?: readonly RecitationReading[];
    subjects?: readonly string[];
    languages?: readonly string[] | null;
    averageRating?: string | null;
    isOnline?: boolean;
    isApproved?: boolean;
    country?: string | null;
    countryCode?: string | null;
  } = {}
): Promise<number> {
  const user = await createTestUser(tx, {
    role: "teacher",
    country: profile.country ?? null,
    countryCode: profile.countryCode ?? null,
  });
  await createTestTeacherRow(tx, user.id, {
    recitations: profile.recitations === undefined ? null : JSON.stringify([...profile.recitations]),
    subjects: profile.subjects === undefined ? null : JSON.stringify([...profile.subjects]),
    languages:
      profile.languages === undefined || profile.languages === null ? null : JSON.stringify([...profile.languages]),
    averageRating: profile.averageRating ?? null,
    isOnline: profile.isOnline ?? true,
    isApproved: profile.isApproved ?? true,
  });
  return user.id;
}

/**
 * Returns an integer id guaranteed absent as a `users` row this tx —
 * anything above the current max (plus an offset no sequence reaches
 * mid-test). The `students` row shares the PK, so a `users` miss implies
 * a `students` miss.
 */
async function absentCallerId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

// ══════════════════════════════════════════════════════════════════════════
// browseAvailableTeachers
// ══════════════════════════════════════════════════════════════════════════

describe("TeacherMatchingService.browseAvailableTeachers", () => {
  // ─── Tier 1: branch/statement — language-resolution truth table ─────

  const LANGUAGE_MATRIX = [
    {
      label: "both profile languages absent → no filter (the platform default)",
      primaryLanguage: null,
      anotherLanguage: null,
      expectedToken: null,
    },
    {
      label: "padded mixed-case Arabic primary → no filter",
      primaryLanguage: "Arabic ",
      anotherLanguage: "french",
      expectedToken: null,
    },
    {
      label: "short-form Arabic token → no filter",
      primaryLanguage: "ar",
      anotherLanguage: null,
      expectedToken: null,
    },
    {
      label: "Arabic-script token → no filter",
      primaryLanguage: "عربي",
      anotherLanguage: null,
      expectedToken: null,
    },
    {
      label: "non-Arabic primary → hard filter on the normalized token",
      primaryLanguage: "French",
      anotherLanguage: null,
      expectedToken: "french",
    },
    {
      label: "secondary used when the primary is absent",
      primaryLanguage: null,
      anotherLanguage: "English",
      expectedToken: "english",
    },
    {
      label: "primary wins over an Arabic secondary",
      primaryLanguage: "french",
      anotherLanguage: "arabic",
      expectedToken: "french",
    },
  ];

  test.each(LANGUAGE_MATRIX)(
    "language resolution: $label",
    async ({ primaryLanguage, anotherLanguage, expectedToken }) => {
      await runInRollback(async tx => {
        const callerId = await createStudentCaller(tx, { primaryLanguage, anotherLanguage });
        const { captured, stop } = captureMatchingFilters();
        silenceDomainLog();

        await TeacherMatchingService.browseAvailableTeachers(callerId, browseInput(HAFS, HIFZ_SUBJECT), LOCALE_EN, tx);
        stop();

        expect(captured).toHaveLength(1);
        const filters = captured.at(0);
        expect(filters?.languagePattern).toBe(expectedToken === null ? null : expectedPattern(expectedToken));
        // The non-language filters are stable across the whole matrix.
        expect(filters?.recitationPattern).toBe(expectedPattern(HAFS));
        expect(filters?.subjectPattern).toBe(expectedPattern(HIFZ_SUBJECT));
      });
    }
  );

  // ─── Tier 1: branch/statement — country-pair Cartesian ──────────────

  const COUNTRY_MATRIX = [
    {
      label: "code + legacy text both present → both passed through (code arm decides)",
      country: "Egypt",
      countryCode: "EG",
      expectedCountry: "Egypt",
      expectedCountryCode: "EG",
    },
    {
      label: "legacy free text only → text passed through (the fallback arm)",
      country: "Egypt",
      countryCode: null,
      expectedCountry: "Egypt",
      expectedCountryCode: null,
    },
    {
      label: "neither present → one-tier browse (no ordering input)",
      country: null,
      countryCode: null,
      expectedCountry: null,
      expectedCountryCode: null,
    },
  ];

  test.each(COUNTRY_MATRIX)(
    "country resolution: $label",
    async ({ country, countryCode, expectedCountry, expectedCountryCode }) => {
      await runInRollback(async tx => {
        const callerId = await createStudentCaller(tx, { country, countryCode });
        const { captured, stop } = captureMatchingFilters();
        silenceDomainLog();

        await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx);
        stop();

        expect(captured).toHaveLength(1);
        const filters = captured.at(0);
        expect(filters?.studentCountryCode).toBe(expectedCountryCode);
        expect(filters?.studentCountryText).toBe(expectedCountry);
      });
    }
  );

  // ─── Tier 1: branch/statement — hostile enum payloads (pre-DB) ──────

  test.each([
    { label: "evaluation intent (the staff-driven flow)", overrides: { intent: "evaluation" } },
    { label: "bogus intent token", overrides: { intent: "hifz_jadid" } },
    { label: "bogus recitation token", overrides: { recitation: "bogus_reading" } },
    { label: "empty recitation token", overrides: { recitation: "" } },
    { label: "null recitation token", overrides: { recitation: null } },
  ])("denies $label with the localized VALIDATION before any repository read", async ({ overrides }) => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, { primaryLanguage: "arabic" });
      const listSpy = spyOn(TeacherRepository, "listMatchingCandidates");
      const userSpy = spyOn(UserRepository, "findById");
      silenceDomainLog();

      const error = await expectRepoError(() =>
        TeacherMatchingService.browseAvailableTeachers(callerId, hostileInput(overrides), LOCALE_EN, tx)
      );

      expectDomainDenial(error, "VALIDATION", errorsFor(LOCALE_EN).validation);
      // Pre-DB validation: ZERO repository reads fired.
      expect(userSpy.mock.calls).toHaveLength(0);
      expect(listSpy.mock.calls).toHaveLength(0);
      userSpy.mockRestore();
      listSpy.mockRestore();
    });
  });

  // ─── Tier 1: branch/statement — caller resolution (BOLA posture) ────

  test("a caller with no users row is denied with the localized caller-miss not-found", async () => {
    await runInRollback(async tx => {
      const absentId = await absentCallerId(tx);
      const studentSpy = spyOn(StudentRepository, "findById");
      const logSpy = silenceDomainLog();

      const error = await expectRepoError(() =>
        TeacherMatchingService.browseAvailableTeachers(absentId, rareBrowse(), LOCALE_EN, tx)
      );

      expect(error).toBeInstanceOf(NotFoundError);
      expectDomainDenial(error, "STUDENT_NOT_FOUND", errorsFor(LOCALE_EN).studentHandshakeNotFound);
      // The caller resolution stops at the first miss — the students read
      // never fires for an unknown user.
      expect(studentSpy.mock.calls).toHaveLength(0);
      studentSpy.mockRestore();

      expect(logSpy.mock.calls).toHaveLength(1);
      const [message, ctx] = recordedLogCall(logSpy);
      expect(message).toBe("Matching browse denied: no user record for caller");
      expect(ctx).toEqual({
        code: "STUDENT_NOT_FOUND",
        entity: "students",
        entityId: absentId,
        locale: LOCALE_EN,
      });
      expect(new Set(Object.keys(ctx ?? {}))).toEqual(new Set(["code", "entity", "entityId", "locale"]));
    });
  });

  test("a teacher caller (a real user with no students row) is denied with the caller-miss not-found", async () => {
    await runInRollback(async tx => {
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id, {});
      const logSpy = silenceDomainLog();

      const error = await expectRepoError(() =>
        TeacherMatchingService.browseAvailableTeachers(teacherUser.id, rareBrowse(), LOCALE_EN, tx)
      );

      expectDomainDenial(error, "STUDENT_NOT_FOUND", errorsFor(LOCALE_EN).studentHandshakeNotFound);
      expect(logSpy.mock.calls).toHaveLength(1);
      const [message, ctx] = recordedLogCall(logSpy);
      expect(message).toBe("Matching browse denied: no student record for caller");
      expect(ctx).toEqual({
        code: "STUDENT_NOT_FOUND",
        entity: "students",
        entityId: teacherUser.id,
        locale: LOCALE_EN,
      });
    });
  });

  // ─── Tier 2: boundary — language-token gates ─────────────────────────

  test.each([
    { label: "exactly 50 characters is accepted", token: "x".repeat(50), denied: false },
    { label: "51 characters is rejected", token: "x".repeat(51), denied: true },
    { label: "whitespace-only token is rejected", token: "   ", denied: true },
    { label: "empty token is rejected", token: "", denied: true },
    { label: "double-quote token is rejected", token: 'a"b', denied: true },
    { label: "backslash token is rejected", token: "a\\b", denied: true },
  ])("language token gate: $label", async ({ token, denied }) => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, { primaryLanguage: token });
      const { captured, stop } = captureMatchingFilters();
      silenceDomainLog();

      if (denied) {
        const error = await expectRepoError(() =>
          TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx)
        );
        expectDomainDenial(error, "VALIDATION", errorsFor(LOCALE_EN).validation);
        // The gate fires BEFORE any pattern is built or query executed.
        expect(captured).toHaveLength(0);
      } else {
        await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx);
        expect(captured).toHaveLength(1);
        expect(captured.at(0)?.languagePattern).toBe(expectedPattern(token));
      }
      stop();
    });
  });

  test("a unicode language token flows through normalization into the filter and the read", async () => {
    await runInRollback(async tx => {
      const token = uniqueLanguageToken("français");
      const callerId = await createStudentCaller(tx, { primaryLanguage: token.toUpperCase() });
      const fluent = await createDirectoryTeacher(tx, {
        recitations: [RARE_READING],
        subjects: [HIFZ_SUBJECT],
        languages: [token],
      });
      const stranger = await createDirectoryTeacher(tx, {
        recitations: [RARE_READING],
        subjects: [HIFZ_SUBJECT],
        languages: [uniqueLanguageToken("deutsch")],
      });

      const page = await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx);

      // The stored token was lowercased on the way in; the pattern matches
      // the normalized form, so only the fluent teacher surfaces.
      expect(page.items.map(item => item.id)).toEqual([fluent]);
      expect(page.total).toBe(1);
      expect(page.items.map(item => item.id)).not.toContain(stranger);
      expect(page.items.at(0)?.languages).toEqual([token]);
    });
  });

  // ─── Tier 2: boundary — ordering, pagination, envelope ───────────────

  test("unrated same-country teachers sort after rated ones and before higher-rated foreigners", async () => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, {
        primaryLanguage: "arabic",
        country: "Egypt",
        countryCode: "EG",
      });
      const [rated, unrated, foreign] = await Promise.all([
        createDirectoryTeacher(tx, {
          recitations: [RARE_READING],
          subjects: [HIFZ_SUBJECT],
          averageRating: "4.00",
          country: "Egypt",
          countryCode: "EG",
        }),
        createDirectoryTeacher(tx, {
          recitations: [RARE_READING],
          subjects: [HIFZ_SUBJECT],
          averageRating: null,
          country: "Egypt",
          countryCode: "EG",
        }),
        createDirectoryTeacher(tx, {
          recitations: [RARE_READING],
          subjects: [HIFZ_SUBJECT],
          averageRating: "5.00",
          country: "Morocco",
          countryCode: "MA",
        }),
      ]);

      const page = await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx);

      expect(page.items.map(item => item.id)).toEqual([rated, unrated, foreign]);
      expect(page.total).toBe(3);
      expect(page.page).toBe(DEFAULT_PAGE);
      expect(page.pageSize).toBe(DEFAULT_PAGE_SIZE);
      expect(page.pageCount).toBe(1);
      // The unrated card keeps its honest null rating (never zero).
      expect(page.items.at(1)?.averageRating).toBeNull();
    });
  });

  test("a page beyond the last is an honest empty page with the unchanged total", async () => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, { primaryLanguage: "arabic" });
      await Promise.all([
        createDirectoryTeacher(tx, { recitations: [RARE_READING], subjects: [HIFZ_SUBJECT], averageRating: "3.00" }),
        createDirectoryTeacher(tx, { recitations: [RARE_READING], subjects: [HIFZ_SUBJECT], averageRating: "4.00" }),
      ]);

      const page = await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(2, 2), LOCALE_EN, tx);

      expect(page.items).toEqual([]);
      expect(page.total).toBe(2);
      expect(page.page).toBe(2);
      expect(page.pageSize).toBe(2);
      expect(page.pageCount).toBe(1);
    });
  });

  test("explicit bounds resolve the offset window (page 2 of size 1 → the second candidate)", async () => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, { primaryLanguage: "arabic" });
      const [lowerRated, higherRated] = await Promise.all([
        createDirectoryTeacher(tx, { recitations: [RARE_READING], subjects: [HIFZ_SUBJECT], averageRating: "3.00" }),
        createDirectoryTeacher(tx, { recitations: [RARE_READING], subjects: [HIFZ_SUBJECT], averageRating: "4.00" }),
      ]);

      const page = await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(2, 1), LOCALE_EN, tx);

      // Rating DESC puts the higher-rated candidate first; page 2 (offset 1)
      // therefore serves the lower-rated one.
      expect(page.items.map(item => item.id)).toEqual([lowerRated]);
      expect(page.items.map(item => item.id)).not.toContain(higherRated);
      expect(page.pageCount).toBe(2);
    });
  });

  test("out-of-range page bounds deny with the localized VALIDATION", async () => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, { primaryLanguage: "arabic" });
      silenceDomainLog();

      const zeroPage = await expectRepoError(() =>
        TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(0, null), LOCALE_EN, tx)
      );
      expectDomainDenial(zeroPage, "VALIDATION", errorsFor(LOCALE_EN).validation);

      const oversizedPageSize = await expectRepoError(() =>
        TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(1, 101), LOCALE_EN, tx)
      );
      expectDomainDenial(oversizedPageSize, "VALIDATION", errorsFor(LOCALE_EN).validation);
    });
  });

  test("a corrupt stored payload degrades its own field and never fails the page", async () => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, { primaryLanguage: "arabic" });
      // Eligibility matches on the RAW recitation/subject tokens; the
      // languages payload is unparseable — the projection degrades to an
      // empty array instead of failing the read.
      const corrupt = await createDirectoryTeacher(tx, {
        recitations: [RARE_READING],
        subjects: [HIFZ_SUBJECT],
      });
      await tx.update(teacher).set({ languages: "{not-json" }).where(eq(teacher.id, corrupt));

      const page = await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx);

      expect(page.items.map(item => item.id)).toEqual([corrupt]);
      expect(page.items.at(0)?.languages).toEqual([]);
      expect(page.items.at(0)?.subjects).toEqual([HIFZ_SUBJECT]);
      expect(page.items.at(0)?.recitations).toEqual([RARE_READING]);
    });
  });

  test("a corrupt certification payload excludes the teacher (fail-closed eligibility)", async () => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, { primaryLanguage: "arabic" });
      // The unclosed array never completes the quoted token, so the raw
      // payload cannot confirm certification — the teacher must not surface.
      const uncertified = await createDirectoryTeacher(tx, { subjects: [HIFZ_SUBJECT] });
      await tx
        .update(teacher)
        .set({ recitations: `["${RARE_READING}` })
        .where(eq(teacher.id, uncertified));

      const page = await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx);

      expect(page.items.map(item => item.id)).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.pageCount).toBe(0);
    });
  });

  // ─── Tier 2: boundary — hostile locales ──────────────────────────────

  test.each([LOCALE_EMPTY, LOCALE_UNKNOWN])(
    "hostile locale (%s) falls back to the default-locale copy (caller-miss denial)",
    async hostileLocale => {
      await runInRollback(async tx => {
        const absentId = await absentCallerId(tx);
        silenceDomainLog();

        const error = await expectRepoError(() =>
          TeacherMatchingService.browseAvailableTeachers(absentId, rareBrowse(), hostileLocale, tx)
        );

        expectDomainDenial(error, "STUDENT_NOT_FOUND", errorsFor(defaultLocale).studentHandshakeNotFound);
        expect(errorsFor(defaultLocale).studentHandshakeNotFound).not.toBe(
          errorsFor(LOCALE_EN).studentHandshakeNotFound
        );
      });
    }
  );

  test("the Arabic denial copy round-trips intact (no mojibake)", async () => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, { primaryLanguage: "arabic" });
      silenceDomainLog();

      const error = await expectRepoError(() =>
        TeacherMatchingService.browseAvailableTeachers(callerId, hostileInput({ intent: "evaluation" }), LOCALE_AR, tx)
      );

      expectDomainDenial(error, "VALIDATION", errorsFor(LOCALE_AR).validation);
      expect(error.message).toMatch(/[\u0600-\u06FF]/u);
    });
  });

  // ─── Tier 3: chaos — parallel reads + snapshot semantics ─────────────

  test(`parallel browses (${PARALLEL_BROWSE_COUNT}× via Promise.allSettled) resolve consistently — the read path is race-free`, async () => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, {
        primaryLanguage: "arabic",
        country: "Egypt",
        countryCode: "EG",
      });
      const [rated, unrated] = await Promise.all([
        createDirectoryTeacher(tx, {
          recitations: [RARE_READING],
          subjects: [HIFZ_SUBJECT],
          averageRating: "4.00",
          country: "Egypt",
          countryCode: "EG",
        }),
        createDirectoryTeacher(tx, {
          recitations: [RARE_READING],
          subjects: [HIFZ_SUBJECT],
          averageRating: null,
          country: "Egypt",
          countryCode: "EG",
        }),
      ]);
      silenceDomainLog();

      const settled = await Promise.allSettled(
        Array.from({ length: PARALLEL_BROWSE_COUNT }, () =>
          TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx)
        )
      );

      expect(settled.every(outcome => outcome.status === "fulfilled")).toBe(true);
      const firstPage = settled.at(0);
      if (firstPage?.status !== "fulfilled") {
        throw new Error("expected the first parallel browse to resolve");
      }
      const expectedIds = firstPage.value.items.map(item => item.id);
      expect(expectedIds).toEqual([rated, unrated]);
      for (const outcome of settled) {
        if (outcome.status === "fulfilled") {
          expect(outcome.value.items.map(item => item.id)).toEqual(expectedIds);
          expect(outcome.value.total).toBe(2);
        }
      }
    });
  });

  test("a toggle during the browse window is a snapshot: the returned page never mutates, the next browse re-reads", async () => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, { primaryLanguage: "arabic" });
      const visible = await createDirectoryTeacher(tx, { recitations: [RARE_READING], subjects: [HIFZ_SUBJECT] });

      const pageBefore = await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx);
      expect(pageBefore.items.map(item => item.id)).toEqual([visible]);

      // The teacher goes offline AFTER the page was captured (the race
      // window). The captured page is a point-in-time snapshot: it keeps
      // the teacher; the NEXT browse re-reads committed state and drops him.
      await tx.update(teacher).set({ isOnline: false }).where(eq(teacher.id, visible));

      expect(pageBefore.items.map(item => item.id)).toEqual([visible]);
      const pageAfter = await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx);
      expect(pageAfter.items.map(item => item.id)).toEqual([]);
      expect(pageAfter.total).toBe(0);
    });
  });

  // ─── Tier 4: security — wildcard escape at the single escape point ───

  test("a `%` wildcard token is escaped and matches only literally", async () => {
    await runInRollback(async tx => {
      const token = `50${randomUUID().replaceAll("-", "").slice(0, 6)}%`;
      const callerId = await createStudentCaller(tx, { primaryLanguage: token });
      const literal = await createDirectoryTeacher(tx, {
        recitations: [RARE_READING],
        subjects: [HIFZ_SUBJECT],
        languages: [token],
      });
      // Without escaping, the trailing `%` would widen the pattern to match
      // ANY teacher whose payload starts with the same prefix.
      const widened = await createDirectoryTeacher(tx, {
        recitations: [RARE_READING],
        subjects: [HIFZ_SUBJECT],
        languages: [`${token.slice(0, -1)}xyz`],
      });

      const { captured, stop } = captureMatchingFilters();
      const page = await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx);
      stop();

      expect(captured.at(0)?.languagePattern).toBe(expectedPattern(token));
      expect(page.items.map(item => item.id)).toEqual([literal]);
      expect(page.items.map(item => item.id)).not.toContain(widened);
    });
  });

  test("a `_` wildcard token is escaped and matches only literally", async () => {
    await runInRollback(async tx => {
      const token = `a_${randomUUID().replaceAll("-", "").slice(0, 6)}b`;
      const callerId = await createStudentCaller(tx, { primaryLanguage: token });
      const literal = await createDirectoryTeacher(tx, {
        recitations: [RARE_READING],
        subjects: [HIFZ_SUBJECT],
        languages: [token],
      });
      // Without escaping, the `_` would match any single character — the
      // widened teacher differs exactly there and must NOT surface.
      const widened = await createDirectoryTeacher(tx, {
        recitations: [RARE_READING],
        subjects: [HIFZ_SUBJECT],
        languages: [token.replace("_", "x")],
      });

      const page = await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx);

      expect(page.items.map(item => item.id)).toEqual([literal]);
      expect(page.items.map(item => item.id)).not.toContain(widened);
    });
  });

  // ─── Tier 4: security — smuggled fields never reach the query ────────

  test("smuggled id fields on the input are dropped: the filters carry exactly the five whitelisted keys", async () => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, { primaryLanguage: "arabic" });
      const { captured, stop } = captureMatchingFilters();
      silenceDomainLog();

      await TeacherMatchingService.browseAvailableTeachers(
        callerId,
        hostileInput({ studentId: 424242, teacherId: 999999, userId: 1, isBlocked: false }),
        LOCALE_EN,
        tx
      );
      stop();

      expect(captured).toHaveLength(1);
      const filters = captured.at(0);
      expect(new Set(Object.keys(filters ?? {}))).toEqual(
        new Set(["recitationPattern", "subjectPattern", "languagePattern", "studentCountryCode", "studentCountryText"])
      );
    });
  });

  test("the happy path logs NOTHING and any denial stays bounded", async () => {
    await runInRollback(async tx => {
      const callerId = await createStudentCaller(tx, { primaryLanguage: "arabic" });
      const absentId = await absentCallerId(tx);
      await createDirectoryTeacher(tx, { recitations: [RARE_READING], subjects: [HIFZ_SUBJECT] });

      const logSpy = silenceDomainLog();
      await TeacherMatchingService.browseAvailableTeachers(callerId, rareBrowse(), LOCALE_EN, tx);
      expect(logSpy.mock.calls).toHaveLength(0);

      // A caller-miss denial adds exactly one bounded entry — no PII, no
      // payload echo (the bounded shape is pinned on the denial tests).
      const denied = await expectRepoError(() =>
        TeacherMatchingService.browseAvailableTeachers(absentId, rareBrowse(), LOCALE_AR, tx)
      );
      expect(denied).toBeInstanceOf(NotFoundError);
      expect(logSpy.mock.calls).toHaveLength(1);
    });
  });

  // ─── Tier 4: security — static source pins ───────────────────────────

  const SERVICE_FILE = join(import.meta.dir, "./teacher-matching.service.ts");
  const serviceSource = readFileSync(SERVICE_FILE, "utf8");

  test("source: no spread of any input/row object reaches a builder (BOPLA)", () => {
    expect(/\.\.\.(input|caller|student|context|row|rows)\b/.test(serviceSource)).toBe(false);
  });

  test("source: escapeLikeWildcards is imported exactly once — the single escape point", () => {
    expect(serviceSource.split("escape-like-wildcards").length - 1).toBe(1);
  });

  test("source: pure read — no transaction of its own, no console, no plan artifacts", () => {
    expect(serviceSource.includes("withTransaction")).toBe(false);
    expect(serviceSource.includes("console.")).toBe(false);
    expect(/REQ-\d|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(serviceSource)).toBe(false);
  });

  test("source: the projection maps member-by-member through the fail-closed parsers", () => {
    const start = serviceSource.indexOf("function toMatchingItem(");
    const end = serviceSource.indexOf("\n}", start);
    const projection = serviceSource.slice(start, end);
    expect(/parseSubjectsJson/.test(projection)).toBe(true);
    expect(/parseTeacherRecitations/.test(projection)).toBe(true);
    expect(/parseTeacherLanguages/.test(projection)).toBe(true);
    expect(/parseAverageRating/.test(projection)).toBe(true);
    expect(/isOnline: row\.isOnline \?\? false/.test(projection)).toBe(true);
  });
});
