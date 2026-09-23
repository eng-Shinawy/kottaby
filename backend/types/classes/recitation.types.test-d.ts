/**
 * Type-Level Conformance Suite — recitation canonical types.
 * Validated by `bun tsgo` (the compiler is the test runner).
 * `.test-d.ts` suffix = outside bun test runner glob.
 *
 * POSITIVES use `satisfies` — must compile.
 * NEGATIVES use `@ts-expect-error` directly before the offending line.
 */
import type {
  RecitationInsertType,
  RecitationReturnType,
  RecitationSelectType,
  SessionRecitationSubmitInput,
} from "@/backend/types/classes/recitation.types";

/** Helper to consume variables for TS6133. */
const v = (x: unknown): boolean => Boolean(x);

/** Exact type-identity probe: tuple-wrapped mutual assignability (no widening, no distribution). */
type Equals<A, B> = [A, B] extends [B, A] ? true : false;

// ========== CANONICAL READ SHAPE (RecitationReturnType) ==========

// Positive — the read shape IS the derived select row (never re-declared, never forked)
const sameRow: Equals<RecitationReturnType, RecitationSelectType> = true;
v(sameRow);

// Negative — the read shape must stay the derived select row
// @ts-expect-error — RecitationReturnType must remain the derived select row
const forkedRow: Equals<RecitationReturnType, RecitationSelectType> = false;
v(forkedRow);

// Positive — full canonical read shape (every column, exact typing)
v({
  id: 1,
  sessionId: 2,
  name: "Al-Fatihah",
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies RecitationReturnType);

// Positive — the description column is a nullable string on the read shape
const descriptionTyped: Equals<RecitationReturnType["description"], string | null> = true;
v(descriptionTyped);

// Positive — the owning session join is a plain number on the read shape
const sessionJoinTyped: Equals<RecitationReturnType["sessionId"], number> = true;
v(sessionJoinTyped);

// ========== INSERT SHAPE (RecitationInsertType) ==========

// Positive — a write-path insert carries the owning session and content columns only
v({ sessionId: 7, name: "Al-Fatihah", description: null } satisfies RecitationInsertType);
v({ sessionId: 7, name: "Al-Baqarah", description: "first half, five ayat" } satisfies RecitationInsertType);

// ========== SUBMIT INPUT (closed client whitelist) ==========

// Positive — the closed whitelist with an explicit null description
v({ name: "Al-Fatihah", description: null } satisfies SessionRecitationSubmitInput);

// Positive — the closed whitelist with free-form notes
v({ name: "Al-Baqarah", description: "reviewed first page with tajweed" } satisfies SessionRecitationSubmitInput);

// Positive — the whitelist is exactly { name, description }
type SubmitKeys = keyof SessionRecitationSubmitInput;
const closedKeys: Equals<SubmitKeys, "name" | "description"> = true;
v(closedKeys);

// Negative — the owning session is resolved server-side from the session lifecycle
v({
  name: "Al-Fatihah",
  description: null,
  // @ts-expect-error — sessionId is server-controlled
  sessionId: 7,
} satisfies SessionRecitationSubmitInput);

// Negative — row identity is server-generated
v({
  name: "Al-Fatihah",
  description: null,
  // @ts-expect-error — id is server-controlled
  id: 99,
} satisfies SessionRecitationSubmitInput);

// Negative — creation stamp is server-written
v({
  name: "Al-Fatihah",
  description: null,
  // @ts-expect-error — createdAt is server-controlled
  createdAt: new Date(),
} satisfies SessionRecitationSubmitInput);

// Negative — update stamp is server-written
v({
  name: "Al-Fatihah",
  description: null,
  // @ts-expect-error — updatedAt is server-controlled
  updatedAt: new Date(),
} satisfies SessionRecitationSubmitInput);

// Negative — the notes column is a string or an explicit null, never undefined
v({
  name: "Al-Fatihah",
  // @ts-expect-error — description must be an explicit string or null
  description: undefined,
} satisfies SessionRecitationSubmitInput);

// Negative — the short label is mandatory (a recitation is never recorded unnamed)
// @ts-expect-error — name mandatory
const noName: SessionRecitationSubmitInput = { description: null };
v(noName);

// Negative — the notes column is mandatory (absence is expressed as an explicit null)
// @ts-expect-error — description mandatory
const noDescription: SessionRecitationSubmitInput = { name: "Al-Fatihah" };
v(noDescription);
