/**
 * PlanCatalogService self-tests — validation, lifecycle transitions, and the
 * localized rejection contract against the live `kottab_test` PostgreSQL
 * instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every case runs inside `runInRollback`; `tx` is passed to EVERY
 *    service/repository/entity-setup call, so nothing commits and the
 *    non-transactional pool path stays unexercised here.
 *  - Entities ONLY via `entity-setup.ts` helpers (collision-proof titles);
 *    boundary values arrive through deliberate `planSubmitInput` overrides.
 *  - Rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and appears nowhere.
 *  - Translated-message assertions use literals computed in-file from
 *    `getServerTranslations` — never raw keys, never hardcoded copy.
 *  - The logging contract is verified via logger spies; no console output.
 *
 * Coverage map (4 tiers):
 *  - Tier 1 (branch/statement): create/update/status happy paths; both
 *    list views over the single active predicate; missing-id rejects for
 *    update and status change (probe path); BOTH idempotency conflicts;
 *    the aggregated multi-field validation payload; domain-rejection
 *    logging plus the audit seam markers on success.
 *  - Tier 2 (boundary): the full field matrix — title empty /
 *    whitespace-only / 255 (pass) / 256 (fail); sessionCount 0 / 1 / −1 /
 *    non-integer; price "0.00" / "-0.01" / "abc" / "1.005" /
 *    "99999999.99" (pass) / "100000000.00"; currency "EGP" / "egp" /
 *    "EG"; intervalDays 0 / 1; empty patch; non-positive/non-integer ids.
 *  - Tier 3 (chaos): `Promise.allSettled` double-deactivation — exactly one
 *    success plus one `PLAN_ALREADY_INACTIVE` with the row transitioned
 *    exactly once; concurrent field patches converge last-write-wins
 *    without error; deactivate/reactivate round-trip.
 *  - Tier 4 (security/i18n): smuggled lifecycle/identity keys on create and
 *    update payloads are ignored by construction; a database CHECK
 *    violation raised behind validating input is translated through the
 *    driver cause chain into the matching localized field error (no SQL or
 *    constraint names in any message); duplicate titles both succeed;
 *    localized rejections switch between "en" and "ar".
 *  - Tier 5 (coverage closure, 5.3): every remaining branch of the service
 *    gets a dedicated test — updatePlan's supplied-field validation reject
 *    and partial-patch title-absent path; the price and interval_days
 *    constraint-family mappings; and BOTH untranslated-rethrow paths
 *    (unrecognized constraint name, non-check driver error).
 */

import { describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { PlanRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ConflictError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import type { PlanSubmitInput, PlanUpdateInput } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const enErrors = getServerTranslations("en").errorsTranslations;
const arErrors = getServerTranslations("ar").errorsTranslations;

/** Valid submission baseline; overrides merge last for boundary cells. */
function planSubmitInput(overrides?: Partial<PlanSubmitInput>): PlanSubmitInput {
  return {
    title: `Service Plan ${randomUUID()}`,
    sessionCount: 5,
    price: "10.00",
    currency: "EGP",
    intervalDays: 30,
    ...overrides,
  };
}

/**
 * Asserts the call rejects with the aggregated `ValidationError` and that
 * its field payload carries the expected `{field, code}` entry (or that the
 * payload is absent entirely when `field` is `null`). Returns the caught
 * error so callers can additionally assert the localized top-level message.
 */
async function expectValidationError(
  fn: () => Promise<unknown>,
  field: string | null,
  fieldCode: string,
  expectedCode = "VALIDATION"
): Promise<ValidationError> {
  const error = await expectRepoError(fn);
  if (!(error instanceof ValidationError)) {
    throw new Error(`expected ValidationError but caught ${error.name}`);
  }
  expect(error.code).toBe(expectedCode);
  if (field === null) {
    expect(error.fields).toBeUndefined();
  } else {
    const entry = error.fields?.find(item => item.field === field);
    expect(entry?.code).toBe(fieldCode);
    expect(entry?.message.length ?? 0).toBeGreaterThan(0);
  }
  return error;
}

/** Asserts the call rejects with a `NotFoundError` carrying the entity code. */
async function expectNotFoundError(fn: () => Promise<unknown>, expectedMessage: string): Promise<void> {
  const error = await expectRepoError(fn);
  if (!(error instanceof NotFoundError)) {
    throw new Error(`expected NotFoundError but caught ${error.name}`);
  }
  expect(error.code).toBe("PLAN_NOT_FOUND");
  expect(error.message).toBe(expectedMessage);
}

/** Asserts the call rejects with a `ConflictError` carrying the given code. */
async function expectConflictError(fn: () => Promise<unknown>, code: string, expectedMessage: string): Promise<void> {
  const error = await expectRepoError(fn);
  if (!(error instanceof ConflictError)) {
    throw new Error(`expected ConflictError but caught ${error.name}`);
  }
  expect(error.code).toBe(code);
  expect(error.message).toBe(expectedMessage);
}

describe("PlanCatalogService", () => {
  describe("Tier 1 — happy paths and branch coverage", () => {
    test("createPlan persists a validated plan with server-owned lifecycle defaults", async () => {
      await runInRollback(async tx => {
        const created = await PlanCatalogService.createPlan(
          planSubmitInput({ title: `  Trimmed Title ${randomUUID()}  ` }),
          "en",
          undefined,
          tx
        );

        expect(created.id).toBeGreaterThan(0);
        expect(created.title).toMatch(/^Trimmed Title /);
        expect(created.isActive).toBe(true);
        expect(created.deactivatedAt).toBeNull();
        expect(created.createdAt).toBeInstanceOf(Date);
        expect(created.updatedAt).toBeInstanceOf(Date);
      });
    });

    test("updatePlan patches supplied fields and leaves lifecycle columns untouched", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);
        const updated = await PlanCatalogService.updatePlan(
          plan.id,
          { title: `Edited ${randomUUID()}`, price: "42.50" },
          "en",
          undefined,
          tx
        );

        expect(updated.id).toBe(plan.id);
        expect(updated.title).toMatch(/^Edited /);
        expect(updated.price).toBe("42.50");
        expect(updated.sessionCount).toBe(plan.sessionCount);
        expect(updated.isActive).toBe(true);
        expect(updated.deactivatedAt).toBeNull();
      });
    });

    test("setPlanActiveStatus moves the lifecycle pair in both directions (round-trip)", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);

        const deactivated = await PlanCatalogService.setPlanActiveStatus(plan.id, false, "en", undefined, tx);
        expect(deactivated.isActive).toBe(false);
        expect(deactivated.deactivatedAt).toBeInstanceOf(Date);

        const reactivated = await PlanCatalogService.setPlanActiveStatus(deactivated.id, true, "en", undefined, tx);
        expect(reactivated.isActive).toBe(true);
        expect(reactivated.deactivatedAt).toBeNull();
      });
    });

    test("listActiveCatalog serves active rows only while listForAdmin covers both views", async () => {
      await runInRollback(async tx => {
        const active = await createTestPlan(tx, { title: `Active ${randomUUID()}` });
        const retired = await createTestPlan(tx, {
          title: `Retired ${randomUUID()}`,
          isActive: false,
          deactivatedAt: new Date("2024-06-01T00:00:00.000Z"),
        });

        const catalogIds = (await PlanCatalogService.listActiveCatalog("en", tx)).map(row => row.id);
        expect(catalogIds).toContain(active.id);
        expect(catalogIds).not.toContain(retired.id);

        const adminIds = (await PlanCatalogService.listForAdmin(true, "en", tx)).map(row => row.id);
        expect(adminIds).toContain(active.id);
        expect(adminIds).toContain(retired.id);

        const filteredIds = (await PlanCatalogService.listForAdmin(false, "en", tx)).map(row => row.id);
        expect(filteredIds).toContain(active.id);
        expect(filteredIds).not.toContain(retired.id);
      });
    });

    test("updatePlan on a missing plan rejects with PLAN_NOT_FOUND", async () => {
      await runInRollback(async tx => {
        await expectNotFoundError(
          () => PlanCatalogService.updatePlan(999_999_999, { title: "Ghost" }, "en", undefined, tx),
          enErrors.planNotFound
        );
      });
    });

    test("setPlanActiveStatus on a missing plan rejects with PLAN_NOT_FOUND (probe path)", async () => {
      await runInRollback(async tx => {
        await expectNotFoundError(
          () => PlanCatalogService.setPlanActiveStatus(999_999_999, false, "en", undefined, tx),
          enErrors.planNotFound
        );
      });
    });

    test("reactivating an already-active plan conflicts with PLAN_ALREADY_ACTIVE", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);
        await expectConflictError(
          () => PlanCatalogService.setPlanActiveStatus(plan.id, true, "en", undefined, tx),
          "PLAN_ALREADY_ACTIVE",
          enErrors.planAlreadyActive
        );
      });
    });

    test("deactivating an already-inactive plan conflicts with PLAN_ALREADY_INACTIVE", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx, { isActive: false, deactivatedAt: new Date() });
        await expectConflictError(
          () => PlanCatalogService.setPlanActiveStatus(plan.id, false, "en", undefined, tx),
          "PLAN_ALREADY_INACTIVE",
          enErrors.planAlreadyInactive
        );
      });
    });

    test("createPlan aggregates every offending field into ONE ValidationError", async () => {
      await runInRollback(async tx => {
        const error = await expectValidationError(
          () =>
            PlanCatalogService.createPlan(
              planSubmitInput({ title: "", sessionCount: 0, price: "abc", currency: "egp", intervalDays: 0 }),
              "en",
              undefined,
              tx
            ),
          "title",
          "PLAN_TITLE_REQUIRED"
        );

        expect(error.message).toBe(enErrors.planTitleRequired);
        const codes = error.fields?.map(item => item.code);
        expect(codes).toEqual([
          "PLAN_TITLE_REQUIRED",
          "PLAN_SESSION_COUNT_INVALID",
          "PLAN_PRICE_INVALID",
          "PLAN_CURRENCY_INVALID",
          "PLAN_INTERVAL_DAYS_INVALID",
        ]);
        expect(error.fields?.every(item => item.message.length > 0)).toBe(true);
      });
    });

    test("success emits audit seams only, rejections log via logDomainError only", async () => {
      await runInRollback(async tx => {
        const infoSpy = spyOn(logger, "info");
        const domainSpy = spyOn(logger, "logDomainError");
        try {
          const created = await PlanCatalogService.createPlan(planSubmitInput(), "en", undefined, tx);
          expect(domainSpy).not.toHaveBeenCalled();
          const seamCall = infoSpy.mock.calls.at(-1);
          expect(seamCall?.[1]).toEqual({ code: "PLAN_CREATED", entityId: created.id });

          await PlanCatalogService.setPlanActiveStatus(created.id, false, "en", undefined, tx);
          const statusSeam = infoSpy.mock.calls.at(-1);
          expect(statusSeam?.[1]).toEqual({ code: "PLAN_DEACTIVATED", entityId: created.id });

          await expectValidationError(
            () => PlanCatalogService.createPlan(planSubmitInput({ title: "" }), "en", undefined, tx),
            "title",
            "PLAN_TITLE_REQUIRED"
          );
          const rejectionCall = domainSpy.mock.calls.at(-1);
          expect(rejectionCall?.[1]).toEqual({ code: "VALIDATION", entity: "plans" });
        } finally {
          infoSpy.mockRestore();
          domainSpy.mockRestore();
        }
      });
    });
  });

  describe("Tier 2 — boundary matrix", () => {
    test("title: empty and whitespace-only rejected, 255 passes, 256 rejected", async () => {
      await runInRollback(async tx => {
        const longest = await PlanCatalogService.createPlan(
          planSubmitInput({ title: "a".repeat(255) }),
          "en",
          undefined,
          tx
        );
        expect(longest.title).toBe("a".repeat(255));

        await expectValidationError(
          () => PlanCatalogService.createPlan(planSubmitInput({ title: "" }), "en", undefined, tx),
          "title",
          "PLAN_TITLE_REQUIRED"
        );
        await expectValidationError(
          () => PlanCatalogService.createPlan(planSubmitInput({ title: "   " }), "en", undefined, tx),
          "title",
          "PLAN_TITLE_REQUIRED"
        );
        await expectValidationError(
          () => PlanCatalogService.createPlan(planSubmitInput({ title: "b".repeat(256) }), "en", undefined, tx),
          "title",
          "PLAN_TITLE_TOO_LONG"
        );
      });
    });

    test("sessionCount: 1 passes, 0 / −1 / non-integer rejected", async () => {
      await runInRollback(async tx => {
        const minimal = await PlanCatalogService.createPlan(planSubmitInput({ sessionCount: 1 }), "en", undefined, tx);
        expect(minimal.sessionCount).toBe(1);

        const rejected = await Promise.all(
          [0, -1, 2.5].map(sessionCount =>
            expectValidationError(
              () => PlanCatalogService.createPlan(planSubmitInput({ sessionCount }), "en", undefined, tx),
              "sessionCount",
              "PLAN_SESSION_COUNT_INVALID"
            )
          )
        );
        expect(rejected).toHaveLength(3);
      });
    });

    test("price matrix: two decimals and the 8-digit cap pass, malformed shapes rejected", async () => {
      await runInRollback(async tx => {
        const zero = await PlanCatalogService.createPlan(planSubmitInput({ price: "0.00" }), "en", undefined, tx);
        expect(zero.price).toBe("0.00");
        const capped = await PlanCatalogService.createPlan(
          planSubmitInput({ price: "99999999.99" }),
          "en",
          undefined,
          tx
        );
        expect(capped.price).toBe("99999999.99");

        const rejected = await Promise.all(
          ["-0.01", "abc", "1.005", "100000000.00"].map(price =>
            expectValidationError(
              () => PlanCatalogService.createPlan(planSubmitInput({ price }), "en", undefined, tx),
              "price",
              "PLAN_PRICE_INVALID"
            )
          )
        );
        expect(rejected).toHaveLength(4);
      });
    });

    test("currency: uppercase 3-letter code passes, lowercase and short codes rejected", async () => {
      await runInRollback(async tx => {
        const ok = await PlanCatalogService.createPlan(planSubmitInput({ currency: "EGP" }), "en", undefined, tx);
        expect(ok.currency).toBe("EGP");

        const rejected = await Promise.all(
          ["egp", "EG"].map(currency =>
            expectValidationError(
              () => PlanCatalogService.createPlan(planSubmitInput({ currency }), "en", undefined, tx),
              "currency",
              "PLAN_CURRENCY_INVALID"
            )
          )
        );
        expect(rejected).toHaveLength(2);
      });
    });

    test("intervalDays: 1 passes, 0 rejected", async () => {
      await runInRollback(async tx => {
        const ok = await PlanCatalogService.createPlan(planSubmitInput({ intervalDays: 1 }), "en", undefined, tx);
        expect(ok.intervalDays).toBe(1);

        await expectValidationError(
          () => PlanCatalogService.createPlan(planSubmitInput({ intervalDays: 0 }), "en", undefined, tx),
          "intervalDays",
          "PLAN_INTERVAL_DAYS_INVALID"
        );
      });
    });

    test("updatePlan with an empty patch rejects with the localized empty-patch message", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);
        const error = await expectValidationError(
          () => PlanCatalogService.updatePlan(plan.id, {}, "en", undefined, tx),
          null,
          "PLAN_PATCH_EMPTY"
        );
        expect(error.message).toBe(enErrors.planPatchEmpty);
      });
    });

    test("updatePlan validates supplied fields and accepts a price-only patch", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);

        // An INVALID supplied field must hit the update-side aggregated
        // rejection (its own logging branch before any whitelist copy).
        const error = await expectValidationError(
          () => PlanCatalogService.updatePlan(plan.id, { price: "abc" }, "en", undefined, tx),
          "price",
          "PLAN_PRICE_INVALID"
        );
        expect(error.message).toBe(enErrors.planPriceInvalid);

        // A price-only patch exercises the partial-update contract: the
        // absent title is judged "not supplied" (not a violation) and the
        // whitelisted copy must leave every other column untouched.
        const updated = await PlanCatalogService.updatePlan(plan.id, { price: "99.99" }, "en", undefined, tx);
        expect(updated.id).toBe(plan.id);
        expect(updated.title).toBe(plan.title);
        expect(updated.price).toBe("99.99");
        expect(updated.sessionCount).toBe(plan.sessionCount);
        expect(updated.currency).toBe(plan.currency);
        expect(updated.intervalDays).toBe(plan.intervalDays);
      });
    });

    test("non-positive and non-integer ids reject before any database call", async () => {
      await runInRollback(async tx => {
        const rejected = await Promise.all(
          [0, -3, 2.5].flatMap(id => [
            expectValidationError(
              () => PlanCatalogService.updatePlan(id, { title: "Whatever" }, "en", undefined, tx),
              null,
              "PLAN_ID_INVALID"
            ),
            expectValidationError(
              () => PlanCatalogService.setPlanActiveStatus(id, true, "en", undefined, tx),
              null,
              "PLAN_ID_INVALID"
            ),
          ])
        );
        expect(rejected).toHaveLength(6);
      });
    });
  });

  describe("Tier 3 — chaos and concurrency", () => {
    test("double-deactivation via allSettled succeeds exactly once and conflicts once", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);

        // CONCURRENCY SEMANTICS (DEV3-020 amendment): the guarded-write
        // chaos property lives at the REPOSITORY layer — two interleaved
        // guarded UPDATEs on one connection serialize on the `is_active`
        // predicate, exactly one matches. The service layer wraps each
        // mutation in a nested transaction (audit atomicity), and Drizzle
        // names nested savepoints per-call from a shared counter — two
        // CONCURRENT nested transactions on ONE client reuse the name and
        // their rollback windows interfere. Production never shares a
        // connection between concurrent requests (one tx per request), so
        // the cross-connection race is settled by the same predicate
        // below; here the same property is asserted where it lives.
        const [first, second] = await Promise.allSettled([
          PlanRepository.setActiveStatusOnce(plan.id, false, tx),
          PlanRepository.setActiveStatusOnce(plan.id, false, tx),
        ]);

        // The guarded write RESOLVES null on a zero-row match (throwing is
        // the service's job) — "exactly once" here means: one settled call
        // produced the row, the other produced null.
        expect(first.status).toBe("fulfilled");
        expect(second.status).toBe("fulfilled");

        const [firstRow, secondRow] = [first, second].map(outcome =>
          outcome.status === "fulfilled" ? outcome.value : null
        );
        expect(firstRow === null || secondRow === null, "exactly one call matched the predicate").toBeTrue();
        expect(firstRow !== null || secondRow !== null, "at least one call matched the predicate").toBeTrue();
        const winner = firstRow ?? secondRow;
        if (winner === null) {
          throw new Error("unreachable — the prior assertions prove one call matched");
        }

        const [reread] = await tx.select().from(plans).where(eq(plans.id, plan.id));
        expect(reread).toEqual(winner);
        expect(reread?.isActive).toBe(false);
        expect(reread?.deactivatedAt).toBeInstanceOf(Date);
      });
    });

    test("a second deactivation through the service conflicts with the localized idempotency copy", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);

        // Sequential service-level chaos: the first transition wins; the
        // second hits the zero-row predicate and re-probes into the
        // idempotency conflict (DEV3-020 audit rows ride BOTH first-write
        // transactions — asserted by the audit service suite).
        const first = await PlanCatalogService.setPlanActiveStatus(plan.id, false, "en", undefined, tx);
        expect(first.isActive).toBe(false);

        const error = await expectRepoError(() =>
          PlanCatalogService.setPlanActiveStatus(plan.id, false, "en", undefined, tx)
        );
        expect(error).toBeInstanceOf(ConflictError);
        expect((error as ConflictError).code).toBe("PLAN_ALREADY_INACTIVE");
        expect(error.message).toBe(enErrors.planAlreadyInactive);

        const [reread] = await tx.select().from(plans).where(eq(plans.id, plan.id));
        expect(reread?.isActive).toBe(false);
        expect(reread?.deactivatedAt).toBeInstanceOf(Date);
      });
    });

    test("concurrent field patches converge last-write-wins without error", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);

        const [first, second] = await Promise.allSettled([
          PlanCatalogService.updatePlan(plan.id, { title: `First ${randomUUID()}` }, "en", undefined, tx),
          PlanCatalogService.updatePlan(plan.id, { title: `Second ${randomUUID()}` }, "en", undefined, tx),
        ]);

        expect(first.status).toBe("fulfilled");
        expect(second.status).toBe("fulfilled");

        const [reread] = await tx.select().from(plans).where(eq(plans.id, plan.id));
        expect(reread?.title).toBe(second.status === "fulfilled" ? second.value.title : "");
        expect(reread?.title).toMatch(/^Second /);
      });
    });
  });

  describe("Tier 4 — security and i18n", () => {
    test("smuggled lifecycle and identity keys never reach the insert (BOPLA)", async () => {
      await runInRollback(async tx => {
        const smuggled = planSubmitInput({ title: `Smuggler ${randomUUID()}` });
        Object.assign(smuggled, {
          id: 987_654,
          isActive: false,
          deactivatedAt: new Date("2020-01-01T00:00:00.000Z"),
          createdAt: new Date("1999-01-01T00:00:00.000Z"),
        });

        const created = await PlanCatalogService.createPlan(smuggled, "en", undefined, tx);

        expect(created.id).not.toBe(987_654);
        expect(created.isActive).toBe(true);
        expect(created.deactivatedAt).toBeNull();
        expect(created.createdAt.getTime()).toBeGreaterThan(new Date("2020-01-01T00:00:00.000Z").getTime());
      });
    });

    test("smuggled lifecycle keys never reach the update whitelist (BOPLA)", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);
        const patch: PlanUpdateInput = { title: `Whitelisted ${randomUUID()}` };
        Object.assign(patch, { isActive: false, deactivatedAt: new Date(), id: plan.id + 1 });

        const updated = await PlanCatalogService.updatePlan(plan.id, patch, "en", undefined, tx);

        expect(updated.id).toBe(plan.id);
        expect(updated.isActive).toBe(true);
        expect(updated.deactivatedAt).toBeNull();
        expect(updated.title).toMatch(/^Whitelisted /);
      });
    });

    test("a database CHECK violation behind validating input is translated, never raw", async () => {
      await runInRollback(async tx => {
        // Simulates schema drift: a stricter session_count CHECK that the
        // validation layer does not know about. The service must translate
        // the resulting 23514 through the driver cause chain into the
        // matching localized field error — the constraint name never leaks.
        await tx.execute(
          sql`ALTER TABLE plans ADD CONSTRAINT plans_session_count_service_probe_check CHECK (session_count <= 100)`
        );

        const error = await expectValidationError(
          () => PlanCatalogService.createPlan(planSubmitInput({ sessionCount: 200 }), "en", undefined, tx),
          null,
          "PLAN_SESSION_COUNT_INVALID",
          "PLAN_SESSION_COUNT_INVALID"
        );
        expect(error.message).toBe(enErrors.planSessionCountInvalid);
        expect(error.message.includes("23514")).toBe(false);
        expect(error.message.includes("constraint")).toBe(false);
      });
    });

    test("price CHECK violation maps through the price constraint family", async () => {
      await runInRollback(async tx => {
        // Schema-drift probe mirroring the session_count precedent: a stricter
        // CHECK the validation layer does not model, named after the price
        // family so the cause-chain translation has to match on the
        // constraint NAME. NOT VALID skips validation of pre-existing (seed)
        // rows — the probe only needs enforcement on NEW inserts. The failing
        // insert must be the LAST statement: any statement error aborts a
        // PostgreSQL transaction (no savepoints under runInRollback).
        await tx.execute(
          sql`ALTER TABLE plans ADD CONSTRAINT plans_price_service_probe_check CHECK (price < 100) NOT VALID`
        );

        const priceError = await expectValidationError(
          () => PlanCatalogService.createPlan(planSubmitInput({ price: "200.00" }), "en", undefined, tx),
          null,
          "PLAN_PRICE_INVALID",
          "PLAN_PRICE_INVALID"
        );
        expect(priceError.message).toBe(enErrors.planPriceInvalid);
      });
    });

    test("interval_days CHECK violation maps through the interval_days constraint family", async () => {
      await runInRollback(async tx => {
        await tx.execute(
          sql`ALTER TABLE plans ADD CONSTRAINT plans_interval_days_service_probe_check CHECK (interval_days <= 100) NOT VALID`
        );

        const intervalError = await expectValidationError(
          () => PlanCatalogService.createPlan(planSubmitInput({ intervalDays: 200 }), "en", undefined, tx),
          null,
          "PLAN_INTERVAL_DAYS_INVALID",
          "PLAN_INTERVAL_DAYS_INVALID"
        );
        expect(intervalError.message).toBe(enErrors.planIntervalDaysInvalid);
      });
    });

    test("a 23514 whose constraint name matches no family is rethrown untranslated", async () => {
      await runInRollback(async tx => {
        // Check violation raised by a constraint named outside the known
        // families: the service must rethrow the raw driver error — masking-
        // boundary territory, no localized field error invented.
        await tx.execute(
          sql`ALTER TABLE plans ADD CONSTRAINT plans_service_probe_misc_check CHECK (currency <> 'ZZZ') NOT VALID`
        );

        const errorSpy = spyOn(logger, "error");
        try {
          const constraintError = await expectRepoError(() =>
            PlanCatalogService.createPlan(planSubmitInput({ currency: "ZZZ" }), "en", undefined, tx)
          );
          expect(constraintError).not.toBeInstanceOf(ValidationError);
          expect(constraintError).not.toBeInstanceOf(NotFoundError);
          expect(constraintError).not.toBeInstanceOf(ConflictError);
          expect(errorSpy).toHaveBeenCalled();
        } finally {
          errorSpy.mockRestore();
        }
      });
    });

    test("a non-check driver error (unique violation) is rethrown untranslated", async () => {
      await runInRollback(async tx => {
        // 23505 is not a check violation: the cause-chain walk must exhaust
        // (return null) and the error must surface as-is via logger.error.
        await tx.execute(sql`CREATE UNIQUE INDEX plans_title_service_probe_unique ON plans (title)`);
        const title = `Untranslated ${randomUUID()}`;
        await PlanCatalogService.createPlan(planSubmitInput({ title }), "en", undefined, tx);

        const errorSpy = spyOn(logger, "error");
        try {
          const uniqueError = await expectRepoError(() =>
            PlanCatalogService.createPlan(planSubmitInput({ title }), "en", undefined, tx)
          );
          expect(uniqueError).not.toBeInstanceOf(ValidationError);
          expect(errorSpy).toHaveBeenCalled();
        } finally {
          errorSpy.mockRestore();
        }
      });
    });

    test("duplicate titles both succeed — double-submit tolerance", async () => {
      await runInRollback(async tx => {
        const title = `Double Submit ${randomUUID()}`;
        const first = await PlanCatalogService.createPlan(planSubmitInput({ title }), "en", undefined, tx);
        const second = await PlanCatalogService.createPlan(planSubmitInput({ title }), "en", undefined, tx);

        expect(first.id).not.toBe(second.id);
        expect(second.title).toBe(title);
      });
    });

    test("localized rejections switch between English and Arabic", async () => {
      await runInRollback(async tx => {
        const enError = await expectValidationError(
          () => PlanCatalogService.createPlan(planSubmitInput({ title: "" }), "en", undefined, tx),
          "title",
          "PLAN_TITLE_REQUIRED"
        );
        const arError = await expectValidationError(
          () => PlanCatalogService.createPlan(planSubmitInput({ title: "" }), "ar", undefined, tx),
          "title",
          "PLAN_TITLE_REQUIRED"
        );
        expect(enError.message).toBe(enErrors.planTitleRequired);
        expect(arError.message).toBe(arErrors.planTitleRequired);
        expect(arError.message).not.toBe(enError.message);

        await expectNotFoundError(
          () => PlanCatalogService.updatePlan(999_999_999, { title: "Ghost" }, "ar", undefined, tx),
          arErrors.planNotFound
        );

        const activePlan = await createTestPlan(tx);
        await expectConflictError(
          () => PlanCatalogService.setPlanActiveStatus(activePlan.id, true, "ar", undefined, tx),
          "PLAN_ALREADY_ACTIVE",
          arErrors.planAlreadyActive
        );
      });
    });
  });
});
