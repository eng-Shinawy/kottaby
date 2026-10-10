# Billing workflow journey diagrams

Mermaid diagrams for the cross-actor journey suites in this directory, using the same actor names, service entry points, and statuses as the journey code. The `paymob-live-tunnel` suite is env-gated (`PAYMOB_LIVE_TESTS=1` + live credentials + reserved ngrok domain) and skips outside that environment — its diagram documents the code path regardless.

## admin-financial-auditing.journey.test.ts

Journey across the two money ledgers through the real `WalletService` and `AdminFinancialAuditingService`: payout requests reserve their debit at request time, admin approve/reject settles the queue, manual adjustments credit/debit with exact audit rows, the payments audit filter scopes honestly, and the denial matrix plus concurrent double-settlement and settle-plus-new-request races prove exactly-once money movement with zero dispatches.

```mermaid
sequenceDiagram
  autonumber
  participant teacherA as "Teacher A - funded wallet 500.00"
  participant teacherB as "Teacher B - funded wallet 300.00"
  participant student as "Student - payments audit fixture"
  participant admin as "Admin - auditing actor"
  participant suspended as "Suspended admin - fail-closed governance gate"
  participant walletSvc as "WalletService"
  participant auditSvc as "AdminFinancialAuditingService"
  participant db as "Postgres ledger and audit_logs"

  teacherA->>walletSvc: requestWithdrawal 100.00
  walletSvc->>db: pending withdrawal row plus guarded balance debit
  admin->>auditSvc: listPendingWithdrawalsForAdmin sees the row with teacher name
  admin->>auditSvc: approveWithdrawal
  auditSvc->>db: row completed, queue drains, ONE Override audit row
  teacherA->>walletSvc: getMyWallet shows settled row, balance unchanged

  teacherB->>walletSvc: requestWithdrawal 50.00
  admin->>auditSvc: rejectWithdrawal with reason
  auditSvc->>db: row failed, reserve restored, ONE Override audit row

  admin->>auditSvc: adjustTeacherWallet credit 25.50
  auditSvc->>db: bonus completed row, balance up, totalEarning unchanged, ONE Adjust audit row
  admin->>auditSvc: adjustTeacherWallet debit 10.00
  auditSvc->>db: withdrawal completed row with manual-adjustment description, ONE Adjust audit row
  admin->>auditSvc: adjustTeacherWallet debit 9999999.00
  auditSvc--xadmin: ConflictError insufficientBalance, ZERO new ledger rows
  admin->>auditSvc: getTeacherWalletForAdmin reflects the adjusted wallet

  admin->>auditSvc: listStudentPaymentsForAdmin status Paid
  auditSvc-->>admin: 2 matching rows with resolved student name
  admin->>auditSvc: listStudentPaymentsForAdmin status Refunded
  auditSvc-->>admin: honest empty page, student rows byte-identical

  teacherA->>auditSvc: approveWithdrawal as teacher
  auditSvc--xteacherA: ForbiddenError forbidden, zero audit rows
  student->>auditSvc: listPendingWithdrawalsForAdmin
  auditSvc--xstudent: ForbiddenError forbidden
  suspended->>auditSvc: listPendingWithdrawalsForAdmin
  auditSvc--xsuspended: ForbiddenError accountSuspended, fail-closed
  Note over auditSvc,db: anonymous caller gets UnauthorizedError unauthorized on every surface

  teacherA->>walletSvc: requestWithdrawal 20.00 then two concurrent approveWithdrawal calls race
  auditSvc->>db: exactly ONE fulfilled, loser ConflictError withdrawalNotPending, ONE audit row
  teacherB->>walletSvc: requestWithdrawal 20.00 then admin approves A while teacher requests B
  auditSvc->>db: A completed, B pending, final balance = start minus A minus B

  teacherB->>walletSvc: requestWithdrawal 60.00 then admin rejects it
  admin->>auditSvc: approveWithdrawal replay on the failed row
  auditSvc--xadmin: ConflictError withdrawalNotPending, ledger stays failed, zero new audit rows
  admin->>auditSvc: rejectWithdrawal replay on the failed row
  auditSvc--xadmin: ConflictError withdrawalNotPending, balance byte-identical
```

