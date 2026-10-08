/**
 * sessionReportConversions — runtime-validated conversions between the
 * backend `SessionReportSubmitInput` (uses backend `SurahJuzRef` enum)
 * and the codegen `SubmitSessionReportInput` (uses codegen `SurahJuzRef`
 * enum). The two enums carry different underlying values (snake_case refs
 * vs PascalCase wire names) and TypeScript treats them as distinct nominal
 * types. The Surah/Juz conversion resolves through a module-scope,
 * membership-guarded lookup map — no `as` cast and no `as unknown as`
 * double cast (either would trip `no-unsafe-type-assertion`); an unmapped
 * value fails closed with a thrown error, never a silent passthrough.
 * Pattern mirrors `frontend/views/admin/users/utils/directoryConversions.ts`.
 */

import { SurahJuzRef as BackendSurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import type {
  HomeWorkBlockInput as BackendHomeWorkBlockInput,
  HomeWorkAssignInput,
  HomeWorkGradeFieldsInput,
  SessionReportSubmitInput,
} from "@/backend/types";
import {
  SurahJuzRef as CodegenSurahJuzRef,
  type HomeWorkAssignmentInput,
  type HomeWorkBlockInput,
  type HomeWorkGradeInput,
  type SubmitSessionReportInput,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Membership set over the codegen `SurahJuzRef` wire values — allocated
 * once at module scope so the guard below is an O(1) check with no
 * per-call array allocations.
 */
const CODEGEN_MEMBERS: ReadonlySet<string> = new Set(Object.values(CodegenSurahJuzRef));

/** Type guard narrowing an unknown wire value to the codegen enum. */
function isCodegenSurahJuzRef(value: unknown): value is CodegenSurahJuzRef {
  return typeof value === "string" && CODEGEN_MEMBERS.has(value);
}

/**
 * Backend ref → codegen wire-name lookup, built once at module scope.
 * Wire values for `SurahJuzRef` are the TS enum KEYS (the Pothos enumType
 * maps keys to the wire; the codegen enum mirrors them), while
 * `Object.entries` yields `[memberName, snakeRef]` pairs — so the map is
 * INVERTED to ref → member name: the lookup key is the snake_case ref, the
 * value is the PascalCase wire name. The explicit `[string, string]` tuple
 * annotation keeps the flip cast-free.
 */
const CODEGEN_WIRE_BY_REF: ReadonlyMap<string, string> = new Map<string, string>(
  Object.entries(BackendSurahJuzRef).map(([member, ref]): [string, string] => [ref, member])
);

/**
 * Converts a backend `SurahJuzRef` value to the codegen enum value through
 * the module-scope lookup map. The map is total over the shared vocabulary
 * (pinned by the round-trip conversion suite and the codegen key-parity
 * test), so an unmapped value is a cross-mirror drift — it fails closed
 * here with a thrown error, never a silent null or passthrough.
 */
function toCodegenSurahJuzRef(value: BackendSurahJuzRef): CodegenSurahJuzRef {
  const wire = CODEGEN_WIRE_BY_REF.get(value);
  if (wire !== undefined && isCodegenSurahJuzRef(wire)) {
    return wire;
  }
  throw new Error(`Unmapped SurahJuzRef value: ${value}`);
}

/** Converts a backend HomeWorkBlockInput to the codegen HomeWorkBlockInput. */
function toCodegenBlock(block: BackendHomeWorkBlockInput): HomeWorkBlockInput {
  return {
    fromAyah: block.fromAyah,
    toAyah: block.toAyah,
    surahJuz: toCodegenSurahJuzRef(block.surahJuz),
  };
}

/** Converts a backend HomeWorkAssignInput (optional tracks) to codegen
 *  HomeWorkAssignmentInput (nullable tracks). */
function toCodegenAssignment(assignment: HomeWorkAssignInput | undefined): HomeWorkAssignmentInput | null {
  if (assignment === undefined) return null;
  return {
    jadid: assignment.jadid ? toCodegenBlock(assignment.jadid) : null,
    madi: assignment.madi ? toCodegenBlock(assignment.madi) : null,
  };
}

/** Converts a backend HomeWorkGradeFieldsInput to codegen HomeWorkGradeInput. */
function toCodegenGradeFields(grades: HomeWorkGradeFieldsInput | undefined): HomeWorkGradeInput | null {
  if (grades === undefined) return null;
  return { currentGrade: grades.currentGrade, revisionGrade: grades.revisionGrade };
}

/**
 * Converts a backend SessionReportSubmitInput to the codegen
 * SubmitSessionReportInput. Field-by-field — no spread, no cast.
 */
export function toCodegenSubmitInput(payload: SessionReportSubmitInput): SubmitSessionReportInput {
  return {
    teacherNotes: payload.teacherNotes,
    studentRatingByTeacher: payload.studentRatingByTeacher,
    homework: toCodegenAssignment(payload.homework),
    previousGrades: toCodegenGradeFields(payload.previousGrades),
  };
}
