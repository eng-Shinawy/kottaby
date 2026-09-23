/**
 * Admin directory-listing test kit — the shared harness of the three
 * directory suites (`student-directory` / `teacher-directory` /
 * `teacher-applicant-directory`).
 *
 * Extracted so the preamble (locale, translated error copy, anonymous-actor
 * sentinel, log silencer, admin-actor provisioning) and the rejection
 * ladders (pagination ValidationError, BFLA 401/403) cannot drift apart
 * across the three suites — per `backend/services/AGENTS.md` ("shared
 * helpers → `shared/` modules under the owning domain") and
 * `backend/db/test/AGENTS.md` ("aggressively avoid code duplication").
 *
 * TEST-ONLY module: imports `bun:test` and the DB test infrastructure and
 * must never be imported from production code (services, resolvers, jobs).
 */

import { expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createTestAdmin, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { DBTransaction, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Fixed test locale shared by every directory suite. */
export const DIRECTORY_TEST_LOCALE = "en";

/** Translated error copy resolved once for the shared rejection assertions. */
export const DIRECTORY_T_ERRORS = getServerTranslations(DIRECTORY_TEST_LOCALE).errorsTranslations;

/** Sentinel `actorId` value expressing an anonymous caller. */
const ANONYMOUS_ACTOR_ID = 0;

/** Silences `logger.logDomainError` so test stdout stays compact. */
export function silenceDomainLog(): ReturnType<typeof spyOn> {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

/**
 * Provisions an admin actor (users row + admin role-child row) for use as
 * the `actorId` of subsequent service calls. Returns the user row.
 */
export async function provisionAdminActor(tx: DBTransaction): Promise<UserSelectType> {
  const user = await createTestUser(tx, { role: "admin" });
  await createTestAdmin(tx, user.id);
  return user;
}

/**
 * Asserts the call rejects with `ValidationError` — and, when
 * `expectedMessage` is supplied, with EXACTLY that translated copy
 * (`tErrors.validation`). Returns the typed error for follow-up asserts.
 */
export async function expectValidationError(
  fn: () => Promise<unknown>,
  expectedMessage?: string
): Promise<ValidationError> {
  const error = await expectRepoError(fn);
  if (!(error instanceof ValidationError)) {
    throw new Error(`expectValidationError: expected ValidationError, got ${typeName(error)} — ${error.message}`);
  }
  if (expectedMessage !== undefined) {
    expect(error.message).toBe(expectedMessage);
  }
  return error;
}

/**
 * Asserts the call rejects with `UnauthorizedError` carrying the translated
 * 401 copy — the BFLA anonymous-actor denial contract.
 */
async function expectUnauthorized(fn: () => Promise<unknown>): Promise<UnauthorizedError> {
  const error = await expectRepoError(fn);
  if (!(error instanceof UnauthorizedError)) {
    throw new Error(`expectUnauthorized: expected UnauthorizedError, got ${typeName(error)} — ${error.message}`);
  }
  expect(error.message).toContain(DIRECTORY_T_ERRORS.unauthorized);
  return error;
}

/**
 * Asserts the call rejects with `ForbiddenError` carrying the translated
 * 403 copy — the BFLA non-admin-actor denial contract.
 */
async function expectForbidden(fn: () => Promise<unknown>): Promise<ForbiddenError> {
  const error = await expectRepoError(fn);
  if (!(error instanceof ForbiddenError)) {
    throw new Error(`expectForbidden: expected ForbiddenError, got ${typeName(error)} — ${error.message}`);
  }
  expect(error.message).toContain(DIRECTORY_T_ERRORS.forbidden);
  return error;
}

/** Human-readable constructor name of a caught error for failure messages. */
function typeName(error: Error): string {
  return error.constructor?.name ?? "Error";
}

/** Shape shared by every directory listing envelope (list + export rows). */
interface PageEnvelope {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  items: readonly unknown[];
}

/** The envelope slice the page-slice/empty asserts read (named alias — no inline union). */
type PageSliceKeys = "total" | "pageCount" | "items";

/**
 * Asserts the page-envelope echo: requested page/pageSize round-trip plus
 * an honestly populated total/pageCount floor (≥ `totalMin`, default 1).
 */
export function expectPageEnvelopeEcho(
  page: PageEnvelope,
  expected: { page: number; pageSize: number; totalMin?: number }
): void {
  expect(page.page).toBe(expected.page);
  expect(page.pageSize).toBe(expected.pageSize);
  const floor = expected.totalMin ?? 1;
  expect(page.total).toBeGreaterThanOrEqual(floor);
  expect(page.pageCount).toBeGreaterThanOrEqual(floor);
}

/** Asserts one page slice: honest total, ceiling pageCount, exact item count. */
function expectPageSlice(
  page: Pick<PageEnvelope, PageSliceKeys>,
  expected: { total: number; pageCount: number; items: number }
): void {
  expect(page.total).toBe(expected.total);
  expect(page.pageCount).toBe(expected.pageCount);
  expect(page.items).toHaveLength(expected.items);
}

/** Asserts the honest empty listing envelope (items [], total 0, pageCount 0). */
function expectHonestEmptyListing(page: Pick<PageEnvelope, PageSliceKeys>): void {
  expect(page.items).toEqual([]);
  expect(page.total).toBe(0);
  expect(page.pageCount).toBe(0);
}

/** Shape shared by every directory export envelope. */
interface ExportEnvelope {
  total: number;
  truncated: boolean;
  rows: readonly unknown[];
}

/**
 * Asserts the export-envelope core: honest full filtered total, exact row
 * count, truncated flag (default `false`).
 */
export function expectExportEnvelope(
  envelope: ExportEnvelope,
  expected: { total: number; rows: number; truncated?: boolean }
): void {
  expect(envelope.total).toBe(expected.total);
  expect(envelope.truncated).toBe(expected.truncated ?? false);
  expect(envelope.rows).toHaveLength(expected.rows);
}

/**
 * Registers the four pagination-bounds tests (page 0 / negative, pageSize
 * 101, pageSize undefined → default 25) against the suite's `list` call.
 * The `list` callback closes over the suite's service + filters and receives
 * the live rollback transaction plus the provisioned admin id. MUST be
 * invoked inside the suite's pagination `describe` so the tests join it.
 */
export function registerPaginationValidationContract(config: {
  list: (
    tx: DBTransaction,
    actorId: number,
    page: number,
    pageSize: number | undefined
  ) => Promise<{ pageSize: number }>;
}): void {
  test("page = 0 → ValidationError(VALIDATION)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      silenceDomainLog();
      await expectValidationError(() => config.list(tx, admin.id, 0, 25), DIRECTORY_T_ERRORS.validation);
    });
  });

  test("page = negative → ValidationError(VALIDATION)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      silenceDomainLog();
      await expectValidationError(() => config.list(tx, admin.id, -5, 25));
    });
  });

  test("pageSize = 101 → ValidationError(VALIDATION)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      silenceDomainLog();
      await expectValidationError(() => config.list(tx, admin.id, 1, 101));
    });
  });

  test("pageSize = undefined defaults to 25", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const page = await config.list(tx, admin.id, 1, undefined);
      expect(page.pageSize).toBe(25);
    });
  });
}