## financial-safety-verification.journey.test.ts

Adversarial money-safety journey through the real `SessionLifecycleService`, `WalletService`, and `WalletRepository`: a double-spend race over one escrow unit, cancel release back to the provenance lane, dual-confirm crediting, a withdrawal drain race, input fuzz, a wallet-first-earning race, an append-only trigger tamper probe, and oracle-safe denials.

```mermaid
sequenceDiagram
  autonumber
  participant student as "Student A - one funded hifz unit"
  participant nonPart as "Non-participant student"
  participant teacher as "Teacher - session owner"
  participant teacher2 as "Teacher 2 - credit race target"
  participant parent as "Parent - no teacher profile"
  participant sessionSvc as "SessionLifecycleService"
  participant walletSvc as "WalletService"
  participant walletRepo as "WalletRepository"
  participant db as "Postgres - sessions, wallets, teacher_transaction"

  student->>sessionSvc: createSession 4 concurrent bookings under OWN idempotency keys
  sessionSvc->>db: exactly ONE wins the hifz unit, losers INSUFFICIENT_BALANCE or DUPLICATE_REQUEST, zero loser writes
  sessionSvc-->>student: won session W with heldBalanceLane Hifz, fee SESSION_FEE_HIFZ

  student->>sessionSvc: cancelSession on W
  sessionSvc->>db: unit returns to hifz lane exactly once, lane never rewritten, no teacher movement
  student->>sessionSvc: cancelSession replay on terminal W
  sessionSvc--xstudent: ConflictError SESSION_INVALID_TRANSITION, zero writes

  student->>sessionSvc: createSession re-book under key C, teacher startSession then completeSession
  sessionSvc-->>student: ONE confirm prompt published to the student only
  student->>sessionSvc: confirmSessionCompletion
  walletRepo->>db: ONE earning ledger row, wallet credited SESSION_FEE_HIFZ once, hold consumed

  teacher->>walletSvc: requestWithdrawal two concurrent calls over single-fee balance
  walletSvc->>db: exactly ONE pending withdrawal debit, loser WALLET_INSUFFICIENT_FUNDS, balance exactly 0.00

  teacher->>walletSvc: requestWithdrawal amount fuzz matrix
  walletSvc--xteacher: WALLET_INVALID_AMOUNT pre-DB, zero writes

  Note over teacher2,db: ensureWalletOnce pre-ensures wallet 2 then two concurrent creditEarningOnce credits
  walletRepo->>db: both credits land, ONE wallet row, totals sum exactly 25.00

  Note over db: direct UPDATE on teacher_transaction blocked by append-only trigger, row byte-identical

  nonPart->>sessionSvc: confirmSessionCompletion on session C
  sessionSvc--xnonPart: SESSION_NOT_FOUND oracle-safe denial
  nonPart->>sessionSvc: cancelSession on session C
  sessionSvc--xnonPart: SESSION_NOT_FOUND oracle-safe denial, owner row byte-identical
  parent->>walletSvc: getMyWallet
  walletSvc--xparent: WALLET_TEACHER_PROFILE_MISSING denial
```

## plan-catalog-invariance.journey.test.ts

