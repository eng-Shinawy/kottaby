/**
 * Unit tests for GraphQL error extraction utilities (`frontend/lib/graphql-error-utils.ts`).
 *
 * Covers:
 *   - extractErrorCode: extensions.code, direct code, errors[0].extensions.code, cause chain traversal
 *   - extractErrorMessage: errors[0].message, Error.message fallback, cause chain traversal
 *   - extractFieldErrors: extensions.fields, errors[0].extensions.fields, cause chain traversal
 *   - Edge cases, boundary conditions, malformed structures, and circular cause chains
 */

import { describe, expect, test } from "bun:test";
import { extractErrorCode, extractErrorMessage, extractFieldErrors } from "@/frontend/lib/graphql-error-utils";

describe("extractErrorCode", () => {
  describe("Tier 1: Happy paths & extraction priorities", () => {
    test("extracts code from extensions.code directly on error object", () => {
      const err = { extensions: { code: "UNAUTHORIZED" } };
      expect(extractErrorCode(err)).toBe("UNAUTHORIZED");
    });

    test("extracts code from direct .code property if extensions is not present", () => {
      const err = { code: "FORBIDDEN" };
      expect(extractErrorCode(err)).toBe("FORBIDDEN");
    });

    test("extracts code from errors[0].extensions.code (Apollo CombinedGraphQLErrors shape)", () => {
      const err = {
        errors: [{ extensions: { code: "BAD_USER_INPUT" } }],
      };
      expect(extractErrorCode(err)).toBe("BAD_USER_INPUT");
    });

    test("traverses cause chain to find error code", () => {
      const innerErr = { extensions: { code: "CONFLICT" } };
      const outerErr = { message: "Outer wrapper", cause: innerErr };
      expect(extractErrorCode(outerErr)).toBe("CONFLICT");
    });

    test("prioritizes extensions.code over direct .code and errors array on the same object level", () => {
      const err = {
        extensions: { code: "EXT_CODE" },
        code: "DIRECT_CODE",
        errors: [{ extensions: { code: "ERR_ARRAY_CODE" } }],
      };
      expect(extractErrorCode(err)).toBe("EXT_CODE");
    });

    test("prioritizes direct .code over errors array if extensions.code is absent", () => {
      const err = {
        code: "DIRECT_CODE",
        errors: [{ extensions: { code: "ERR_ARRAY_CODE" } }],
      };
      expect(extractErrorCode(err)).toBe("DIRECT_CODE");
    });
  });

  describe("Tier 2 & 3: Boundary conditions & circularity resistance", () => {
    test("returns null for non-object or falsy inputs", () => {
      expect(extractErrorCode(null)).toBeNull();
      expect(extractErrorCode(undefined)).toBeNull();
      expect(extractErrorCode("string error")).toBeNull();
      expect(extractErrorCode(123)).toBeNull();
      expect(extractErrorCode(true)).toBeNull();
    });

    test("returns null for empty object or objects missing code fields", () => {
      expect(extractErrorCode({})).toBeNull();
      expect(extractErrorCode({ extensions: {} })).toBeNull();
      expect(extractErrorCode({ errors: [] })).toBeNull();
    });

    test("handles direct self-referential circular cause without infinite loop", () => {
      const circularErr: Record<string, unknown> = { message: "Circular" };
      circularErr.cause = circularErr;
      expect(extractErrorCode(circularErr)).toBeNull();
    });

    test("handles multi-step circular cause chain without infinite loop", () => {
      const nodeA: Record<string, unknown> = { name: "A" };
      const nodeB: Record<string, unknown> = { name: "B" };
      nodeA.cause = nodeB;
      nodeB.cause = nodeA;
      expect(extractErrorCode(nodeA)).toBeNull();
    });
  });

  describe("Tier 4: Malformed payloads & type coercion", () => {
    test("ignores non-string code properties", () => {
      expect(extractErrorCode({ extensions: { code: 500 } })).toBeNull();
      expect(extractErrorCode({ code: { nested: "code" } })).toBeNull();
      expect(
        extractErrorCode({
          errors: [{ extensions: { code: true } }],
        })
      ).toBeNull();
    });

    test("handles errors array containing non-object or null elements gracefully", () => {
      expect(extractErrorCode({ errors: [null, undefined, 42, "str"] })).toBeNull();
    });
  });
});

