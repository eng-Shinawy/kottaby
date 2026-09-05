/**
 * ParentLinkRequestService — business-logic hub for the parent→child link
 * request workflow.
 *
 * Five user-facing operations compose the `parent_link_requests`
 * append-and-transition repository with the guarded student link write and
 * the real-time notification engine (plus TWO actor-less system primitives,
 * `sweepExpiredRequests` and `sendExpiryReminders`):
 *
 *  - `requestLink` — a parent submits a handshake code; the pipeline is
 *    STRICTLY ordered: normalize+validate the code PRE-DB, fresh
 *    actor re-check, then ONE `withTransaction`: one captured `now`, target
 *    discovery, governance collapse, already-linked / already-pending
 *    conflicts (with the partial-unique 23505 arbiter as the race backstop),
 *    field-by-field insert, recipient-locale copy composition, in-tx emit;
 *    the realtime publish happens ONLY on the own-commit path.
 *  - `respondToLinkRequest` — the deciding student accepts or rejects via
 *    the guarded claim; the accept branch writes the link through
 *    `StudentRepository.linkParentIfUnlinked` (the ONLY production writer of
 *    a non-null `students.parent_id`) whose zero-row collapse THROWS and
 *    rolls back the whole transaction (ghost confirmations are impossible),
 *    then expires sibling pendings; the reject branch writes nothing but the
 *    claim. The parent is notified in the parent's persisted locale, in-tx.
 *  - `cancelLinkRequest` — the requesting parent withdraws a live pending
 *    request; withdrawal FOLDS the row to `rejected` and is SILENT (zero
 *    notifications, zero publishes).
 *  - `sweepExpiredRequests` — the sweep PRIMITIVE (system-scope, actor-less):
 *    ONE guarded bulk statement materializes every lapsed live pending row to
 *    `expired` (strict-`>` boundary side: `expires_at <= now`); idempotent by
 *    predicate; ZERO notifications and ZERO audit rows (full silence);
 *    the future cron-stream job owns the trigger and registers this as its
 *    handler. Materialization changes storage only — the read side
 *    already renders the computed `Expired` chip.
 *  - `listMyOutgoing` / `listMyIncoming` — self-scoped history reads with a
 *    RELAXED actor re-check (identity + role; governance state must not
 *    hide the actor's own request history from him), render-time expiry
 *    mapping (a stored `pending` row whose `expiresAt <= now` surfaces as
 *    `LinkStatus.Expired` WITHOUT any write — read purity).
 *
 * Disciplines enforced here:
 *  - Defense-in-depth actor re-check — ONE module-private function
 *    used by every mutation and read: a FRESH `UserRepository.findById` of
 *    the actor id; missing or non-positive id → `UnauthorizedError`; role
 *    mismatch → `ForbiddenError`; governed (deleted/blocked/suspended) →
 *    `ForbiddenError` with the SAME constant copy (no branch disclosure).
 *    Every denial logs exactly ONE bounded `logDomainError` and performs
 *    ZERO writes and ZERO notifications. Mutations enforce the governance
 *    arm; the relaxed reads do not (they are self-scoped on the verified id).
 *  - Constant-shape not-found: a request id that does not resolve
 *    for the actor is denied exactly like a nonexistent id — foreign ≡
 *    nonexistent, byte-shaped — never an oracle for id enumeration.
 *  - Copy composition: recipient locale is resolved at the EMITTER
 *    (`UserRepository.findLocalesByIds` + `defaultLocale` fallback) and the
 *    `eventParentLink*` copy is composed through
 *    `getServerTranslations(recipientLocale).notificationsTranslations` —
 *    never the caller's locale, never hardcoded strings.
 *  - Notifications: `NotificationEngine.emitForUser(..., tx, options)` writes
 *    the inbox row INSIDE the transaction (single-writer rule);
 *    `NotificationEngine.publishReceipts` runs ONLY when this call owned the
 *    commit (outerTx === undefined) — a caller-owned transaction NEVER
 *    publishes (the caller owns the commit boundary).
 *  - Log hygiene: happy paths emit NOTHING; every expected denial
 *    emits exactly ONE `logDomainError` whose context bag is EXACTLY
 *    `{ code, entity: "parent_link_requests" | "students" | "users",
 *    entityId?, locale }` — NEVER a name, an email, or the submitted
 *    handshake code.
 *  - Zero audit rows: nothing on this surface writes `audit_logs` (the
 *    journey's Step-9 integrity probe depends on it).
 *
 * Implementation detail: the module-private machinery (actor re-check,
 * collapse classifier, denial raiser, tx pipeline halves, read renderers)
 * lives in `./parent-link-request.helpers` — extracted solely to honor the
 * repo's `max-lines`/`max-lines-per-function` budgets; the public surface is
 * exactly the five-operation namespace below.
 */

