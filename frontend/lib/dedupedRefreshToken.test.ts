/**
 * Unit tests for `dedupedRefreshToken` (`frontend/lib/dedupedRefreshToken.ts`).
 *
 * Verifies asynchronous promise deduplication:
 * 1. Single execution calls `fn` and returns its result.
 * 2. N concurrent calls deduplicate to a single `fn()` execution and return the identical promise.
 * 3. Once settled (resolved), the inflight promise is cleared and subsequent calls run `fn` again.
 * 4. Once settled (rejected), the inflight promise is cleared and subsequent calls run `fn` again.
 */

import { describe, expect, test } from "bun:test";
import { dedupedRefreshToken } from "@/frontend/lib/dedupedRefreshToken";

describe("dedupedRefreshToken", () => {
  test("invokes fn once and resolves with the returned value for a single caller", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return "token_123";
    };

    const result = await dedupedRefreshToken(fn);

    expect(result).toBe("token_123");
    expect(callCount).toBe(1);
  });

  test("deduplicates concurrent callers, invoking fn only once and sharing the same promise", async () => {
    let callCount = 0;
    let resolvePromise!: (value: string) => void;

    const fn = () =>
      new Promise<string>(resolve => {
        callCount++;
        resolvePromise = resolve;
      });

    // Call dedupedRefreshToken 3 times concurrently
    const promise1 = dedupedRefreshToken(fn);
    const promise2 = dedupedRefreshToken(fn);
    const promise3 = dedupedRefreshToken(fn);

    // All callers should receive the exact same Promise instance
    expect(promise1).toBe(promise2);
    expect(promise2).toBe(promise3);

    // fn should only have been called once
    expect(callCount).toBe(1);

    // Resolve the inflight promise
    resolvePromise("shared_token");

    const [res1, res2, res3] = await Promise.all([promise1, promise2, promise3]);

    expect(res1).toBe("shared_token");
    expect(res2).toBe("shared_token");
    expect(res3).toBe("shared_token");
  });

  test("clears inflight promise after resolution so subsequent calls re-invoke fn", async () => {
    let callCount = 0;

    const fn = async () => {
      callCount++;
      return `token_${callCount}`;
    };

    const firstResult = await dedupedRefreshToken(fn);
    expect(firstResult).toBe("token_1");
    expect(callCount).toBe(1);

    // Subsequent call after first promise settled
    const secondResult = await dedupedRefreshToken(fn);
    expect(secondResult).toBe("token_2");
    expect(callCount).toBe(2);
  });

  test("handles rejections, sharing the failure across concurrent callers and clearing inflight state afterwards", async () => {
    let callCount = 0;
    let rejectPromise!: (reason: Error) => void;

    const fn = () =>
      new Promise<string>((_resolve, reject) => {
        callCount++;
        rejectPromise = reject;
      });

    const promise1 = dedupedRefreshToken(fn);
    const promise2 = dedupedRefreshToken(fn);

    expect(promise1).toBe(promise2);
    expect(callCount).toBe(1);

    const testError = new Error("Refresh failed");
    rejectPromise(testError);

    let err1: unknown;
    let err2: unknown;
    try {
      await promise1;
    } catch (e) {
      err1 = e;
    }
    try {
      await promise2;
    } catch (e) {
      err2 = e;
    }

    expect(err1).toBe(testError);
    expect(err2).toBe(testError);

    // After failure settles, next call should attempt fn again
    let nextCallCount = 0;
    const nextFn = async () => {
      nextCallCount++;
      return "recovered_token";
    };

    const recovered = await dedupedRefreshToken(nextFn);
    expect(recovered).toBe("recovered_token");
    expect(nextCallCount).toBe(1);
  });
});