describe("extractErrorMessage", () => {
  describe("Tier 1: Happy paths & priorities", () => {
    test("extracts message from errors[0].message", () => {
      const err = {
        errors: [{ message: "First GraphQL error message" }],
      };
      expect(extractErrorMessage(err)).toBe("First GraphQL error message");
    });

    test("falls back to standard Error.message if errors array has no message", () => {
      const err = new Error("Standard Error instance message");
      expect(extractErrorMessage(err)).toBe("Standard Error instance message");
    });

    test("traverses cause chain to find error message in cause", () => {
      const innerErr = { errors: [{ message: "Inner cause error message" }] };
      const outerErr = { cause: innerErr };
      expect(extractErrorMessage(outerErr)).toBe("Inner cause error message");
    });

    test("prioritizes errors[0].message over root Error.message on the same level", () => {
      const err = Object.assign(new Error("Root error message"), {
        errors: [{ message: "GraphQL error message" }],
      });
      expect(extractErrorMessage(err)).toBe("GraphQL error message");
    });
  });

  describe("Tier 2 & 3: Boundary conditions & circularity resistance", () => {
    test("returns null for non-object or falsy inputs", () => {
      expect(extractErrorMessage(null)).toBeNull();
      expect(extractErrorMessage(undefined)).toBeNull();
      expect(extractErrorMessage("raw string")).toBeNull();
      expect(extractErrorMessage(404)).toBeNull();
    });

    test("returns null when no message exists in object or cause chain", () => {
      expect(extractErrorMessage({})).toBeNull();
      expect(extractErrorMessage({ errors: [] })).toBeNull();
      expect(extractErrorMessage({ errors: [{}] })).toBeNull();
    });

    test("handles circular cause chain safely", () => {
      const circularErr: Record<string, unknown> = {};
      circularErr.cause = circularErr;
      expect(extractErrorMessage(circularErr)).toBeNull();
    });
  });

  describe("Tier 4: Malformed payloads & type coercion", () => {
    test("ignores non-string message in errors array", () => {
      const err = {
        errors: [{ message: 12345 }, { message: { text: "invalid" } }],
      };
      expect(extractErrorMessage(err)).toBeNull();
    });

    test("handles malformed errors array elements gracefully", () => {
      expect(extractErrorMessage({ errors: [null, 100, true] })).toBeNull();
    });
  });
});

describe("extractFieldErrors", () => {
  describe("Tier 1: Happy paths & extraction", () => {
    test("extracts field errors from direct extensions.fields array", () => {
      const err = {
        extensions: {
          fields: [
            { field: "email", message: "Email is invalid" },
            { field: "password", message: "Password too short" },
          ],
        },
      };
      expect(extractFieldErrors(err)).toEqual({
        email: "Email is invalid",
        password: "Password too short",
      });
    });

    test("extracts field errors from errors[0].extensions.fields (CombinedGraphQLErrors shape)", () => {
      const err = {
        errors: [
          {
            extensions: {
              fields: [{ field: "username", message: "Username taken" }],
            },
          },
        ],
      };
      expect(extractFieldErrors(err)).toEqual({
        username: "Username taken",
      });
    });

    test("traverses cause chain to find field errors", () => {
      const innerErr = {
        extensions: {
          fields: [{ field: "age", message: "Must be at least 18" }],
        },
      };
      const outerErr = { cause: innerErr };
      expect(extractFieldErrors(outerErr)).toEqual({
        age: "Must be at least 18",
      });
    });
  });

  describe("Tier 2 & 3: Boundary conditions & circularity resistance", () => {
    test("returns empty object for non-object or falsy inputs", () => {
      expect(extractFieldErrors(null)).toEqual({});
      expect(extractFieldErrors(undefined)).toEqual({});
      expect(extractFieldErrors("err")).toEqual({});
      expect(extractFieldErrors(500)).toEqual({});
    });

    test("returns empty object when fields array is empty or missing", () => {
      expect(extractFieldErrors({})).toEqual({});
      expect(extractFieldErrors({ extensions: { fields: [] } })).toEqual({});
      expect(extractFieldErrors({ errors: [{ extensions: { fields: [] } }] })).toEqual({});
    });

    test("handles circular cause chain safely", () => {
      const circularErr: Record<string, unknown> = {};
      circularErr.cause = circularErr;
      expect(extractFieldErrors(circularErr)).toEqual({});
    });
  });

  describe("Tier 4: Malformed payloads & partial skipping", () => {
    test("skips field entries that lack a string field or string message", () => {
      const err = {
        extensions: {
          fields: [
            null,
            undefined,
            "invalid entry",
            { field: "email" }, // missing message
            { message: "missing field" }, // missing field
            { field: 123, message: "non-string field name" },
            { field: "password", message: 404 }, // non-string message
            { field: "validField", message: "valid message" },
          ],
        },
      };
      expect(extractFieldErrors(err)).toEqual({
        validField: "valid message",
      });
    });

    test("returns empty object if all field entries in array are skipped", () => {
      const err = {
        extensions: {
          fields: [{ field: "test", message: 123 }],
        },
      };
      expect(extractFieldErrors(err)).toEqual({});
    });
  });
});
