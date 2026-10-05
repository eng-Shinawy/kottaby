/**
 * Teacher Availability Snapshot contract (Dev 2 → Dev 3).
 *
 * On-demand assignment — no fixed teacher binding. Snapshot staleness
 * (≤15min) is enforced by the producing availability service, NOT this type.
 * `requestPreference` governs unsolicited session requests.
 *
 * **TOCTOU:** This is a point-in-time snapshot. Consumers MUST re-assert
 * `isOnline` + `is_approved` inside the session-creation
 * `SELECT FOR UPDATE` transaction; the certified-teacher check also runs
 * at session creation.
 *
 * NO parallel `inSession` flag exists anywhere in this file —
 * excludability is expressed ONLY via `isOnline: false`.
 */
import type { TeacherRequestPreference } from "@/backend/enum/teachers/teacher-request-preference.enum";
import type { StudentSelectType } from "@/backend/types/students/student.types";
import type { TeacherSelectType } from "@/backend/types/teachers/teacher.types";
import type { UserSelectType } from "@/backend/types/users/user.types";

/** Parsed subjects array (raw JSON-string from DB → `readonly string[]`). */
export type TeacherSubjectsParsed = readonly string[];

/** Matching-input shape: languages from the student side for cross-referencing. */
export type TeacherMatchingLanguagesInput = Pick<StudentSelectType, "primaryLanguage" | "anotherLanguage">;

export interface TeacherAvailabilitySnapshotContract {
  readonly teacherId: TeacherSelectType["id"];
  /** Online status at snapshot time. Consumer MUST re-assert under lock. */
  readonly isOnline: TeacherSelectType["isOnline"];
  /** Preserved verbatim as `string | null` from Drizzle decimal. */
  readonly averageRating: TeacherSelectType["averageRating"];
  /** Parsed from the raw JSON-string `subjects` column via `parseTeacherSubjects()`. */
  readonly subjects: TeacherSubjectsParsed;
  /** Teacher's preference when receiving unsolicited session requests. */
  readonly requestPreference: TeacherRequestPreference;
  /** Matcher-relevant: teacher's country for geographic matching. */
  readonly country: UserSelectType["country"];
  /** Matcher-relevant: student's language preferences for cross-referencing. */
  readonly languages: TeacherMatchingLanguagesInput;
}
