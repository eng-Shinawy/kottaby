/**
 * Canonical on-demand matching types — the read-side surface of the student
 * "available teachers" browse pipeline.
 *
 * The service resolves the caller's own student context (languages + country),
 * validates the per-browse choices, and projects each eligible teacher row
 * into the PII-minimal item shape below. Teacher identity is carried by the
 * shared-PK `id` only — contact fields, credential hashes, and lifecycle
 * timestamps never enter the projection.
 *
 * Cross-stream contract shapes (`TeacherMatchingLanguagesInput`,
 * `TeacherSubjectsParsed`) are consumed from the availability contract file —
 * never re-declared here.
 */
import type { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import type { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import type {
  TeacherMatchingLanguagesInput,
  TeacherSubjectsParsed,
} from "@/backend/types/contracts/teacher-availability.contract.types";
import type { RecitationReading } from "@/shared/constants/recitation-reading.enum";

/**
 * The intents a student may browse with — the session-request vocabulary
 * minus the staff-driven evaluation flow (`"hifz" | "tajweed"`).
 */
export type TeacherMatchingIntent = Exclude<SessionIntent, SessionIntent.Evaluation>;

/**
 * The six per-browse choices submitted by the student; explicit `null`
 * restores the default for the optional members (page bounds, name search,
 * minimum rating) and `sort` carries its SDL default (`RATING_DESC`).
 * `search` is the raw name-search substring (the finished LIKE pattern is
 * built at the service's single escape point); `minRating` is an
 * honest-SQL floor — `average_rating >= minRating`, so an unrated teacher
 * (NULL) is excluded whenever a floor is set; `sort` selects the
 * post-tier ordering key (the country tier ALWAYS sorts first).
 */
export interface TeacherMatchingSubmitInput {
  readonly recitation: RecitationReading;
  readonly intent: TeacherMatchingIntent;
  readonly page: number | null;
  readonly pageSize: number | null;
  readonly search: string | null;
  readonly minRating: number | null;
  readonly sort: TeacherMatchingSort;
}

/**
 * The PII-minimal teacher card — the student-facing projection of one
 * eligible teacher row. No email, phone, password hash, or timestamp fields;
 * `averageRating` is the parsed float (`number | null`), not the raw Drizzle
 * decimal string.
 */
export interface TeacherMatchingItemReturnType {
  readonly id: number;
  readonly fullName: string;
  readonly country: string | null;
  readonly countryCode: string | null;
  readonly subjects: TeacherSubjectsParsed;
  readonly recitations: readonly RecitationReading[];
  readonly languages: readonly string[];
  readonly averageRating: number | null;
  readonly isOnline: boolean;
}

/** Paginated browse envelope — `pageCount = Math.ceil(total / pageSize)`. */
export interface TeacherMatchingPageReturnType {
  readonly items: readonly TeacherMatchingItemReturnType[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
}

/**
 * The caller-resolved context driving the soft filters: the student's own
 * language preferences (contract shape) plus the resolved country pair.
 */
export interface TeacherMatchingStudentContext extends TeacherMatchingLanguagesInput {
  readonly countryCode: string | null;
  readonly country: string | null;
}