Cross-actor catalog-mutation invariance journey through the real `SubscriptionPurchaseService`, `SubscriptionActivationService`, `PlanCatalogService`, and `SessionLifecycleService`: a student's confirmed purchase credits the plan's lane, an admin's deactivation plus title/price edit mutates the plans row ONLY (exactly two audit rows, zero dispatches), the subscription row and credited lane stay byte-identical while the public `planCatalog` query drops the plan and the admin surface still lists it, and a subsequent booking on the credited lane succeeds — with the admin gate honestly denying the student's own deactivation attempt first.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - fixtures"
  participant studentS as "Student S - purchaser"
  participant admin as "Admin A - catalog owner"
  participant observer as "Observer O - fellow student"
  participant purchaseSvc as "SubscriptionPurchaseService"
  participant activation as "SubscriptionActivationService.processWebhookEvent"
  participant catalogSvc as "PlanCatalogService"
  participant gql as "GraphQL planCatalog scope gate"
  participant sessionSvc as "SessionLifecycleService.createSession"
  participant db as "Postgres - plans, subscriptions, lanes, audit_logs"

  system->>db: cast plus hifz-lane plan committed in ONE transaction, registry-tracked
  system->>catalogSvc: listActiveCatalog lists the plan
  observer->>gql: planCatalog query
  gql-->>observer: plan listed (pre-deactivation premise)

  studentS->>purchaseSvc: purchase plan, key KEY_PURCHASE
  purchaseSvc->>db: ONE pending pair plus junction plus verbatim claim
  system->>activation: confirmed gateway event
  activation->>db: payment paid, subscription active, balance_hifz = sessionCount, ONE notification and publish to S ONLY
  Note over system,db: step-2 byte-snapshots captured - subscription row and lanes

  studentS->>catalogSvc: setPlanActiveStatus false
  catalogSvc--xstudentS: ForbiddenError forbidden through the real admin gate, ZERO writes, plan byte-identical

  admin->>catalogSvc: setPlanActiveStatus false
  catalogSvc->>db: plan deactivated with deactivated_at, ONE Suspend audit row
  admin->>catalogSvc: updatePlan title and price
  catalogSvc->>db: plan edited, ONE Update audit row, ZERO subscription or lane writes, credit basis intact

  observer->>db: subscription row and credited lane byte-identical to the step-2 snapshots
  observer->>gql: planCatalog query
  gql-->>observer: plan ABSENT (PC1 re-proof)
  admin->>catalogSvc: listForAdmin includeInactive
  catalogSvc-->>admin: the deactivated, edited plan row

  studentS->>sessionSvc: book ONE hifz session with T, key KEY_BOOKING
  sessionSvc->>db: booking SUCCEEDS, heldBalanceLane hifz, lane minus 1, teacher request wave to T ONLY, subscription row STILL byte-identical, teacher_transaction zero rows
  Note over system,db: afterAll System teardown - audit rows swept under the sanctioned suspension, registry hard-delete, zero residue
```

## paymob-live-tunnel.journey.test.ts

Env-gated live twin of the paymob purchase journey: nothing is mocked at the provider boundary and the settlement callback rides a REAL ngrok tunnel into the REAL webhook route under the operator's REAL sandbox credentials (`PAYMOB_LIVE_TESTS=1` plus live credentials plus reserved domain; the suite skips otherwise).

```mermaid
sequenceDiagram
  autonumber
  participant student as "Student - purchaser"
  participant purchaseSvc as "SubscriptionPurchaseService"
  participant paymob as "REAL Paymob API - accept.paymob.com via pass-through recorder"
  participant tunnel as "REAL ngrok tunnel - reserved public domain"
  participant receiver as "In-process receiver - Bun.serve on loopback"
  participant webhook as "REAL webhook route POST"
  participant activation as "SubscriptionActivationService"
  participant db as "Postgres ledger and notifications"

  student->>purchaseSvc: purchase planId, key KEY_PURCHASE
  purchaseSvc->>paymob: POST v1/intention with real secret key and tunnel public callback URLs
  paymob-->>purchaseSvc: hosted-checkout descriptor
  purchaseSvc->>db: pending subscription plus pending payment, claim keyed verbatim

  Note over tunnel,webhook: deliverTestCallback confirmed outcome through the REAL tunnel
  tunnel->>receiver: public reserved domain forwards to loopback
  receiver->>webhook: signed POST under REAL PAYMOB_HMAC_SECRET
  webhook->>activation: verified event
  activation->>db: payment paid, subscription active with exact interval window, lane credited sessionCount
  activation->>db: ONE PaymentConfirmation notification to the purchaser only

  Note over tunnel,db: byte-identical replay through the tunnel again - replayed ack, zero double effects

  Note over webhook,db: tampered body posted at the PUBLIC webhook URL - masked 401 UNAUTHORIZED, zero state change

  student->>purchaseSvc: fresh purchase key KEY_FAILURE
  purchaseSvc->>paymob: intention created on the real vendor API
  Note over tunnel,activation: failed outcome delivered through the tunnel
  activation->>db: payment failed, subscription stays pending, failure notification persisted
