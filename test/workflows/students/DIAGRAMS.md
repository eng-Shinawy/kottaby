# Students workflow journey diagrams

Mermaid diagrams for the cross-actor student-domain journey suites in this directory, using the same actor names, service entry points, and statuses as the journey code.

## student-full-journey.journey.test.ts

The consolidated student arc over one committed world, walked step by step through the real production services: registration and provisioning, the money-in leg (catalog, purchase, webhook settlement), the parent-link chain, the session escrow lifecycle with its cancel/replay guards and dual confirmation, the report and read-only parent-portal legs, the edge denials, the post-confirmation dispute with its Refund arbitration, and the closing end-state consistency sweep. The diagram below uses the same actor names, service entry points, and statuses as the journey code.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - provisioning and settlement"
  participant s as "Student S - primary student"
  participant p as "Parent P - Arabic locale"
  participant t as "Teacher T - certified directory teacher"
  participant a as "Admin A - governance actor"
  participant s2 as "Student S2 - zero balance"
  participant p2 as "Parent P2 - foreign parent"
  participant anon as "Anonymous - no verified user"
  participant reg as "RegistrationService"
  participant hs as "StudentHandshakeService"
  participant catalog as "PlanCatalogService"
  participant gql as "GraphQL schema - planCatalog and purchaseSubscription"
  participant purchaseSvc as "SubscriptionPurchaseService"
  participant gateway as "Mock payment gateway"
  participant activation as "SubscriptionActivationService.processWebhookEvent"
  participant link as "ParentLinkRequestService"
  participant portal as "ParentMonitoringService"
  participant matching as "TeacherMatchingService"
  participant lifecycle as "SessionLifecycleService"
  participant arbitration as "SessionArbitrationService"
  participant report as "SessionReportService"
  participant walletSvc as "WalletService"
  participant db as "Postgres"

  system->>reg: registerUser student input (country EG, preferredRecitation Hafs, locale en, outerTx)
  reg->>db: users row plus students row - free trial lane 1, KSB handshake minted
  system->>reg: registerUser parent input (locale ar, outerTx)
  reg->>db: users row plus parents row
  system->>db: direct-insert teacher T with directory profile, admin A, zero-balance S2, foreign P2, active Hifz plan
  system->>db: track every committed row for reverse-order hard delete
  s->>db: read students row - balanceTrial 1, all paid lanes 0, parentId null
  s->>hs: getMyHandshakeCode sUserId
  hs-->>s: minted code verbatim - KSB plus 8 characters
  s->>db: count session rows for S then recitation rows for those sessions - zero and zero
  s->>reg: registerUser duplicate email probe
  reg-->>s: ConflictError - translated emailAlreadyExists copy, committed row untouched
  s->>catalog: listActiveCatalog en
  catalog-->>s: journey plan - Hifz lane, 8 sessions, 200.00 EGP
  s->>gql: planCatalog query with student context
  gql-->>s: journey plan present - in-process schema parity
  s->>purchaseSvc: purchase planId under fresh idempotency key
  purchaseSvc->>gateway: createCheckout (mock provider - no network)
  gateway-->>purchaseSvc: mock_ reference, no hosted checkout URL
  purchaseSvc->>db: pending subscription plus pending payment plus junction plus verbatim claim
  anon->>gql: purchaseSubscription probe
  gql-->>anon: UNAUTHORIZED - one error, zero writes
  p->>gql: purchaseSubscription probe
  gql-->>p: FORBIDDEN - one error, zero writes
  t->>gql: purchaseSubscription probe
  gql-->>t: FORBIDDEN - one error, zero writes
  system->>activation: confirmed event from paymentReference and plan money, injected spied transport
  activation->>db: payment paid, subscription active with interval window, balanceHifz 0 to 8
  activation-->>s: ONE payment-confirmation wave - persisted and published to S only
  system->>activation: replay the same confirmed event
  activation-->>system: replayed ack - lane stays 8, no second wave, zero new rows
  s->>hs: getMyHandshakeCode sUserId (link-chain precondition)
  hs-->>s: minted code verbatim - KSB plus 8 characters
  p->>link: requestLink code, pUserId, locale ar, injected spied transport
  link->>db: pending parent_link_requests row - 7-day window, student name masked
  link->>db: ONE link-request inbox row to S - en copy, bound to the request row
  link-->>s: outgoing payload - pending, masked student name only
  s->>link: respondToLinkRequest requestId, accept, sUserId, locale en
  link->>db: students.parent_id = P - guarded one-parent write, request row confirmed
  link->>db: ONE acceptance inbox row to P - ar copy, decision related-entity
  link-->>p: incoming payload - confirmed, parent full name
  p->>portal: listLinkedChildren pUserId, locale ar
  portal-->>p: exactly [S] - full name unmasked, the link is in force
  p2->>portal: listLinkedChildren p2UserId
  portal-->>p2: empty list - the foreign parent sees nothing
  s->>matching: browseAvailableTeachers hafs_an_asim, Hifz intent, page 1
  matching-->>s: teacher T present - online, certified, rated directory card
  s->>lifecycle: createSession teacher T, Hifz intent, fresh idempotency key
  lifecycle->>db: session A scheduled - fee 25.00, hold marked on the TRIAL lane, trial 1 to 0, hifz stays 8
  lifecycle->>db: ONE session-request inbox row to T - en copy, session related-entity
  s->>lifecycle: replay the same idempotency key
  lifecycle-->>s: ConflictError DUPLICATE_REQUEST - zero new rows, lane untouched
  t->>lifecycle: startSession sessionA
  lifecycle->>db: started - teacher isOnline false (in-session lock, same transaction)
  t->>lifecycle: completeSession sessionA
  lifecycle->>db: completed - lock released, ONE completion-prompt inbox row to S
  s->>lifecycle: confirmSessionCompletion sessionA
  lifecycle->>db: feeHeld false, wallet ensured and credited 25.00 on balance and total_earning, ONE earning ledger row, zero waves, lanes unchanged
  s->>walletSvc: getMyWallet tUserId (service parity)
  walletSvc-->>s: wallet 25.00 with the one earning transaction
  p->>lifecycle: confirmSessionCompletion sessionA (write denial)
  lifecycle-->>p: oracle-safe SESSION_NOT_FOUND - row byte-identical, wallet untouched
  t->>report: submitSessionReport sessionA, notes, rating 5, Jadid and Madi homework, injected spied transport
  report->>db: report row plus home_work row - track blocks mapped, grades structurally null
  report->>db: TWO report-ready inbox rows - student en copy, parent ar copy, session related-entity
  report-->>t: submitted report row
  s->>report: getSessionReport sUserId, sessionA
  report-->>s: own report visible - the parent collapses to null (participant gate)
  p->>portal: getSessionTarget pUserId, sessionA, locale ar
  portal-->>p: closed pair - sessionId and the linked child id, landing URL /parent/children/childId with reports tab and session param
  p->>portal: listLinkedChildren, listChildSessions, listChildReports, listChildHomework, getChildProgress
  portal-->>p: one child, completed session A, one report, one homework, honest zero progress rows with latest homework positions
  p2->>portal: listChildReports and listChildSessions on the same student
  portal-->>p2: constant FORBIDDEN - owner rows byte-identical, zero publishes
  s2->>lifecycle: createSession teacher T, Hifz intent, fresh idempotency key (zero balance)
  lifecycle-->>s2: ValidationError INSUFFICIENT_BALANCE - zero writes, key unburned
  s->>lifecycle: createSession session B (trial lane exhausted)
  lifecycle->>db: session B scheduled - hold marked on the HIFZ lane, hifz 8 to 7
  lifecycle->>db: ONE session-request inbox row to T - en copy, session related-entity
  s->>lifecycle: cancelSession session B with a reason
  lifecycle->>db: cancelled - feeHeld false, hifz 7 to 8 (same-lane refund once), zero waves
  s->>lifecycle: replay cancelSession on the cancelled row
  lifecycle-->>s: ConflictError SESSION_INVALID_TRANSITION - row byte-identical
  s->>lifecycle: createSession session C, then teacher start and complete, then student confirm
  lifecycle->>db: hifz 8 to 7, ONE prompt inbox row to S, wallet credited to 50.00 with the second earning row
  t->>arbitration: openPostConfirmationDispute session C probe (opener predicate)
  arbitration-->>t: oracle-safe SESSION_NOT_FOUND - the student is the only opener
  s->>arbitration: openPostConfirmationDispute session C with a reason
  arbitration->>db: disputed - admin inbox wave for every governance-clean admin (membership)
  t->>arbitration: arbitrateDispute Refund probe
  arbitration-->>t: FORBIDDEN - the resolver surface is admin-only
  p->>arbitration: arbitrateDispute Refund probe
  arbitration-->>p: FORBIDDEN - the resolver surface is admin-only
  a->>arbitration: arbitrateDispute Refund with a note
  arbitration->>db: completed with resolution stamps - wallet debited to 25.00, hifz restored to 8, ONE arbitration_reversal ledger row, ONE override audit row
  arbitration->>db: resolution inbox rows to S and T - participants only, admin gains nothing
  system->>db: final consistency sweep - lanes trial 0 hifz 8, wallet 25.00 with lifetime earning 50.00, ledger two earnings plus one reversal, three terminal sessions with released holds, one report and one homework with zero progress rows, active subscription with paid payment and junction, parent link in force, per-actor inbox deltas S 6 P 2 T 4 A 1
  Note over db: teardown sweeps payments, teacher ledger rows, and the arbitration audit row under trigger suspension with each sweep re-probed, junction by subscription id, then tracked reverse-order delete with existence re-probes for every registered row - zero residue
```
