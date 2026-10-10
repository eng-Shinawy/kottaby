/**
 * The canonical query registry — the single source of the production
 * statements the EXPLAIN auditor analyzes.
 *
 * Every entry executes the REAL repository read for one production
 * surface (imported dynamically so no database client is constructed
 * before the destructive-target guard has allowed the run) inside a
 * capture window that records the exact SQL text and binding values pg
 * receives. The analysis therefore tracks the real production query
 * shapes by construction: when a repository query changes, the captured
 * statement changes with it — nothing here hand-copies SQL. The registry
 * is also the only place new hot paths are registered; tools must never
 * issue ad-hoc EXPLAIN calls of their own.
 *
 * Registered surfaces: the matching candidates read (every sort ×
 * filter variant the browse pipeline offers, each issuing its page +
 * count pair), the two subscription page reads (the owner-scoped
 * repository read behind both the student and the admin list producers),
 * the notifications inbox page, the two participant session lists, and
 * the per-request context user read.
 *
 * Binding values are representative constants: the planner chooses an
 * access path from table statistics, so any well-formed value exercises
 * the same predicates and index machinery; the id constants keep the
 * registry self-contained (no seed-manifest coupling). Filter patterns
 * are built through the canonical LIKE-escape helper exactly the way the
 * matching service builds them before handing them to the repository.
 */

import type { NormalizedTeacherMatchingFilters } from "@/backend/db/repo/teachers/teacher.repository.matching.helpers";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import type { CaptureAround, CapturedStatement } from "@/scripts/perf/lib/query-capture";

/** Registry ids double as explain-artifact file names — same charset discipline as run ids. */
export const REGISTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}$/;

/** Raised for a malformed registry (duplicate or unsafe ids) — a registry bug, not a runtime condition. */
export class QueryRegistryError extends Error {}

/** One registered production query surface. */
export interface RegistryEntry {
  readonly id: string;
  /** The seeded volume the entry's plan evidence is meaningful at. */
  readonly minVolumeNote: string;
  /** Matching entries must show their NOT EXISTS subplan on the expected session index. */
  readonly requiresSessionIndexCheck: boolean;
  /** Executes the real repository read inside the capture window; returns the statements it sent. */
  readonly run: (captureAround: CaptureAround) => Promise<readonly CapturedStatement[]>;
}

const MATCHING_PAGE_SIZE = 25;
const LIST_PAGE_SIZE = 25;
const LIST_PAGE_OFFSET = 0;
/** Representative context/participant id (see module docblock). */
const REPRESENTATIVE_USER_ID = 1;

/** Finished quoted-token pattern, built the way the matching service builds it: JSON-quote anchor + canonical escape + `%…%` wrap. */
function matchingTokenPattern(token: string): string {
  const quotedToken = `"${token}"`;
  return `%${escapeLikeWildcards(quotedToken)}%`;
}

const MATCHING_BASE_FILTERS: Omit<NormalizedTeacherMatchingFilters, "sort"> = {
  recitationPattern: null,
  subjectPattern: null,
  languagePattern: null,
  namePattern: null,
  minRating: null,
  studentCountryCode: "EG",
  studentCountryText: null,
};

/** Wire-key fragment for each sort member (entry ids are lowercase-dash). */
const MATCHING_SORT_KEYS: Record<TeacherMatchingSort, string> = {
  [TeacherMatchingSort.RatingDesc]: "rating-desc",
  [TeacherMatchingSort.NameAsc]: "name-asc",
  [TeacherMatchingSort.Newest]: "newest",
};

const MATCHING_SORTS: readonly TeacherMatchingSort[] = [
  TeacherMatchingSort.RatingDesc,
  TeacherMatchingSort.NameAsc,
  TeacherMatchingSort.Newest,
];

/** Filter variants over the eligibility baseline (one per browse filter shape). */
const MATCHING_VARIANTS: readonly {
  readonly key: string;
  readonly note: string;
  readonly patch: Partial<Omit<NormalizedTeacherMatchingFilters, "sort">>;
}[] = [
  { key: "plain", note: "no extra filters", patch: {} },
  {
    key: "subject-language",
    note: "subject + language token filters",
    patch: {
      subjectPattern: matchingTokenPattern("hifz"),
      languagePattern: matchingTokenPattern("english"),
    },
  },
  {
    key: "name-search",
    note: "display-name search",
    patch: { namePattern: `%${escapeLikeWildcards("Teacher")}%` },
  },
  { key: "min-rating", note: "minimum-rating floor", patch: { minRating: 4 } },
];

