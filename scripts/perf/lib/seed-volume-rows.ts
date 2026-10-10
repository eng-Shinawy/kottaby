/**
 * Volume-row generators for the seeded session, subscription, and
 * notification tables. All three stream their rows one at a time so the
 * database adapter's batch pump can insert them in fixed-size multi-row
 * statements without ever holding the full volume in memory.
 *
 * The hot-teacher contract lives here: the first `hotTeacherCount` teachers
 * receive `started` sessions, which the teacher matching read excludes via
 * its in-session NOT EXISTS predicate — the live exercise of that branch.
 * Every other session cycles through the scheduled/completed/cancelled
 * states, and only hot teachers ever carry started rows so the browsable
 * pool stays at the requested volume.
 */

import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { padSeedIndex, pickRandom } from "@/scripts/perf/lib/seed-random";
import type {
  NotificationSeedRow,
  SeedSessionStatus,
  SeedSubscriptionStatus,
  SessionSeedRow,
  SubscriptionSeedRow,
} from "@/scripts/perf/lib/seed-shapes";

/** Session fee amounts (platform-set decimal strings). */
const SEED_SESSION_FEES: readonly string[] = ["100.00", "150.00", "200.00"];
/** Share of sessions routed to the hot-teacher subset as `started` rows. */
const HOT_SESSION_SHARE = 0.2;
/** Days of synthetic session/subscription window spread. */
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Days of synthetic notification spread. */
const NOTIFICATION_SPREAD_DAYS = 30;
/** Balance lanes a held session fee may be escrowed from. */
const HELD_LANES: readonly HeldBalanceLane[] = [HeldBalanceLane.Trial, HeldBalanceLane.Hifz, HeldBalanceLane.Tajweed];
/** Session intents a synthetic student session may carry. */
const SESSION_INTENTS = [SessionIntent.Hifz, SessionIntent.Tajweed] as const;

/** Share of started sessions routed to the hot-teacher subset, honoring the requested volume. */
export function computeHotSessionCount(totalSessions: number, hotTeacherCount: number): number {
  if (totalSessions <= 0 || hotTeacherCount <= 0) {
    return 0;
  }
  const target = Math.ceil(totalSessions * HOT_SESSION_SHARE);
  return Math.min(totalSessions, Math.max(hotTeacherCount, target));
}

/**
 * Generates the `session` volume; the hot subset's rows are `started`, the
 * rest cycle through the remaining lifecycle states.
 *
 * @yields {SessionSeedRow} one prefixed-owner session row
 */
export function* generateSessionRows(params: {
  readonly teacherIds: readonly number[];
  readonly hotTeacherCount: number;
  readonly studentIds: readonly number[];
  readonly count: number;
  readonly now: Date;
  readonly random: () => number;
}): Generator<SessionSeedRow> {
  const { teacherIds, hotTeacherCount, studentIds, count, now, random } = params;
  if (count <= 0 || teacherIds.length === 0 || studentIds.length === 0) {
    return;
  }
  const hotTeacherIds = teacherIds.slice(0, hotTeacherCount);
  const coldTeacherIds = teacherIds.length > hotTeacherIds.length ? teacherIds.slice(hotTeacherIds.length) : teacherIds;
  const hotSessionCount = computeHotSessionCount(count, hotTeacherCount);
  for (let index = 0; index < count; index += 1) {
    const studentId = pickRandom(random, studentIds);
    const isHotRow = index < hotSessionCount;
    const teacherId = isHotRow
      ? pickRandom(random, hotTeacherIds)
      : (coldTeacherIds[(index - hotSessionCount) % coldTeacherIds.length] ?? teacherIds[0]);
    yield isHotRow
      ? buildHotSessionRow(teacherId, studentId, now, random)
      : buildColdSessionRow(teacherId, studentId, now, random);
  }
}

/** A `started` session on a hot teacher (the in-session exclusion row). */
function buildHotSessionRow(teacherId: number, studentId: number, now: Date, random: () => number): SessionSeedRow {
  return {
    teacherId,
    studentId,
    status: SessionStatus.Started,
    sessionType: SessionType.StudentSession,
    intent: pickRandom(random, SESSION_INTENTS),
    fee: pickRandom(random, SEED_SESSION_FEES),
    feeHeld: true,
    heldBalanceLane: pickRandom(random, HELD_LANES),
    startedAt: new Date(now.getTime() - (1 + Math.floor(random() * 6)) * HOUR_MS),
    endedAt: null,
    confirmationDeadline: null,
  };
}

/** Deterministic lifecycle mix for non-hot sessions: mostly scheduled, then completed, then cancelled. */
function pickColdSessionStatus(statusRoll: number): SeedSessionStatus {
  if (statusRoll < 0.45) {
    return SessionStatus.Scheduled;
  }
  if (statusRoll < 0.8) {
    return SessionStatus.Completed;
  }
  return SessionStatus.Cancelled;
}