```

## paymob-purchase-journey.test.ts

Student purchases through the real Paymob provider branch with the vendor's HTTP boundary as the only mocked hop: the signed settlement callback traverses the resolved simulation channel into the REAL webhook receiver, activation credits the lane exactly once, replays and tampered deliveries are inert, and a mismatched-amount callback is quarantined.

```mermaid
sequenceDiagram
  autonumber
  participant studentA as "Student A - hifz plan purchaser"
  participant studentB as "Student B - own key, own plan"
  participant purchaseSvc as "SubscriptionPurchaseService"
  participant fetchSpy as "Recording fetch over the provider boundary"
  participant channel as "Resolved simulation callback channel"
  participant webhook as "REAL webhook route POST"
  participant activation as "SubscriptionActivationService"
  participant db as "Postgres ledger, lanes, notifications"

  studentA->>purchaseSvc: purchase planA, key KEY_PURCHASE_A
  purchaseSvc->>fetchSpy: POST v1/intention with billing identity and correlation key
  fetchSpy-->>purchaseSvc: validated intention echo, no localhost callback URLs
  purchaseSvc->>db: ONE pending pair plus junction plus verbatim claim

  channel->>webhook: deliverTestCallback confirmed with PLAN_A_PRICE
  webhook->>activation: signed verified event
  activation->>db: payment paid with provider transaction id, subscription active, exact interval window
  activation->>db: hifz lane credited sessionCount, ONE notification published to Student A ONLY

  channel->>webhook: SAME signed callback re-delivered
  webhook-->>channel: replayed ack 200, no double credit, no second notification or publish

  Note over webhook,db: wrong-secret signature masked 401 before parsing, zero state change
  Note over webhook,db: tampered body with stale signature masked 401, zero state change

  studentA->>purchaseSvc: fresh purchase planB, key KEY_FAILURE_A
  channel->>webhook: failed settlement for KEY_FAILURE_A
  activation->>db: payment failed with provider reference, subscription stays pending, failure notification persisted

  studentB->>purchaseSvc: purchase planB, key KEY_PURCHASE_B
  channel->>webhook: confirmed settlement on B own reference
  activation->>db: B paid and active, tajweed lane credited, B notification - A rows byte-identical

  studentA->>purchaseSvc: fresh purchase planA, key KEY_MISMATCH_A
  channel->>webhook: verified-signature callback carrying PLAN_B_PRICE amount
  webhook-->>channel: ack quarantined, ONE bounded quarantine log
  webhook--xactivation: settlement refused - Student A stays pending, zero credit
```

## subscription-admin-lifecycle.journey.test.ts

One student's Hifz subscription travels the full admin-owned lifecycle through the real `SubscriptionAdminService`: extend, cancel, renew with idempotent replay, and a prorated plan change - each mutating step minting exactly one pinned audit row, every lane credit exact, and the whole journey emitting zero notifications by design.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - fixtures"
  participant admin as "Admin - producer"
  participant student as "Student - subscription owner"
  participant otherStudent as "Unrelated student - BOLA probe"
  participant adminSvc as "SubscriptionAdminService"
  participant purchaseSvc as "SubscriptionPurchaseService.listOwn"
  participant db as "Postgres - subscriptions, lanes, audit_logs"

  system->>db: cast plus two same-lane plans plus active Hifz subscription S, lane=4

  admin->>adminSvc: extendSubscription S plus 30 days
  adminSvc->>db: endDate shifted exactly 30d, ONE Update audit row
  student->>purchaseSvc: listOwn sees the extended window

  admin->>adminSvc: cancelSubscription S with reason
  adminSvc->>db: S cancelled, lanes byte-identical, ONE Suspend audit row
  student->>purchaseSvc: listOwn sees cancelled, lane preserved at LANE_SEED

  system->>db: expired subscription S2 fixture committed, lane drained to 0

  admin->>adminSvc: renewSubscription S2
  adminSvc->>db: fresh ACTIVE S3, lane plus 8, junction row, claim renew:S2, ONE Create audit row
  admin->>adminSvc: renewSubscription S2 replay
  adminSvc-->>admin: same S3 returned, NOTHING new minted

  admin->>adminSvc: changeSubscriptionPlan S3 to the smaller plan
  adminSvc->>db: S3 cancelled, S4 active on smaller plan, Downgrade with 0 carry and 8 forfeited, lane settles to 4, ONE Override audit row

  student->>adminSvc: cancelSubscription on own S4
  adminSvc--xstudent: ForbiddenError forbidden through the real admin gate, zero mint
  otherStudent->>adminSvc: listForAdmin otherStudentId
  adminSvc--xotherStudent: ForbiddenError forbidden BEFORE the repository read runs
```

