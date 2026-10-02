/**
 * Contract lock over `useOrderTeacherReEvaluation` — the admin-ordered
 * paid re-evaluation mutation hook (pure logic tier).
 *
 * WHAT THIS LOCKS
 *   1. REFETCH TARGETS — the hook's refetch list is EXACTLY
 *      the two operation names the order invalidates server-side, and
 *      BOTH names are verified against the REAL shared query documents'
 *      operation names (not free-floating strings): `AdminUserDetail`
 *      (the teacher/applicant snapshots go stale: de-certified +
 *      re-opened) and `AdminTeacherWallet` (the balance dropped).
 *   2. WIRE VARIABLES — `buildOrderReEvaluationVariables` coerces the
 *      numeric user key through `String(...)` (the GraphQL `ID` wire
 *      shape) and carries the reason verbatim; the variable surface has
 *      EXACTLY two keys — no caller-identity key (actor derived
 *      server-side) and no pricing key (the fee is server-owned, never a
 *      caller input).
 *   3. HOOK WIRING (source pins) — the hook module builds its mutation on
 *      `useMutation` from `@apollo/client/react` (NEVER `useLazyQuery`)
 *      against the REAL `adminOrderTeacherReEvaluationMutationDocument`
 *      and consumes the exported refetch constant + variables builder as
 *      the single source of truth. The hook registers NO `onCompleted` /
 *      `onError` swallowing callbacks: the runner's promise REJECTS on
 *      GraphQL errors so the consuming dialog stays open and maps the
 *      `extensions.code` locally (failure leaves the dialog state intact;
 *      the code→copy matrix is the paired dialog-helpers suite's
 *      contract).
 *
 * FIXTURES: none — no server boot, no DB, no network, no React render
 * (the repo has no DOM-render harness; hooks are locked at the pure logic
 * tier via their extracted pieces + module source pins, the backend
 * service-suite discipline).
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/admin/users/hooks/useOrderTeacherReEvaluation.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  adminTeacherWalletQueryDocument,
  adminUserDetailQueryDocument,
} from "@/frontend/graphql/sharedDocuments/admin";
import { operationOrThrow } from "@/frontend/graphql/sharedDocuments/document-test-kit";
import {
  buildOrderReEvaluationVariables,
  ORDER_RE_EVALUATION_REFETCH_QUERIES,
} from "@/frontend/views/admin/users/hooks/useOrderTeacherReEvaluation";

// ---------------------------------------------------------------------------
// Contract

/** The exact two-key wire surface (no actor id, no fee). */
const WIRE_VARIABLE_KEYS = ["reason", "teacherId"] as const;

/** Variable-name fragments that must never ride the wire. */
const FORBIDDEN_VARIABLE_MARKERS = ["actor", "caller", "userid", "fee", "amount", "price", "currency"] as const;

/** The hook module's source — pinned below (backend service-suite discipline). */
const HOOK_SOURCE = await Bun.file(new URL("./useOrderTeacherReEvaluation.ts", import.meta.url)).text();

// ---------------------------------------------------------------------------
// Refetch-target contract

describe("useOrderTeacherReEvaluation — refetch targets", () => {
  test("refetch list is EXACTLY the admin user detail + admin teacher wallet operation names", () => {
    expect([...ORDER_RE_EVALUATION_REFETCH_QUERIES]).toEqual(["AdminUserDetail", "AdminTeacherWallet"]);
  });

  test("both refetch names are the REAL shared query documents' operation names (no free-floating strings)", () => {
    // Resolve the actual operation names off the committed documents the
    // detail page + wallet view run — a renamed query fails here instead
    // of silently de-refetching the stale caches.
    const detailOperationName: string = operationOrThrow(adminUserDetailQueryDocument).name?.value ?? "";
    const walletOperationName: string = operationOrThrow(adminTeacherWalletQueryDocument).name?.value ?? "";
    expect(detailOperationName).toBe("AdminUserDetail");
    expect(walletOperationName).toBe("AdminTeacherWallet");
    const refetchNames: string[] = [...ORDER_RE_EVALUATION_REFETCH_QUERIES];
    expect(refetchNames).toEqual([detailOperationName, walletOperationName]);
  });
});

// ---------------------------------------------------------------------------
// Wire-variable contract

describe("useOrderTeacherReEvaluation — wire variables", () => {
  test("numeric teacher id is coerced to the ID wire string; reason is carried verbatim", () => {
    const variables = buildOrderReEvaluationVariables({ teacherId: 42, reason: "Performance review follow-up" });
    expect(variables.teacherId).toBe("42");
    expect(typeof variables.teacherId).toBe("string");
    expect(variables.reason).toBe("Performance review follow-up");
  });

  test("variable surface has EXACTLY the two sanctioned keys (no actor id, no fee)", () => {
    const variables = buildOrderReEvaluationVariables({ teacherId: 7, reason: "r" });
    expect(Object.keys(variables).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...WIRE_VARIABLE_KEYS].toSorted((a, b) => a.localeCompare(b))
    );
    for (const key of Object.keys(variables)) {
      const lowered = key.toLowerCase();
      for (const marker of FORBIDDEN_VARIABLE_MARKERS) {
        expect(lowered).not.toContain(marker);
      }
    }
  });

  test("a non-integer numeric key still rides the same single coercion path", () => {
    // The resolver re-validates positivity server-side; the hook's contract
    // is the verbatim string coercion only.
    expect(buildOrderReEvaluationVariables({ teacherId: 1234567, reason: "x" }).teacherId).toBe("1234567");
  });
});

// ---------------------------------------------------------------------------
// Hook-wiring source pins

describe("useOrderTeacherReEvaluation — hook wiring (module source pins)", () => {
  test("the mutation is built with useMutation imported from @apollo/client/react (NEVER useLazyQuery)", () => {
    expect(HOOK_SOURCE).toContain('import { useMutation } from "@apollo/client/react"');
    expect(HOOK_SOURCE).not.toContain("useLazyQuery");
  });

  test("the mutation rides the REAL adminOrderTeacherReEvaluationMutationDocument", () => {
    expect(HOOK_SOURCE).toContain("adminOrderTeacherReEvaluationMutationDocument");
    expect(HOOK_SOURCE).not.toContain("gql`");
  });

  test("the hook consumes the exported refetch constant + variables builder (single source of truth)", () => {
    expect(HOOK_SOURCE).toContain("refetchQueries: [...ORDER_RE_EVALUATION_REFETCH_QUERIES]");
    expect(HOOK_SOURCE).toContain("buildOrderReEvaluationVariables(input)");
  });

  test("the hook registers NO error-swallowing callbacks — rejections propagate to the dialog", () => {
    // The failure contract: the awaited runner REJECTS on GraphQL errors so
    // the dialog stays open and maps `extensions.code` locally. An
    // `onError`/`onCompleted` registration here would swallow the rejection
    // and break that contract.
    expect(HOOK_SOURCE).not.toContain("onError");
    expect(HOOK_SOURCE).not.toContain("onCompleted");
  });
});
