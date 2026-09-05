# Session-Request Notification Waves

Canonical reference for the session-request notification emitters: the six lifecycle waves that notify teacher and student as a session request moves from intake through its resolution. This module consumes the real-time notification engine (`docs/notifications/realtime-engine.md`); it does not extend it.

## 1. Why

A session booking is a two-sided conversation: a student requests a session with a teacher, and the teacher's request preference (accept, decline, auto-reject, queue, or offer alternatives) determines what the student hears back. Both sides need durable inbox rows and real-time pushes, but the engine is deliberately dumb — it persists rows and pushes envelopes, never translates, never resolves recipients, never knows anything about sessions. Someone has to own the session-specific seam: reading the session row, resolving both participants, composing localized copy, and emitting per wave. That seam is `SessionRequestNotificationService` (`backend/services/classes/session-request-notification.service.ts`).

The consumers are the session lifecycle flows: session intake and the accept/decline mutations call these emitters from inside their own transactions, and the future session engine routes teacher preferences onto the outcome waves. Frontend needs nothing new — the existing inbox, badge, and toast surfaces already read the `session_request` type and resolve `relatedEntityId` links.

## 2. Pattern

Six emitters, all sharing one signature and one internal choreography: `(sessionId, locale, tx?, options?)`. The session id is the only **identity** input — recipients are never parameters. The caller-supplied `locale` localizes only this module's error copy (validation, not-found, corrupt-intent rejections); wave title/body are always composed in the recipient's persisted locale (step 4), never in this caller locale. Each emitter:

1. Validates the id pre-DB (positive safe integer; hostile ids reject with `VALIDATION` without touching the database).
2. Reads the joined wave context (`SessionRepository.findWaveContextById`) — one query joining `session` to both `users` rows, returning session id, raw stored intent, and each participant's id, full name, and persisted locale.
3. Fails closed: a missing row rejects with `SESSION_NOT_FOUND`; a null or unrecognized stored intent rejects with `SESSION_INTENT_CORRUPT` — each with exactly one bounded domain log.
4. Resolves the recipient and counterparty by wave side, and composes title/body in the **recipient's** persisted locale (falling back to the platform default when the user row carries none).
5. Assembles the emit input field-by-field and calls `NotificationEngine.emitForUser` — the module's only write path.
6. Returns the delivery receipt. Publishing is the caller's job (see Rules).

### The six waves

| Emitter | Recipient side | Title slot | Body slot (args) |
|---|---|---|---|
| `notifyTeacherOfSessionRequest` | teacher | `eventSessionRequestTitle` | `eventSessionRequestBody(studentName, intentLabel)` |
| `notifyStudentOfSessionAccepted` | student | `eventSessionAcceptedTitle` | `eventSessionAcceptedBody(teacherName)` |
| `notifyStudentOfSessionDeclined` | student | `eventSessionDeclinedTitle` | `eventSessionDeclinedBody(teacherName)` |
| `notifyStudentOfSessionAutoRejected` | student | `eventSessionAutoRejectedTitle` | `eventSessionAutoRejectedBody(teacherName)` |
| `notifyStudentOfSessionQueued` | student | `eventSessionQueuedTitle` | `eventSessionQueuedBody(teacherName)` |
| `notifyStudentOfAlternativesOffered` | student | `eventSessionAlternativesOfferedTitle` | `eventSessionAlternativesOfferedBody(teacherName)` |

The intent label comes from `intentHifz` / `intentTajweed` / `intentEvaluation`, chosen by an exhaustive switch over the validated `SessionIntent` enum. All twelve wave slots plus the three intent labels live in the existing `notifications` locale namespace; the two error strings are flat keys in the existing `errors` namespace.

Every wave emits with the same fixed envelope:

- `type = session_request` (`NotificationType.SessionRequest`) for all six waves — the event nuance lives in the localized title/body, not the type.
- `relatedEntityType = "session"`, `relatedEntityId = session.id`.
- Idempotency key `` `session:${sessionId}:${waveKind}` `` — deterministic per (session, wave), where `waveKind` is one of `teacher_request`, `outcome_accepted`, `outcome_declined`, `outcome_auto_rejected`, `outcome_queued`, `outcome_alternatives_offered`. Replay of the same wave returns the stored receipt with zero new rows and zero new publishes.
- Copy interpolates only the counterparty's full name and the intent label — no ids, contacts, or amounts ever reach the stored copy.

## 3. Rules

- **Single-writer composition.** Every session notification row in the system flows through `NotificationEngine` — this module never inserts into `notifications` directly and never touches the fanout transport. The repository (`SessionRepository`) is read-only.
- **Caller-tx receipt / publish-after-commit.** When the caller hands in its transaction, the engine persists inside it and returns a delivery receipt carrying an `emitClaimKey`, and **no publish happens**. The caller publishes strictly after its own commit via `NotificationEngine.publishReceipts`. A rolled-back caller transaction therefore can never ghost-push. When no transaction is handed in, the engine commits its own unit, stores the claim receipt, and publishes exactly once; a deterministic replay returns the previously stored receipt with zero new rows and zero new publishes.
- **Typed breach guard on the caller-tx return.** The engine's emit call statically returns `NotificationReturnType | NotificationDeliveryReceipt`. On the caller-tx path the receipt shape is contractual, so the module narrows the union with a structural check whose contractually-impossible branch throws a typed `DomainError` with code `INTERNAL_SERVER_ERROR` — the impossible branch is kept fully typed rather than silenced with an `as` cast, and it is test-pinned by stubbing the engine to violate its own contract.
- **Recipient-locale composition is this module's obligation.** The engine stores copy verbatim and never translates; per-recipient localization is the emitter-side obligation the engine doc leaves open (realtime-engine §3.3). This module is the first emitter in the tree to fully implement it: it reads both participants' persisted locales in its single joined read, composes each wave's copy in the recipient's locale, and passes that same locale to the engine.
- **Identity is read, never accepted.** Recipients derive exclusively from the joined read of the session's own row. Emitters perform no authorization of their own — who may trigger a wave is the owning intake/accept-decline flow's ruling, made before calling in.
- **Emitters do not filter governed participants.** Governance (suspension, deletion, blocking) is deliberately not enforced here: a session's participants receive their wave rows as stored. The governance ruling belongs to the future intake gate, and the documented engine-side governance-window posture (realtime-engine §3.10) is unchanged by this module.
- **Internal error surface is not a public oracle.** `SESSION_NOT_FOUND` is a service-internal signal from a module with no public surface. It is **not** precedential for any future public intake endpoint — a public session-intake surface must make its own oracle-hygiene ruling rather than re-exposing this module's rejection shapes.
- **Session ids are int4.** `session.id` is a 32-bit identity column. Ceiling-sensitive callers must not assume wider ids; boundary probing belongs at the int4 ceiling (`2_147_483_647` — a validly-shaped, guaranteed-absent id), because binding a 64-bit sentinel such as `2^53 - 1` into an int4 comparison raises a Postgres range error instead of producing a miss.
- **Closed payload.** The emit input and the realtime envelope carry exactly the fields listed in §2. No CTA metadata, action buttons, or extra projection joins — widening the realtime payload is an engine-owned change, not an emitter change.

## 4. What NOT to Do

- **Never emit session notifications outside this module.** If a flow needs a new session wave shape, extend this module (and its locale slots), don't hand-roll `NotificationEngine` calls in a session service.
- **Never widen the realtime payload for CTAs.** Accept/decline actions are driven by the client reading `relatedEntityId` and calling the session mutations; adding action metadata to the push envelope is an engine-projection change owned elsewhere.
- **Never pass recipient ids as parameters.** The signature is `(sessionId, locale, tx?, options?)` — adding a recipient parameter re-opens identity smuggling.
- **Never trust caller-supplied participants.** Re-read the session row through the joined context read on every wave; do not accept participant snapshots from the caller.
- **Never mutate session state.** This module is a read-and-notify seam. Status transitions, queueing, and alternative-teacher selection belong to the session engine.
- **Never log raw keys or PII.** Logs carry only `{ code, entity: "session", entityId, locale }`; idempotency-key digests are engine-internal; names appear in stored copy, never in logs.