## subscription-expiry-booking-denial.journey.test.ts

The two-covering-subscriptions lapse arc through the real sweep and booking services: a funded control booking proves the lane live, the sweep expires one subscription while the covering row keeps the lane intact, the covering row's own lapse zeroes the uncovered lane and denies booking against every teacher with a reusable idempotency key, and the admin renew re-credits the lane so the same previously-denied key books again - with an untouched control tenant byte-compared after every leg.

```mermaid
sequenceDiagram
  autonumber
  participant student as "Student - two covering subscriptions"
  participant controlStudent as "Control student - untouched tenant"
  participant teacherA as "Teacher A - booking target"
  participant teacherB as "Teacher B - cross-teacher denial probe"
  participant admin as "Admin - renew actor"
  participant system as "System - fixtures, backdate, sweep"
  participant sessionSvc as "SessionLifecycleService.createSession"
  participant expirySvc as "SubscriptionExpiryService.expireDue"
  participant adminSvc as "SubscriptionAdminService.renewSubscription"
  participant db as "Postgres - subscriptions, lanes, sessions, audit_logs"

  system->>db: cast, Hifz plan, TWO active covering subscriptions S1 S2, lane seeded 5, control tenant snapshot

  student->>sessionSvc: control booking with Teacher A
  sessionSvc->>db: session scheduled, hifz lane minus 1, ONE teacher wave to A only

  system->>db: backdate S1 endDate one hour past now - row stays active
  system->>expirySvc: expireDue
  expirySvc->>db: expired 1, lanesZeroed 0 - S1 expired, lane INTACT, covering S2 byte-identical, control byte-identical

  system->>db: backdate S2 endDate too
  system->>expirySvc: expireDue
  expirySvc->>db: expired 1, lanesZeroed 1 - uncovered hifz lane zeroed, trial untouched

  student->>sessionSvc: booking with Teacher A, key KEY_RECOVERY
  sessionSvc--xstudent: ValidationError SUBSCRIPTION_EXPIRED with localized copy, ZERO rows, key not burned
  student->>sessionSvc: the same booking with Teacher B
  sessionSvc--xstudent: the same SUBSCRIPTION_EXPIRED denial - no teacher is bookable, no tenant id leaks

  controlStudent->>adminSvc: renewSubscription on the expired S1
  adminSvc--xcontrolStudent: ForbiddenError forbidden through the real admin gate, zero mint

  admin->>adminSvc: renewSubscription the expired S1
  adminSvc->>db: fresh ACTIVE period, lane plus 5, junction row, claim renew:S1, ONE Create audit row

  student->>sessionSvc: re-booking with the SAME denied key
  sessionSvc->>db: session scheduled on the renewed lane, hifz minus 1, ONE teacher wave to A only

  system->>expirySvc: expireDue replay
  expirySvc-->>system: expired 0, lanesZeroed 0 honest zeros, every terminal state holds
```

## subscription-expiry.journey.test.ts