/**
 * Asserts the entity with `id` is present among the page items and returns
 * it for follow-up field assertions.
 */
export function expectListedItem<T extends { id: number }>(page: { items: readonly T[] }, id: number): T {
  const found = page.items.find(item => item.id === id);
  expect(found).not.toBeUndefined();
  if (found === undefined) {
    throw new Error("expectListedItem: the item was not listed (expect() above reports the detail)");
  }
  return found;
}

/** The row-bearing view the export-ids assert needs. */
interface ExportRowEnvelope {
  readonly rows: readonly { id: number }[];
}

/** Asserts the export rows carry EXACTLY the given ids (order-insensitive). */
export function expectExportRowIds(envelope: ExportRowEnvelope, expectedIds: number[]): void {
  expect(envelope.rows.map(row => row.id).toSorted((a, b) => a - b)).toEqual(expectedIds.toSorted((a, b) => a - b));
}

/**
 * Registers the two page-math tests (pageCount ceiling over 3 seeded rows;
 * no-match search → honest empty envelope) against the suite's `list` call.
 * The `seedThree` callback seeds three same-prefix rows with the domain's
 * own entity factory. MUST be invoked inside the suite's pagination
 * `describe` so the tests join it.
 */
export function registerPaginationCountingContract(config: {
  seedThree: (tx: DBTransaction, prefix: string) => Promise<unknown>;
  list: (
    tx: DBTransaction,
    actorId: number,
    filters: { search: string },
    page: number,
    pageSize: number
  ) => Promise<Pick<PageEnvelope, PageSliceKeys>>;
}): void {
  test("pageCount is the ceiling of total ÷ pageSize", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const prefix = `DirPaged${randomUUID().slice(0, 8)}`;
      // Three mutually independent user+role-child pairs — seeded
      // concurrently. Each pair's user→role-child FK order stays sequenced
      // inside the domain factory; no dependency exists across pairs.
      await config.seedThree(tx, prefix);

      const twoPer = await config.list(tx, admin.id, { search: prefix }, 1, 2);
      expectPageSlice(twoPer, { total: 3, pageCount: 2, items: 2 });

      const threePer = await config.list(tx, admin.id, { search: prefix }, 1, 3);
      expectPageSlice(threePer, { total: 3, pageCount: 1, items: 3 });
    });
  });

  test("no-match search → honest empty envelope (total 0, pageCount 0)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const page = await config.list(tx, admin.id, { search: `no-match-${randomUUID()}` }, 1, 25);
      expectHonestEmptyListing(page);
    });
  });
}

/**
 * Registers the BFLA denial pair (anonymous actor → 401; non-admin actor →
 * 403) against the suite's single operation call. The `call` callback closes
 * over the suite's service + operation and receives the live rollback
 * transaction plus the actor id to impersonate. MUST be invoked inside the
 * suite's `defense-in-depth (BFLA)` describe so the tests join it.
 */
export function registerBflaDenials(config: { call: (tx: DBTransaction, actorId: number) => Promise<unknown> }): void {
  test("anonymous actor (id=0) → UnauthorizedError; zero writes", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      await expectUnauthorized(() => config.call(tx, ANONYMOUS_ACTOR_ID));
    });
  });

  test("non-admin actor → ForbiddenError; zero writes", async () => {
    await runInRollback(async tx => {
      const nonAdmin = await createTestUser(tx, { role: "student" });
      silenceDomainLog();
      await expectForbidden(() => config.call(tx, nonAdmin.id));
    });
  });
}