import {
  type IncomingParentLinkRequestRow,
  type OutgoingParentLinkRequestRow,
  ParentLinkRequestReminderRepository,
  ParentLinkRequestRepository,
  StudentRepository,
  UserRepository,
} from "@/backend/db/repo";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  NotificationEngine,
  type NotificationEngineCallOptions,
} from "@/backend/services/notifications/notification-engine.service";
import {
  classifyUnclaimableRequest,
  emitRequestNotificationTx,
  insertPendingRequestTx,
  isDeliveryReceipt,
  mapIncoming,
  mapOutgoing,
  PARENT_LINK_RELATED_ENTITY_TYPE,
  raiseUnclaimableDenial,
  requireActor,
  toCanonicalLinkStatus,
  type UnclaimableDenial,
} from "@/backend/services/parents/parent-link-request.helpers";
import type {
  DBTransaction,
  IncomingParentLinkRequestReturnType,
  NotificationDeliveryReceipt,
  OutgoingParentLinkRequestReturnType,
} from "@/backend/types";
import { isHandshakeCode, normalizeHandshakeCode } from "@/shared/constants/handshake-code.constants";
import { isolateBidi } from "@/shared/lib/isolate-bidi";
import { maskFullName } from "@/shared/lib/mask-full-name";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Default reminder window: requests expiring within 24h get the reminder. */
const DEFAULT_EXPIRY_REMINDER_HOURS = 24;

/** Hard cap = one full request lifetime (7d) — the window can never exceed the lifecycle. */
const MAX_EXPIRY_REMINDER_HOURS = 168;

/** Milliseconds per hour for the horizon arithmetic. */
const EXPIRY_REMINDER_HOUR_MS = 3_600_000;

/** Internal respond outcome — the claimed success payload, or the classified denial. */
type RespondOutcome =
  | {
      kind: "claimed";
      row: IncomingParentLinkRequestRow;
      receipt: NotificationDeliveryReceipt;
      parentLocale: string;
    }
  | { kind: "denied"; denial: UnclaimableDenial };

/** Internal cancel outcome — the folded row, or the classified denial. */
type CancelOutcome =
  | { kind: "cancelled"; row: OutgoingParentLinkRequestRow }
  | { kind: "denied"; denial: UnclaimableDenial };