The validity-window to expiry-sweep to booking-enforcement arc: two real purchase-activation legs, a backdated window that stays active until the sweep flips it with exact counts, the expired and zeroed lane denying booking at both the service and GraphQL wire layers while a seeded trial lane still funds a booking, and the replay sweep reporting honest zeros.

```mermaid
sequenceDiagram
  autonumber
  participant studentA as "Student A - expired-window owner"
  participant studentB as "Student B - isolation baseline"
  participant system as "System - backdate and sweep"
  participant purchaseSvc as "SubscriptionPurchaseService"
  participant activation as "SubscriptionActivationService.processWebhookEvent"
  participant expirySvc as "SubscriptionExpiryService.expireDue"
  participant sessionSvc as "SessionLifecycleService.createSession"
  participant gql as "GraphQL scope gate createSession mutation"
  participant db as "Postgres"

  studentA->>purchaseSvc: purchase plan plus confirmed event
  activation->>db: payment paid, subscription active, window exactly 30 days, hifz lane plus 7, ONE notification to A
  studentB->>purchaseSvc: the same real activation path
  activation->>db: B own active window and credited lane, ONE notification to B

  system->>db: backdate A endDate one hour past now, seed trial allowance 2
  Note over db: the row REMAINS active - the window-vs-status lag

  system->>expirySvc: expireDue
  expirySvc->>db: expired 1, lanesZeroed 1 - A expired with ORIGINAL dates, hifz zeroed, trial intact, B byte-identical

  studentA->>sessionSvc: booking on the expired plus zeroed lane with trial spent
  sessionSvc--xstudentA: ValidationError SUBSCRIPTION_EXPIRED with localized copy, ZERO writes
  studentA->>gql: the same booking through the real scope gate
  gql--xstudentA: exactly one error with extensions.code SUBSCRIPTION_EXPIRED

  studentA->>sessionSvc: the same booking with trial credit re-granted
  sessionSvc->>db: booking SUCCEEDS funded by the trial lane, heldBalanceLane trial, expired hifz stays zero

  system->>expirySvc: expireDue replay
  expirySvc-->>system: expired 0, lanesZeroed 0 honest zeros, every terminal state holds
```

## subscription-full-lifecycle.journey.test.ts

The complete end-to-end subscription chain on one purchaser with an untouched control tenant byte-compared after every leg: purchase, gateway settlement with replay idempotency, a booked-session debit through the real ladder, the expiry sweep, admin renew with replay, an Upgrade plan change with floored carry, a Downgrade that forfeits the excess, admin cancel, and student BFLA denials - all with zero side effects on the sibling tenant.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - fixtures, webhook, sweep"
  participant studentS as "Student S - purchaser"
  participant studentS2 as "Student S2 - control tenant, byte-compared"
  participant admin as "Admin A"
  participant purchaseSvc as "SubscriptionPurchaseService"
  participant activation as "SubscriptionActivationService.processWebhookEvent"
  participant sessionSvc as "SessionLifecycleService.createSession"
  participant expirySvc as "SubscriptionExpiryService.expireDue"
  participant adminSvc as "SubscriptionAdminService"
  participant db as "Postgres - lanes, subscriptions, audit_logs"

  system->>db: cast, LOW and HIGH plans, S2 control subscription, snapshots captured

  studentS->>purchaseSvc: purchase LOW, key KEY_PURCHASE
  purchaseSvc->>db: ONE pending pair, verbatim claim, zero credit
  system->>activation: settled webhook event confirmed
  activation->>db: paid plus active window, hifz lane plus 6, ONE confirmation to S
  system->>activation: SAME event replay
  activation-->>system: replayed true, no double credit

  studentS->>sessionSvc: book ONE session with T
  sessionSvc->>db: hifz lane minus 1 through the real debit ladder, heldBalanceLane Hifz

  system->>db: backdate the window past now, seed trial allowance - row stays active
  system->>expirySvc: expireDue
  expirySvc->>db: expired 1, lanesZeroed 1, hifz zeroed, trial intact, S2 byte-identical
  system->>expirySvc: expireDue replay
  expirySvc-->>system: expired 0, lanesZeroed 0

  admin->>adminSvc: renewSubscription the expired source
  adminSvc->>db: fresh ACTIVE row, lane plus 6, claim renew key, ONE Create audit row
  admin->>adminSvc: renewSubscription replay
  adminSvc-->>admin: SAME fresh row, NOTHING new

  admin->>adminSvc: changeSubscriptionPlan UP to HIGH
  adminSvc->>db: Upgrade, floored carry on top of HIGH count, source cancelled, ONE Override audit row
  admin->>adminSvc: replay the SAME plan change
  adminSvc-->>admin: SAME upgraded row, carry re-derived as 0, NOTHING new

  admin->>adminSvc: changeSubscriptionPlan DOWN to LOW
  adminSvc->>db: Downgrade, excess forfeited, lane resets to LOW count, ONE Override audit row
  admin->>adminSvc: cancelSubscription the active row
  adminSvc->>db: cancelled, lanes byte-identical, ONE Suspend audit row

  studentS->>adminSvc: renew, change plan, and cancel attempts
  adminSvc--xstudentS: ForbiddenError forbidden through the real admin gate, zero side effects
  Note over system,db: final tenancy sweep - S2 row, lanes, and inbox byte-identical to step 1