## 5. Rollout Summary

Shipped with zero schema, zero GraphQL, and zero frontend surface — the existing notification drawer, badge, and toast consume the emitted rows unchanged.

| File | Change |
|---|---|
| `backend/types/classes/session-notification.types.ts` | **Created** — wave kinds union, joined context row, participant context, validated context types |
| `backend/types/classes/index.ts` | Extended barrel (one re-export line) |
| `backend/db/repo/classes/session.repository.ts` | **Created** — `findById` + `findWaveContextById` joined read, tx/non-tx driver split |
| `backend/db/repo/classes/index.ts` | **Created** barrel |
| `backend/db/repo/index.ts` | Extended barrel (one `classes` line) |
| `backend/services/classes/session-request-notification.service.ts` | **Created** — the six emitters + shared choreography |
| `backend/services/classes/index.ts` | **Created** barrel |
| `backend/services/index.ts` | Extended barrel (one `classes` line) |
| `shared/locale/types/notifications/index.ts` | 15 new slots (six titles, six body functions, three intent labels) |
| `shared/locale/en/notifications/index.ts`, `shared/locale/ar/notifications/index.ts` | Concrete en/ar copy for the 15 slots |
| `shared/locale/types/errors/index.ts` | Two flat keys: `sessionNotFound`, `sessionIntentCorrupt` |
| `shared/locale/en/errors/index.ts`, `shared/locale/ar/errors/index.ts` | en/ar error copy |
| `shared/locale/notifications-namespace.parity.test.ts` | Parity inventory extended (26 → 41 mandated keys, 4 → 10 function slots) |
| `backend/db/repo/classes/__tests__/session.repository.test.ts` | **Created** — repository unit tests (10 tests) |
| `backend/services/classes/session-request-notification.service.test.ts` | **Created** — four-tier service suite (20 tests: branch, boundary, chaos, security) |
| `test/workflows/classes/session-request-notifications.journey.test.ts` | **Created** — cross-actor journey with committed fixtures and spied transport (9 steps) |
| `docs/notifications/realtime-engine.md` | Shipped-pointer line in the emitter consumption table |

## 6. Forward Consumption Contract

| Owning ticket | Contract |
|---|---|
| DEV3-004 / DEV3-005 (session intake + accept/decline) | The intake mutation calls `notifyTeacherOfSessionRequest`; the accept/decline mutations call the corresponding outcome emitters. These flows own `session` row authorship and authorization, and publish receipts after their own commits. |
| DEV2-011 (in-session detection) | In-session availability/detection signals do not flow through these waves; that surface consumes session presence, not the request lifecycle. |
| DEV3-008 (alternatives computation) | Computes the alternative-teacher set and routes the teacher's `offer_alternatives` preference onto `notifyStudentOfAlternativesOffered`; the matching surplus itself lives with that ticket. |
| Session-engine design era | Queue persistence for the `queue` preference (no pending-request entity exists yet) and preference→wave routing resolution land with the session engine; the `outcome_queued` / `outcome_alternatives_offered` emitters are the emission half, ready today. |

This module is the emitter those engines call: they own state transitions and routing, these six functions own every session-request notification row and push.

## 7. Related Documents

- `docs/notifications/realtime-engine.md` — the engine this module consumes (persist-first/push-second, caller-tx receipt composition, localization-at-emitter boundary, governance window)
- `docs/IDEMPOTENCY.md` — general idempotency posture; the engine's fail-open emit-claim deviation is documented in the engine doc
- `docs/specs/state-machine-invariants.md` — this module mints no new invariants; the session state machine lives with the session engine
- `backend/services/AGENTS.md`, `backend/db/repo/AGENTS.md` — layer rules (single-writer emissions, repository discipline)
- `shared/locale/` — the compile-time translation system hosting the notification copy slots