export namespace ParentLinkRequestService {
  /**
   * A parent submits a link request for the student owning `code`.
   *
   * Ordered pipeline — each step strictly before the next:
   *  1. Normalize (trim, uppercase) + validate the code — a malformed input
   *     rejects with a localized `ValidationError` BEFORE any database read;
   *     the submitted string is never logged.
   *  2. Fresh parent re-check (identity + role + governance).
   *  3. ONE `withTransaction(outerTx, …)` with ONE captured `now`:
   *     discovery → null-collapse (missing ≡ governed) →
   *     already-linked conflict → already-pending conflict (pre-check + the
   *     partial-unique 23505 arbiter) → field-by-field insert →
   *     recipient-locale copy → in-tx emit.
   *  4. Own-commit path ONLY: one post-commit `publishReceipts`.
   *
   * @returns The outgoing payload (masked student name, verbatim inserted
   *     timestamps), or `null` when the code matches no eligible student —
   *     byte-identical for a missing code and a governed child.
   * @throws ValidationError  malformed code (pre-DB).
   * @throws ConflictError    `PARENT_LINK_TARGET_ALREADY_LINKED` or
   *     `PARENT_LINK_ALREADY_PENDING` (pre-check or 23505 arbiter).
   */
  export async function requestLink(
    code: string,
    parentActorId: number,
    locale: string,
    outerTx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<OutgoingParentLinkRequestReturnType | null> {
    const t = getServerTranslations(locale).errorsTranslations;

    // 1. Normalize THEN validate — strictly before any database read.
    const normalized = normalizeHandshakeCode(code);
    if (!isHandshakeCode(normalized)) {
      logger.logDomainError("Parent-link request rejected: malformed handshake code submitted", {
        code: "VALIDATION",
        entity: "students",
        locale,
      });
      throw new ValidationError(t.handshakeCodeInvalid);
    }

    // 2. Fresh actor re-check (parent) — governance enforced on mutations.
    const actor = await requireActor(parentActorId, UserRole.Parent, locale, outerTx, true);

    // 3. ONE atomic unit — own commit or the caller's savepoint.
    const outcome = await withTransaction(outerTx, async tx => {
      const inserted = await insertPendingRequestTx(normalized, parentActorId, locale, tx);
      if (inserted === null) {
        return null;
      }
      const emitted = await emitRequestNotificationTx(
        inserted.studentId,
        inserted.created.id,
        actor.fullName,
        tx,
        options
      );
      return {
        created: inserted.created,
        targetFullName: inserted.targetFullName,
        receipt: emitted.receipt,
        recipientLocale: emitted.recipientLocale,
      };
    });

    if (outcome === null) {
      return null;
    }

    // 4. Publish AFTER commit — and only when THIS call owns the commit.
    if (outerTx === undefined) {
      await NotificationEngine.publishReceipts([outcome.receipt], outcome.recipientLocale, options);
    }

    return {
      id: outcome.created.id,
      status: toCanonicalLinkStatus(outcome.created.status, outcome.created.id),
      studentMaskedName: maskFullName(outcome.targetFullName),
      createdAt: outcome.created.createdAt,
      expiresAt: outcome.created.expiresAt,
      respondedAt: outcome.created.respondedAt,
    };
  }

  /**
   * The deciding student accepts (`accept = true`) or rejects
   * (`accept = false`) one of his incoming requests.
   *
   * The guarded claim is the FIRST statement inside the transaction; its
   * zero-row collapse is re-classified via `findById` (nonexistent ≡ foreign
   * → constant `PARENT_LINK_REQUEST_NOT_FOUND`; resolved →
   * `PARENT_LINK_REQUEST_ALREADY_RESOLVED`; pending-but-stale → the expiry is
   * MATERIALIZED in a unit that SURVIVES the denial (the row
   * persists as `expired`) then `PARENT_LINK_REQUEST_EXPIRED`). The accept branch then
   * writes the link through the guarded `linkParentIfUnlinked` — a zero-row
   * collapse there THROWS and rolls back the ENTIRE transaction (claim
   * included; ghost confirmations are impossible) — and expires the
   * student's sibling pendings. Both branches notify the PARENT in the
   * parent's persisted locale, in-tx; publish on own-commit only.
   *
   * @returns The incoming payload re-read via `findIncomingRowById` (carries
   *     the parent's full display name).
   */
  export async function respondToLinkRequest(
    requestId: number,
    accept: boolean,
    studentActorId: number,
    locale: string,
    outerTx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<IncomingParentLinkRequestReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Fresh actor re-check (student) — governance enforced on mutations.
    const actor = await requireActor(studentActorId, UserRole.Student, locale, outerTx, true);

    const outcome = await withTransaction(outerTx, async (tx): Promise<RespondOutcome> => {
      const now = new Date(); // ONE captured instant: claim stamp + liveness.

      const claim = await ParentLinkRequestRepository.respondToPendingForStudent(
        requestId,
        studentActorId,
        accept ? LinkStatus.Confirmed : LinkStatus.Rejected,
        now,
        tx
      );

      if (claim === null) {
        // Zero-row collapse — classify honestly and READ-ONLY inside the
        // unit; the denial itself is raised AFTER the boundary so the
        // expiry fold can survive the throw (own-commit path).
        const denial = await classifyUnclaimableRequest(requestId, studentActorId, "student", tx);
        return { kind: "denied", denial };
      }

      if (accept) {
        // The guarded link write is the FINAL arbiter: a zero-row
        // collapse means the student was linked concurrently — the THROW
        // rolls back the whole transaction (claim + expiry + notification).
        const linked = await StudentRepository.linkParentIfUnlinked(studentActorId, claim.parentId, tx);
        if (linked === null) {
          logger.logDomainError("Parent-link confirm rejected: the student is already linked", {
            code: "PARENT_LINK_TARGET_ALREADY_LINKED",
            entity: "students",
            entityId: studentActorId,
            locale,
          });
          throw new ConflictError("PARENT_LINK_TARGET_ALREADY_LINKED", t.parentLinkTargetAlreadyLinked);
        }
        // Sibling pendings of the winner's student are terminal — once a
        // link exists they can never be claimed.
        await ParentLinkRequestRepository.expireSiblingPendingsForStudent(studentActorId, claim.id, tx);
      }
      // Reject branch: NO students write, NO sibling expiry — rejection
      // leaves the student's other pendings live ("children choose parents").

      // The PARENT is the notified party (accepted and rejected copy alike),
      // in the PARENT's persisted locale.
      const parentLocales = await UserRepository.findLocalesByIds([claim.parentId], tx);
      const parentLocale = parentLocales.get(claim.parentId) ?? defaultLocale;
      const parentCopy = getServerTranslations(parentLocale).notificationsTranslations;

      const emitted = await NotificationEngine.emitForUser(
        {
          userId: claim.parentId,
          type: NotificationType.ParentLinkRequest,
          title: accept ? parentCopy.eventParentLinkAcceptedTitle : parentCopy.eventParentLinkRejectedTitle,
          body: accept
            ? parentCopy.eventParentLinkAcceptedBody(actor.fullName)
            : parentCopy.eventParentLinkRejectedBody(actor.fullName),
          relatedEntityType: PARENT_LINK_RELATED_ENTITY_TYPE,
          relatedEntityId: claim.id,
        },
        parentLocale,
        tx,
        options
      );
      if (!isDeliveryReceipt(emitted)) {
        throw new Error(
          "ParentLinkRequestService.respondToLinkRequest: in-tx emit returned a row instead of the receipt"
        );
      }

      const row = await ParentLinkRequestRepository.findIncomingRowById(claim.id, tx);
      if (row === null) {
        throw new Error("ParentLinkRequestService.respondToLinkRequest: claimed row vanished before the read-back");
      }

      return { kind: "claimed", row, receipt: emitted, parentLocale };
    });

    if (outcome.kind === "denied") {
      throw await raiseUnclaimableDenial(requestId, outcome.denial, locale, outerTx);
    }

    if (outerTx === undefined) {
      await NotificationEngine.publishReceipts([outcome.receipt], outcome.parentLocale, options);
    }

    return mapIncoming(outcome.row, new Date());
  }

  /**
   * The requesting parent withdraws one of his live pending requests.
   *
   * The withdrawal FOLDS the row to `rejected` (the flipped row persists
   * forever as request history) and is SILENT: zero notifications, zero
   * publishes, on success AND on every denial arm. Zero-row
   * collapse re-classifies exactly like the respond path (constant not-found
   * shape; already-resolved conflict; pending-but-stale materializes the
   * expiry first).
   *
   * @returns The outgoing payload re-read via `findOutgoingRowById`.
   */
  export async function cancelLinkRequest(
    requestId: number,
    parentActorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<OutgoingParentLinkRequestReturnType> {
    // Fresh actor re-check (parent) — governance enforced on mutations.
    await requireActor(parentActorId, UserRole.Parent, locale, outerTx, true);

    const outcome = await withTransaction(outerTx, async (tx): Promise<CancelOutcome> => {
      const now = new Date();

      const cancelled = await ParentLinkRequestRepository.cancelPendingForParent(requestId, parentActorId, now, tx);
      if (cancelled === null) {
        // Zero-row collapse — classify READ-ONLY here; the denial (and the
        // expiry fold on the expired arm) is raised after the
        // boundary so the fold survives the throw on the own-commit path.
        const denial = await classifyUnclaimableRequest(requestId, parentActorId, "parent", tx);
        return { kind: "denied", denial };
      }

      const row = await ParentLinkRequestRepository.findOutgoingRowById(requestId, tx);
      if (row === null) {
        throw new Error("ParentLinkRequestService.cancelLinkRequest: cancelled row vanished before the read-back");
      }
      return { kind: "cancelled", row };
    });

    if (outcome.kind === "denied") {
      throw await raiseUnclaimableDenial(requestId, outcome.denial, locale, outerTx);
    }

    // Silent withdrawal: NO emit, NO publish — on this and every arm.
    return mapOutgoing(outcome.row, new Date());
  }

  /**
   * Sweep primitive — bulk-materializes every lapsed live pending row to
   * `expired` inside ONE transaction (the unit of work a future
   * cron-stream job registers as its handler).
   *
   * System-scope by design: NO actor re-check (the fresh actor re-check
   * governs user-facing mutations; a future cron-stream job owns the
   * trigger identity and its guard). ONE captured `now` for the whole unit — the expiry side of
   * the strict-`>` liveness boundary (`expires_at <= now` is lapsed, the
   * same deterministic instant the respond path pins at chaos tier).
   *
   * Silence: ZERO notifications, ZERO publishes, ZERO
   * audit rows, ZERO happy-path logs — expiry has no audience-facing event,
   * and the read side already renders the computed `Expired` chip, so
   * materialization changes storage only (the silent-expiry re-request
   * lockout documented in the canonical doc §5 is what a sweep run lifts:
   * after materialization the pair's `findPendingByPair` answer collapses
   * and a fresh `requestLink` succeeds).
   *
   * @param outerTx Optional caller-owned transaction — a caller-owned unit
   *   joins it and NEVER owns the commit boundary (publish-after-commit
   *   discipline is moot here: the sweep never publishes on any arm).
   * @returns The number of rows materialized to `expired` (0 on a re-run).
   */
  export async function sweepExpiredRequests(outerTx?: DBTransaction): Promise<number> {
    return withTransaction(outerTx, async tx => {
      const now = new Date(); // ONE captured now — the whole unit shares it.
      return ParentLinkRequestRepository.markAllExpiredIfPending(now, tx);
    });
  }

  /**
   * Expiry-reminder primitive — the notification-carrying counterpart of
   * the sweep: claims every live pending request whose expiry falls inside
   * the reminder window and sends its requesting parent ONE localized
   * reminder, inside ONE transaction (the second unit of work a future
   * cron-stream job registers as its handler).
   *
   * System-scope by design: NO actor re-check (the sweep's exact
   * carve-out — system writes carry no user-facing actor re-check; a future
   * cron-stream job owns the trigger identity).
   * ONE captured `now` drives BOTH sides of the claim window — strict-`>`
   * liveness (`expires_at > now`: a row at or past now has lapsed and is the
   * SWEEP's business, never the reminder's) and the inclusive horizon
   * (`expires_at <= now + horizonHours`).
   *
   * Dedupe is the claim itself: the repo claim sets `reminder_sent_at` in
   * the SAME guarded statement that selects the rows (`IS NULL` conjunct +
   * row locks serialize claimers), so repeated or concurrent triggers can
   * never double-remind — no idempotency cache, no notification probe, no
   * extra bookkeeping. The emissions join the claim's transaction: a failure
   * anywhere rolls markers AND inbox rows back together (all-or-nothing).
   *
   * Copy (masked-name rule + engine §3.3): the reminder interpolates the student's
   * MASKED name (`maskFullName`) — a pre-decision parent-bound surface may
   * not carry the full name (the code-holder learns nothing new until the
   * student confirms) — composed in the PARENT's persisted locale
   * (`defaultLocale` fallback), never the caller's, never hardcoded. The
   * row reuses the `ParentLinkRequest` notification type with
   * `relatedEntityId` pointing at the request (inbox deep-link parity with
   * the other lifecycle events).
   *
   * Silence elsewhere: no audit rows, no happy-path logs, no
   * student-side notification (the student owns the decision surface and
   * already sees the pending row; the reminder chases the REQUESTER). The
   * ops-facing realtime publish is intentionally NOT wired — the inbox rows
   * surface on the next load/badge poll; a future cron-stream job owns the
   * publish choreography for scheduled runs.
   *
   * @param input.horizonHours The reminder window length in hours (default
   *   24 — "expiring within a day"; must be a positive integer, hard-capped
   *   at 168 = one full request lifetime so the window can never exceed the
   *   7-day lifecycle).
   * @param input.outerTx Optional caller-owned transaction — a caller-owned
   *   unit joins it and never owns the commit boundary.
   * @param input.options Engine call options passed through to every emit.
   * @returns The number of reminders emitted (= rows claimed; 0 on a
   *   re-run, outside-window, or already-terminal population).
   */
  export async function sendExpiryReminders(input?: {
    readonly horizonHours?: number;
    readonly outerTx?: DBTransaction;
    readonly options?: NotificationEngineCallOptions;
  }): Promise<number> {
    const horizonHours = input?.horizonHours ?? DEFAULT_EXPIRY_REMINDER_HOURS;
    if (!Number.isInteger(horizonHours) || horizonHours <= 0 || horizonHours > MAX_EXPIRY_REMINDER_HOURS) {
      throw new ValidationError(`horizonHours must be an integer in (0, ${MAX_EXPIRY_REMINDER_HOURS}]`);
    }
    return withTransaction(input?.outerTx, async tx => {
      const now = new Date(); // ONE captured now — liveness side AND marker value.
      const horizon = new Date(now.getTime() + horizonHours * EXPIRY_REMINDER_HOUR_MS);
      const claimed = await ParentLinkRequestReminderRepository.claimPendingForExpiryReminder(now, horizon, tx);
      if (claimed.length === 0) {
        return 0;
      }
      const studentNames = await ParentLinkRequestReminderRepository.listStudentFullNamesByIds(
        claimed.map(row => row.studentId),
        tx
      );
      const parentLocales = await UserRepository.findLocalesByIds(
        claimed.map(row => row.parentId),
        tx
      );
      // Sequential in-tx emission via a recursive walker (the sanctioned
      // no-await-in-loop escape): the emits share ONE transaction connection,
      // so Promise.all is not an option here — pg cannot interleave parallel
      // commands on a single client. The walker CONSUMES the claimed list
      // (shift), which also keeps the index arithmetic out of the picture.
      const emitClaimed = async (): Promise<number> => {
        const row = claimed.shift();
        if (row === undefined) {
          return 0;
        }
        const rawName = studentNames.get(row.studentId);
        if (typeof rawName !== "string") {
          // Unreachable while the FKs hold (ON DELETE RESTRICT keeps the
          // student alive while the request exists) — a missing name means
          // data drift and MUST abort the unit, not emit a nameless copy.
          throw new Error(
            `ParentLinkRequestService.sendExpiryReminders: student ${row.studentId} of request ${row.id} has no user row`
          );
        }
        const locale = parentLocales.get(row.parentId) ?? defaultLocale;
        const copy = getServerTranslations(locale).notificationsTranslations;
        const emitted = await NotificationEngine.emitForUser(
          {
            userId: row.parentId,
            type: NotificationType.ParentLinkRequest,
            title: copy.eventParentLinkExpiringTitle,
            body: copy.eventParentLinkExpiringBody(isolateBidi(maskFullName(rawName))),
            relatedEntityType: PARENT_LINK_RELATED_ENTITY_TYPE,
            relatedEntityId: row.id,
          },
          locale,
          tx,
          input?.options
        );
        if (!isDeliveryReceipt(emitted)) {
          throw new Error(
            "ParentLinkRequestService.sendExpiryReminders: in-tx emit returned a row instead of the receipt"
          );
        }
        return 1 + (await emitClaimed());
      };
      return emitClaimed();
    });
  }

  /**
   * The requesting parent's link-request history (newest first, LIMIT 50),
   * self-scoped on the VERIFIED actor id. Relaxed re-check: identity + role
   * only — a governed parent still sees his own history. Render-time expiry:
   * a stored `pending` row with `expiresAt <= now` surfaces
   * `LinkStatus.Expired` WITHOUT any write (read purity). Reads
   * never publish.
   */
  export async function listMyOutgoing(
    parentActorId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<OutgoingParentLinkRequestReturnType[]> {
    await requireActor(parentActorId, UserRole.Parent, locale, tx, false);
    const rows = await ParentLinkRequestRepository.listOutgoingForParent(parentActorId, tx);
    const now = new Date(); // ONE render instant for the whole page.
    return rows.map(row => mapOutgoing(row, now));
  }

  /**
   * The deciding student's incoming link-request history (newest first,
   * LIMIT 50), self-scoped on the VERIFIED actor id. Relaxed re-check and
   * render-time expiry mapping exactly like `listMyOutgoing`; each row
   * carries the requesting parent's FULL display name (the deciding student
   * must know who is asking). Reads never publish.
   */
  export async function listMyIncoming(
    studentActorId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<IncomingParentLinkRequestReturnType[]> {
    await requireActor(studentActorId, UserRole.Student, locale, tx, false);
    const rows = await ParentLinkRequestRepository.listIncomingForStudent(studentActorId, tx);
    const now = new Date(); // ONE render instant for the whole page.
    return rows.map(row => mapIncoming(row, now));
  }
}