function matchingEntry(sort: TeacherMatchingSort, variant: (typeof MATCHING_VARIANTS)[number]): RegistryEntry {
  const filters: NormalizedTeacherMatchingFilters = { ...MATCHING_BASE_FILTERS, ...variant.patch, sort };
  return {
    id: `matching-${MATCHING_SORT_KEYS[sort]}-${variant.key}`,
    minVolumeNote: `matching decision volume: >= 2,000 seeded teachers (${variant.note})`,
    requiresSessionIndexCheck: true,
    run: async captureAround => {
      const { TeacherRepository } = await import("@/backend/db/repo/teachers/teacher.repository");
      return captureAround(() => TeacherRepository.listMatchingCandidates(filters, MATCHING_PAGE_SIZE, 0));
    },
  };
}

function subscriptionEntry(id: string, surfaceNote: string): RegistryEntry {
  return {
    id,
    minVolumeNote: `list volume: 500 seeded subscriptions (${surfaceNote})`,
    requiresSessionIndexCheck: false,
    run: async captureAround => {
      const { SubscriptionRepository } = await import("@/backend/db/repo/billing/subscription.repository");
      return captureAround(() => SubscriptionRepository.listByUserId(REPRESENTATIVE_USER_ID));
    },
  };
}

/** Registry validation: file-name-safe ids, each registered exactly once. */
export function assertValidRegistryIds(entries: readonly RegistryEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!REGISTRY_ID_PATTERN.test(entry.id)) {
      throw new QueryRegistryError(`registry id is not file-name safe: ${entry.id}`);
    }
    if (seen.has(entry.id)) {
      throw new QueryRegistryError(`registry id registered twice: ${entry.id}`);
    }
    seen.add(entry.id);
  }
}

function buildCanonicalQueryRegistry(): readonly RegistryEntry[] {
  const entries: RegistryEntry[] = [
    ...MATCHING_SORTS.flatMap(sort => MATCHING_VARIANTS.map(variant => matchingEntry(sort, variant))),
    subscriptionEntry("my-subscriptions", "student page read behind the owner-scoped listOwn producer"),
    subscriptionEntry(
      "admin-student-subscriptions",
      "admin page read behind the listForAdmin producer (same owner-scoped repository read)"
    ),
    {
      id: "notifications-list",
      minVolumeNote: "list volume: 20,000 seeded notifications (unfiltered inbox page)",
      requiresSessionIndexCheck: false,
      run: async captureAround => {
        const { NotificationRepository } = await import("@/backend/db/repo/notifications/notification.repository");
        return captureAround(() =>
          NotificationRepository.listForUser(
            REPRESENTATIVE_USER_ID,
            { type: null, isRead: null },
            LIST_PAGE_SIZE,
            LIST_PAGE_OFFSET
          )
        );
      },
    },
    {
      id: "sessions-student-list",
      minVolumeNote: "list volume: 5,000 seeded sessions (student participant page, no status filter)",
      requiresSessionIndexCheck: false,
      run: async captureAround => {
        const { SessionRepository } = await import("@/backend/db/repo/classes/session.repository");
        return captureAround(() =>
          SessionRepository.listForStudent(REPRESENTATIVE_USER_ID, { status: null }, LIST_PAGE_SIZE, LIST_PAGE_OFFSET)
        );
      },
    },
    {
      id: "sessions-teacher-list",
      minVolumeNote: "list volume: 5,000 seeded sessions (teacher participant page, completed-status filter)",
      requiresSessionIndexCheck: false,
      run: async captureAround => {
        const { SessionRepository } = await import("@/backend/db/repo/classes/session.repository");
        return captureAround(() =>
          SessionRepository.listForTeacher(
            REPRESENTATIVE_USER_ID,
            { status: SessionStatus.Completed },
            LIST_PAGE_SIZE,
            LIST_PAGE_OFFSET
          )
        );
      },
    },
    {
      id: "user-find-by-id",
      minVolumeNote: "context read issued on every authenticated request",
      requiresSessionIndexCheck: false,
      run: async captureAround => {
        const { UserRepository } = await import("@/backend/db/repo/users/user.repository");
        return captureAround(() => UserRepository.findById(REPRESENTATIVE_USER_ID));
      },
    },
  ];
  assertValidRegistryIds(entries);
  return entries;
}

export const CANONICAL_QUERY_REGISTRY: readonly RegistryEntry[] = buildCanonicalQueryRegistry();