```

## subscription-purchase.journey.test.ts

The purchase to gateway-settlement workflow on the mock provider: a pending pair with verbatim idempotency claim, duplicate-key and replay idempotency, activation crediting the plan's lane exactly once per outcome, the parent and anonymous denial probes through the real GraphQL scope gate, the oracle-safe spent-key replay, and the seeded Reviews-lane plus Tajweed-lane plans routing credits to their documented lanes.

```mermaid
sequenceDiagram
  autonumber
  participant studentA as "Student A - purchaser"
  participant studentB as "Student B - spent-key replay probe"
  participant parent as "Parent - scope-gate denial probe"
  participant emitter as "Emitter - confirmed and failed events"
  participant purchaseSvc as "SubscriptionPurchaseService"
  participant activation as "SubscriptionActivationService.processWebhookEvent"
  participant gql as "GraphQL scope gate purchaseSubscription"
  participant db as "Postgres - pending set, lanes, notifications"

  studentA->>purchaseSvc: purchase plan, key KEY_PURCHASE
  purchaseSvc->>db: ONE pending pair plus junction plus verbatim claim, mock checkout descriptor
  studentA->>purchaseSvc: same-key retry
  purchaseSvc--xstudentA: ConflictError DUPLICATE_REQUEST, zero second rows

  emitter->>activation: confirmed event on the gateway reference
  activation->>db: payment paid, subscription active, window exactly 30 days, hifz lane plus 7, ONE notification to A
  studentA->>purchaseSvc: listOwn shows the active row; Student B list stays empty
  emitter->>activation: SAME confirmed event replay
  activation-->>emitter: processed plus replayed, no second credit or notification

  studentA->>purchaseSvc: fresh-key purchase, then failed event
  activation->>db: payment failed, subscription stays pending, zero credit, ONE failure notification

  parent->>gql: purchaseSubscription through the real scope gate
  gql--xparent: FORBIDDEN, zero writes
  studentB->>purchaseSvc: purchase replaying A SPENT key
  purchaseSvc--xstudentB: NotFoundError PAYMENT_NOT_FOUND oracle-safe, no owner leak
  Note over gql: anonymous caller gets UNAUTHORIZED through the same scope gate
  Note over activation,db: uncorrelatable reference delivery - processed false, ONE bounded PAYMENT_REFERENCE_UNKNOWN log, zero mutation

  studentA->>purchaseSvc: purchase the seeded Reviews-lane plan, confirmed event
  activation->>db: balance_reviews credited sessionCount, hifz and tajweed byte-identical, ONE notification
  studentA->>purchaseSvc: purchase the Tajweed-lane plan, confirmed event
  activation->>db: balance_tajweed credited sessionCount, sibling lanes byte-identical, ONE notification
  emitter->>activation: tajweed confirmed event replay
  activation-->>emitter: replayed ack, no double credit, foreign actors untouched
```