/** A scheduled, completed, or cancelled session on a non-hot teacher. */
function buildColdSessionRow(teacherId: number, studentId: number, now: Date, random: () => number): SessionSeedRow {
  const statusRoll = random();
  const status = pickColdSessionStatus(statusRoll);
  const startedAt = new Date(now.getTime() - (1 + Math.floor(random() * 14)) * DAY_MS);
  return {
    teacherId,
    studentId,
    status,
    sessionType: SessionType.StudentSession,
    intent: pickRandom(random, SESSION_INTENTS),
    fee: pickRandom(random, SEED_SESSION_FEES),
    feeHeld: status === SessionStatus.Scheduled,
    heldBalanceLane: status === SessionStatus.Scheduled ? pickRandom(random, HELD_LANES) : null,
    startedAt: status === SessionStatus.Scheduled ? null : startedAt,
    endedAt: status === SessionStatus.Completed ? new Date(startedAt.getTime() + HOUR_MS) : null,
    confirmationDeadline: status === SessionStatus.Scheduled ? new Date(now.getTime() + 24 * HOUR_MS) : null,
  };
}

/** Deterministic status mix for settled subscriptions: mostly active, some expired, some cancelled. */
function pickSubscriptionStatus(statusRoll: number): SeedSubscriptionStatus {
  if (statusRoll < 0.78) {
    return SubscriptionStatus.Active;
  }
  if (statusRoll < 0.9) {
    return SubscriptionStatus.Expired;
  }
  return SubscriptionStatus.Cancelled;
}

/** Days back a settled subscription started (expired ones are older). */
function subscriptionStartAgeDays(status: SeedSubscriptionStatus): number {
  return status === SubscriptionStatus.Expired ? 40 : 5;
}

/** Signed days from now to the subscription's end (expired ends are past, active ends are future). */
function subscriptionEndOffsetDays(status: SeedSubscriptionStatus): number {
  if (status === SubscriptionStatus.Expired) {
    return -10;
  }
  if (status === SubscriptionStatus.Cancelled) {
    return 10;
  }
  return 25;
}

/**
 * Generates the `subscriptions` volume across the seeded students and plans.
 *
 * @yields {SubscriptionSeedRow} one prefix-referenced subscription row
 */
export function* generateSubscriptionRows(params: {
  readonly studentIds: readonly number[];
  readonly planIds: readonly number[];
  readonly count: number;
  readonly prefix: string;
  readonly now: Date;
  readonly random: () => number;
}): Generator<SubscriptionSeedRow> {
  const { studentIds, planIds, count, prefix, now, random } = params;
  if (count <= 0 || studentIds.length === 0 || planIds.length === 0) {
    return;
  }
  for (let index = 0; index < count; index += 1) {
    const userId = studentIds[index % studentIds.length] ?? studentIds[0];
    const planId = pickRandom(random, planIds);
    const statusRoll = random();
    if (statusRoll < 0.08) {
      // Pending purchase rows carry no settled window and no gateway reference.
      yield {
        userId,
        planId,
        status: SubscriptionStatus.Pending,
        startDate: null,
        endDate: null,
        paymentMethod: null,
        paymentReference: null,
        paymentVerifiedAt: null,
      };
      continue;
    }
    const status = pickSubscriptionStatus(statusRoll);
    const startDate = new Date(now.getTime() - subscriptionStartAgeDays(status) * DAY_MS);
    const endDate = new Date(now.getTime() + subscriptionEndOffsetDays(status) * DAY_MS);
    yield {
      userId,
      planId,
      status,
      startDate,
      endDate,
      paymentMethod: PaymentGateway.OfflineCash,
      paymentReference: `${prefix}sub_${padSeedIndex(index)}`,
      paymentVerifiedAt: startDate,
    };
  }
}

/**
 * Generates the `notifications` volume across every seeded user.
 *
 * @yields {NotificationSeedRow} one prefix-titled notification row
 */
export function* generateNotificationRows(params: {
  readonly userIds: readonly number[];
  readonly sessionIds: readonly number[];
  readonly count: number;
  readonly prefix: string;
  readonly now: Date;
  readonly random: () => number;
}): Generator<NotificationSeedRow> {
  const { userIds, sessionIds, count, prefix, now, random } = params;
  if (count <= 0 || userIds.length === 0) {
    return;
  }
  const notificationTypes = Object.values(NotificationType);
  for (let index = 0; index < count; index += 1) {
    const type = pickRandom(random, notificationTypes);
    const relatedToSession = sessionIds.length > 0 && random() < 0.6;
    yield {
      userId: userIds[index % userIds.length] ?? userIds[0],
      type,
      title: `${prefix}${type.replaceAll("_", " ")} notification ${padSeedIndex(index)}`,
      body: `Synthetic load-test notification ${padSeedIndex(index)}.`,
      isRead: random() < 0.35,
      relatedEntityType: relatedToSession ? "session" : null,
      relatedEntityId: relatedToSession ? pickRandom(random, sessionIds) : null,
      createdAt: new Date(now.getTime() - Math.floor(random() * NOTIFICATION_SPREAD_DAYS) * DAY_MS),
    };
  }
}
