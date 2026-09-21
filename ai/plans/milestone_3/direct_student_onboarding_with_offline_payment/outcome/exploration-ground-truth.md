<agent_swarm_result>
<summary>completed: 6</summary>
<subagent agent_id="agent-0" item="DATABASE SCHEMA &amp; ENUMS. Inspect backend/db/schema/ and backend/enum/ and db/schema.dbml for: users table; students table (does it have handshake_code? parent_id or separate link table? full column list with types/nullability/defaults); parents table (user link); subscriptions table (full columns; status enum values; do columns payment_method / payment_reference / payment_verified_at exist? plan/tier/price columns; start/end date columns); student_payments table (columns, relation to subscriptions, gateway fields); audit_logs table (columns, audit_action_type enum members); whatever table holds a student's SESSION BALANCE / quota / wallet (session credits — find the exact table+columns); payment_gateway / payment_method enum definitions (exact member list — do 'offline_cash', 'bank_transfer', 'scholarship' exist? where defined); subscription-related enums (status, plan). Report each table's full column list with types and file:line of the pgTable definition, plus enum files with their member lists." outcome="completed"># DATABASE SCHEMA & ENUMS — Ground-Truth Report (Direct Student Onboarding w/ Offline Payment)

All findings verified against Drizzle source (`backend/db/schema/`) and cross-checked with `db/schema.dbml`. Drizzle source is the structural ground truth per `backend/db/schema/AGENTS.md:40`.

## 1. users table — EXISTING
`backend/db/schema/users/users.ts:11` — `export const users = pgTable("users", {...})`

| Column (TS) | DB name | Type | Null/Default | Line |
|---|---|---|---|---|
| id | id | integer, PK, `generatedAlwaysAsIdentity` | — | :14 |
| fullName | full_name | varchar(255) | NOT NULL | :15 |
| email | email | varchar(255) | NOT NULL, `unique("users_email_unique")` :44 | :16 |
| phone | phone | varchar(20) | nullable | :17 |
| passwordHash | password_hash | varchar(255) | NOT NULL | :18 |
| role | role | `userRole` enum | NOT NULL | :19 |
| dateOfBirth | date_of_birth | date | nullable | :20 |
| gender | gender | `gender` enum | nullable | :21 |
| country | country | varchar(100) | nullable | :22 |
| locale | locale | `appLocale` enum ("ar","en") | nullable | :29 |
| isDeleted / deletedAt | is_deleted / deleted_at | boolean def false / timestamp | :30–31 |
| suspended / suspendedAt / suspendedPeriodDays | suspended / suspended_at / suspended_period_days | boolean def false / timestamp / integer | :32–34 |
| isBlocked / blockedAt | is_blocked / blocked_at | boolean def false / timestamp | :35–36 |
| lastActiveAt | last_active_at | timestamp | :37 |
| createdAt / updatedAt | created_at / updated_at | timestamp def now(), updatedAt `$onUpdate` | :38–42 |

## 2. students table — EXISTING (handshake_code + balances + parent_id all present)
`backend/db/schema/students/students.ts:18` — `export const students = pgTable("students", {...})`

| Column | DB name | Type | Null/Default | Line |
|---|---|---|---|---|
| id | id | integer, PK = FK → users.id `cascade` (shared PK, no auto-increment) | :21–23 |
| balanceHifz | balance_hifz | integer | nullable, default 0, CHECK `>= 0` (:42) | :24 |
| balanceReviews | balance_reviews | integer | nullable, default 0, CHECK (:43) | :25 |
| balanceTajweed | balance_tajweed | integer | nullable, default 0, CHECK (:44) | :26 |
| balanceTrial | balance_trial | integer | NOT NULL default 0, CHECK (:45); companion `trialGrantedAt` timestamp :28 | :27 |
| primaryLanguage / anotherLanguage | primary_language / another_language | varchar(100) nullable | :29–30 |
| **handshakeCode** | **handshake_code** | varchar(50) **NOT NULL**, `unique("students_handshake_code_unique")` :40 | **:31** — EXISTS |
| **parentId** | **parent_id** | integer FK → users.id `set null`, indexed `students_parent_id_idx` :41 | **:32** — EXISTS (one parent per student, direct column, NO separate link table) |
| createdAt / updatedAt | | timestamp def now() | :33–37 |

## 3. parents table — EXISTING
`backend/db/schema/parents/parents.ts:11` — bare role-child table: `id` (integer PK = FK → users.id, cascade :12–14), `createdAt`, `updatedAt`. No extra columns. Parent→child link is `students.parent_id` (above). Link-request history: `backend/db/schema/parents/parent-link-requests.ts:39` `parentLinkRequests` (id, parentId→users.id restrict, studentId→students.id restrict, `status` linkStatus default "pending", createdAt, expiresAt NOT NULL, respondedAt, reminderSentAt; partial unique `parent_link_requests_pending_pair_unique` on (parent_id, student_id) WHERE status='pending' :58–60).

## 4. subscriptions table — EXISTING (offline payment columns ALL present)
`backend/db/schema/billing/subscriptions.ts:28` — `export const subscriptions = pgTable("subscriptions", {...})`. Doc comment :12–14 explicitly says the offline columns "support admin-verified offline payments."

| Column | DB name | Type | Null/Default | Line |
|---|---|---|---|---|
| id | id | integer PK identity | :31 |
| userId | user_id | integer FK → users.id `restrict`, NOT NULL (generic owner: parent/student/self-payer) | :32–34 |
| planId | plan_id | integer FK → plans.id `restrict`, NOT NULL | :35–37 |
| status | status | `subscriptionStatus` enum, NOT NULL default **"pending"** | :38 |
| startDate / endDate | start_date / end_date | timestamp nullable | :39–40 |
| **paymentMethod** | **payment_method** | `paymentGateway` enum, nullable | **:41** — EXISTS |
| **paymentReference** | **payment_reference** | varchar(255), partial unique index `subscriptions_payment_reference_unique` WHERE NOT NULL :54–56 | **:42** — EXISTS |
| **paymentVerifiedAt** | **payment_verified_at** | timestamp nullable | **:43** — EXISTS |
| createdAt / updatedAt | | timestamp def now() | :44–48 |

Indexes: `subscriptions_user_id_idx` :51, `subscriptions_plan_id_idx` :52, partial `subscriptions_active_end_date_idx` on end_date WHERE status='active' :53.

**MISSING from subscriptions**: there is NO `tier`/`price`/`amount` column on subscriptions (grep of the pgTable at `subscriptions.ts:28-58` shows none) — pricing lives entirely in `plans` (below). The subscription↔student link is via junction `studentSubscriptions` (`backend/db/schema/billing/student-subscriptions.ts:20`): composite PK `(student_id, subscription_id)`, both FKs cascade, `enrolledAt` timestamp default now NOT NULL, plus index `student_subscriptions_subscription_id_idx` :33. An onboarding flow that activates a subscription for a student must insert a `student_subscriptions` junction row.

## 5. plans table — EXISTING (price/plan columns live here)
`backend/db/schema/billing/plans.ts:20` — `plans(id PK, title varchar(255) NN, sessionCount integer NN, price decimal(10,2) NN, currency char(3) NN default "EGP", intervalDays integer NN, balanceLane subscriptionCreditLane nullable, isActive boolean NN default true, deactivatedAt, createdAt, updatedAt)` :23–36. CHECKs: session_count>0, price>=0, interval_days>0 :39–41. `balance_lane` is the lane credited on activation; NULL lane "fails closed" at purchase (doc :13–17, dbml note "PLAN_LANE_UNCONFIGURED quarantine").

## 6. student_payments table — EXISTING (offline bypass = simply don't insert)
`backend/db/schema/billing/student-payments.ts:50` — `studentPayments`:
- id integer PK identity :53; studentId integer → students.id `restrict`, **nullable** (owner can be subscription's generic user) :58; subscriptionId integer → subscriptions.id `set null` :59–61; amount decimal(10,2) NOT NULL, CHECK `> 0` :62,74; currency char(3) default "EGP" :63; paymentGateway `paymentGateway` enum NOT NULL :64; status `paymentStatus` default "pending" :65; providerTransactionId varchar(64) nullable :66; createdAt/updatedAt :67–71.
- **IMMUTABLE LEDGER** (doc :24–46): DELETE blocked by trigger; UPDATE only for guarded `pending → paid|failed` transition; pending insert can't carry provider_transaction_id (CHECK :76–78). So "no student_payments row for offline" is the only viable design — no mutation path could retroactively add one cleanly.

## 7. audit_logs table — EXISTING
`backend/db/schema/audit/audit-logs.ts:30` — `auditLogs`: id integer PK identity :33; actorId integer → users.id `restrict` NOT NULL :34–36; actionType `auditActionType` enum NOT NULL :37; entityType varchar(100) NOT NULL :38; entityId integer nullable :39; details varchar(2000) nullable (JSON-encoded string, not jsonb) :40; createdAt :41. **Append-only**: UPDATE/DELETE blocked by trigger `3-immutability-triggers.sql` (doc :17–21). Indexes: `audit_logs_actor_id_idx` :44, `audit_logs_entity_type_entity_id_idx` (entity_type, entity_id) :45. **No updated_at column.**

## 8. Session balance / quota / wallet — EXISTING, on `students`
There is **no separate session-balance or student wallet table**. Proof of absence: grep for `balance|credit|quota` across `backend/db/schema/` (excluding index.ts) returns matches only in `students.ts`, `plans.ts`, `enums.ts`, `classes/session.ts` (held lane read-side), and teacher-side `wallet.ts`/`teacher-transaction.ts`. The student session balance is the four integer lanes on `students`: `balance_hifz`, `balance_reviews`, `balance_tajweed`, `balance_trial` (`students.ts:24–27`), all with `>= 0` CHECK constraints. The teacher `wallet` (`backend/db/schema/billing/wallet.ts:20`) is teacher-earnings only — irrelevant to student onboarding. So "credit the session balance" = UPDATE `students.balance_<lane> += plans.session_count` where lane comes from `plans.balance_lane` (`subscription_credit_lane`: hifz|tajweed|reviews).

## 9. Enums — ALL offline members EXIST

**payment_gateway pgEnum** — `backend/db/schema/enums.ts:56-66`, EXACT member list:
`"stripe", "paypal", "paymob", "fawry", "offline_cash", "bank_transfer", "scholarship", "other", "mock"`
TS mirror `PaymentGateway` — `backend/enum/billing/payment-gateway.enum.ts:10-19` with members Stripe/Paypal/Paymob/Fawry/**OfflineCash="offline_cash"**/**BankTransfer="bank_transfer"**/**Scholarship="scholarship"**/Other/Mock. → All three offline types are EXISTING; no enum changes needed.

**subscription_status pgEnum** — `backend/db/schema/enums.ts:68-74`: `active, pending, expired, cancelled, suspended` (TS mirror `backend/enum/billing/subscription-status.enum.ts:6-11`). Status "active" for direct activation is valid.

**subscription_credit_lane pgEnum** — `enums.ts:86`: `hifz, tajweed, reviews` (TS mirror `backend/enum/billing/subscription-credit-lane.enum.ts:9-12`). NOTE: no "trial" member — trial lane is a plain integer column, not part of this enum.

**payment_status pgEnum** — `enums.ts:44`: `pending, paid, failed, refunded` (mirror `payment-status.enum.ts:5-9`).

**audit_action_type pgEnum** — `enums.ts:102-110`: `create, update, delete, override, adjust, suspend, reactivate` (mirror `backend/enum/audit/audit-action-type.enum.ts:6-13`). No "onboard"/"register"/"activate" member — an onboarding audit row would use `create` (and possibly `override`); adding a new member is NOT required by the schema but would be a pgEnum migration if the plan wants a dedicated verb.

**user_role pgEnum** — `enums.ts:9`: `admin, teacher, student, parent` (mirror `user-role.enum.ts:5-10`, plus `toUserRole(role: string): UserRole | null` at :24).

**link_status pgEnum** — `enums.ts:88`: `pending, confirmed, rejected, expired` (used by parent_link_requests).

## 10. Adjacent billing tables (context)
- `subscription_purchase_idempotency` — `backend/db/schema/billing/subscription-purchase-idempotency.ts:24`: idempotencyKey varchar(128) unique, userId → users cascade, subscriptionId → subscriptions set null. Built for gateway purchase flows; an admin offline flow likely doesn't need it.
- `db/schema.dbml` agrees with Drizzle for all tables above (users :158, parents :190, students :224, subscriptions :254, student_subscriptions :275, plans :286, student_payments :397, audit_logs :477). Minor drift: dbml `student_payments.student_id` says `not null` while Drizzle has it nullable — Drizzle is ground truth.

## 11. Schema-layer rules most relevant (backend/db/schema/AGENTS.md)
- No raw DDL — all tables via `pgTable(...)` (:35); one domain per file (:36).
- `enums.ts` is the single pgEnum registry; enum values must be matched EXACTLY, never guessed (:38, :46).
- Before authoring any new table/enum, verify it doesn't already exist (:40).
- Schema sync via `bun run db push` (reset/cleanGenerate permanently disabled) (:39).
- Cross-directory enum registration: TS enum in `backend/enum/<subdir>/`, pgEnum in `enums.ts`, GraphQL registration in `backend/graphql/pothos/shared/enum.pothos.ts` (:46).
- backend/enum/AGENTS.md: backend enums are backend-only; frontend must use codegen enums (`:36`), deep imports preferred (`:40`).

## 12. Bottom line for the ticket
Every schema artifact the ticket assumes already EXISTS — nothing new needs to be created in the schema/enum layer:
- users + students (handshake_code, parent_id, balance lanes) ✔
- parents + parent_link_requests ✔
- subscriptions with `payment_method`/`payment_reference`/`payment_verified_at` ✔ (nullable — set all three on direct activation)
- plans with `session_count` + `balance_lane` (drives which student balance column to credit) ✔
- payment_gateway enum already contains `offline_cash`, `bank_transfer`, `scholarship` ✔
- audit_logs ✔
- The offline bypass is structurally natural: `student_payments` is an immutable gateway ledger; omitting the insert is the only design consistent with its triggers.
- Two required side-writes an implementer must not forget: `student_subscriptions` junction row (subscription↔student), and `subscriptions.payment_verified_at` set to verification time.</subagent>
<subagent agent_id="agent-1" item="BACKEND SERVICES. Inspect backend/services/ (and its AGENTS.md) for: (a) admin user/student/parent CRUD services — exact exported function signatures for creating a user+student (transaction usage, params); (b) subscription services — any admin subscription management (create/activate/extend/renew/cancel/upgrade/downgrade)? exact file + signatures of create/activate functions, and how session balance/quota is credited on activation; (c) the session-balance/quota/wallet service — exact credit/grant functions used elsewhere; (d) audit log service/helper — exact function name + params used by admin actions (e.g. logAudit(...)), which 'action_type' values exist; (e) handshake_code generation — where the code is generated for students (function + uniqueness handling); (f) any existing 'onboard/register student' service (public self-registration path) for comparison. For each: path:line + full TS signature + 1-line behavior note. Also report how services receive/return locale for user-facing errors (locale: string param pattern) and the canonical error helpers used (NotFoundError/ValidationError etc., where defined)." outcome="completed"># Backend Services — Ground-Truth Report for "Direct Student Onboarding with Offline Payment"

## 0. Layer rules that constrain this ticket (`backend/services/AGENTS.md`, `backend/AGENTS.md`)

1. All user-facing errors must resolve via `getServerTranslations(locale, "<namespace>")` from `@/shared/locale/server-graphql`; hardcoded strings forbidden (services/AGENTS.md:7).
2. Types live only in `backend/types/` — `{Entity}SubmitInput`, `DBTransaction`, etc.; **no `.types.ts` files in the service layer** (services/AGENTS.md:8-9).
3. **Single-writer discipline** + composition seam: composition helpers accept the caller's `outerTx` as the FINAL parameter so composed writes join the caller's transaction; guard/governance pre-checks run BEFORE the transaction opens; arbitrate duplicates with the UNIQUE constraint (catch 23505 → typed conflict), not pre-check SELECTs (services/AGENTS.md:11).
4. Domain-driven, no monolithic services; services usable from SSR directly (services/AGENTS.md:3-6).
5. Admin BFLA pattern: every admin method re-asserts the actor via `assertActorAdmin`/`assertActorAdminActive` before any read/write; denial paths emit zero writes and zero audit rows.
6. Tests live next to code (`*.test.ts`), run via `bun run test:services`; DB tests use `runInRollback` + `outerTx` SAVEPOINT seam.

---

## (a) Admin user/student/parent CRUD — EXISTING

`AdminUserManagementService` (`backend/services/admin/user-management.service.ts`) is the admin user CRUD surface. **Create is generic across roles** (`role: student | teacher | parent`, admin structurally excluded).

**Create user (the exact anchor for ticket's user+student creation):**
```
user-management.service.ts:261
export async function createUser(
  input: AdminCreateUserSubmitInput,
  actorId: number,
  locale: string,
  outerTx?: DBTransaction
): Promise<AdminUserDetailReturnType>
```
Behavior (body at :261-325): `assertActorAdmin` → runtime `role === "admin"` tamper guard (`ConflictError("ADMIN_ROLE_CREATION_FORBIDDEN")`) → `validateCreateInput(input, locale)` → `hashPassword` **before** tx → single `withTransaction(outerTx, tx => …)`: `UserRepository.create(buildCreateUserInsert(input, passwordHash), tx)` → `createRoleChild(created.id, input.role, tx, studentHook)` → `AuditService.createAuditLog(buildAuditContract(actorId, AuditActionType.Create, created.id, { role: input.role }), tx)` → returns `getUserDetail(createdId, locale, actorId, tx)`. Duplicate email → `translateDbError(error, t.authTranslations.emailAlreadyExists)` → localized `ConflictError`.

- `AdminCreateUserSubmitInput` (closed whitelist) — `backend/types/admin/admin-user.types.ts:209-217`: `fullName, email, phone, password, gender?, country, role: RegisterPublicRole`. No parent-association field exists (MISSING for this ticket — must be added as a new type/service param).
- `buildCreateUserInsert(input, passwordHash): UserInsertType` — `user-management.helpers.ts:246` (BOPLA field-by-field; governance defaults server-set).
- Student branch of `createRoleChild` calls `createStudentWithHandshakeRetry` and **deliberately omits the free-trial grant** (user-management.service.ts:297-302, "Trial lane stays dormant on the admin surface").
- Other methods (all `actorId`+`locale`+`outerTx` pattern): `listDirectory` :106, `getStats` :148, `getUserActivity` :182, `getUserDetail` :221, `updateUser` :331, `setUserDeleted` :382, `setUserSuspended` :399, `setUserBlocked` :424.
- Admin **teacher/student/applicant directories are READ-ONLY** (`list` + `exportAll` only): `student-directory.service.ts:96,134`; `teacher-directory.service.ts:89,127`; `teacher-applicant-directory.service.ts:109,155`. No separate admin student/parent CRUD services exist — user CRUD is the single surface.
- Parent rows are created only via the shared registration dispatch (`ParentRepository.createForRegistration(userId, tx)` — `backend/db/repo/parents/parent.repository.ts:21`).

**Blocked-by verdict:** admin user CRUD (incl. student creation with handshake) = EXISTING; admin subscription lifecycle = EXISTING (see b). No parent-association parameter exists anywhere in the admin create flow.

## (b) Subscription services — admin lifecycle EXISTING; direct offline activation MISSING

`SubscriptionAdminService` (`backend/services/billing/subscription-admin.service.ts`), all signatures share `(input, actorId: number, locale: string, tx?: DBTransaction)`:

| Function | Line | Semantics (verbatim identifiers) |
|---|---|---|
| `extendSubscription(input: ExtendSubscriptionSubmitInput, actorId, locale, tx?): Promise<SubscriptionReturnType>` | :159 | active-only, FOR UPDATE lock, `extendActiveOnce` guarded UPDATE, audit `AuditActionType.Update` |
| `renewSubscription(input: RenewSubscriptionSubmitInput, actorId, locale, tx?)` | :299 | expired-only, idempotency claim `subscription-admin:renew:<id>`, inserts fresh **active** period + lane credit, audit `Create` |
| `cancelSubscription(input: CancelSubscriptionSubmitInput, actorId, locale, tx?)` | :400 | active-only, balance-preserving `cancelActiveOnce`, audit `Suspend` |
| `changeSubscriptionPlan(input: ChangeSubscriptionPlanSubmitInput, actorId, locale, tx?): Promise<ChangeSubscriptionPlanResult>` | :488 | same-lane proration, claim `subscription-admin:planChange:<id>:<planId>`, audit `Override` on new row |
| `listForAdmin(userId: number, actorId, locale, tx?): Promise<SubscriptionReturnType[]>` | :526 | owner-scoped read |
| `auditEntriesCount(subscriptionId: number)` / `auditTrailPeek(subscriptionId: number)` | :561/:586 | audit read companions |

**The exact pattern to reuse for admin-created active subscriptions:**
```
subscription-admin-settle.helpers.ts:43
export async function insertAdminPeriodSubscription(
  ownerId: number,
  planSnapshot: Pick<PlanSelectType, "id" | "intervalDays">,
  scopedTx: DBTransaction
): Promise<SubscriptionSelectType>
```
Inserts `status: SubscriptionStatus.Active`, `startDate = now`, `endDate = now + intervalDays * MS_PER_DAY`, and **`paymentMethod: null, paymentReference: null, paymentVerifiedAt: null`** — today's admin flows carry "no gateway payload". Followed by `settleAdminSideEffects` (settle.helpers.ts:76): lane write → `studentSubscriptions` junction insert → claim backfill. NOTE: it goes through `SubscriptionRepository.insertSubscription(insert, tx)` (`backend/db/repo/billing/subscription.repository.ts:70`), which takes a full `SubscriptionInsertType` — so an offline variant can pass `paymentMethod`, `paymentReference`, `paymentVerifiedAt` without schema changes.

**Purchase/activation (gateway path, for contrast):**
- `SubscriptionPurchaseService.purchase(studentUserId, input: PurchaseSubscriptionSubmitInput, idempotencyKey, locale, outerTx?)` — subscription-purchase.service.ts:486. Creates `status: pending` subscription with `paymentMethod: checkout.provider`, `paymentReference: checkout.providerReference` (:336-338, `insertPendingSubscription` :334) **plus a `student_payments` row** (`StudentPaymentRepository.insertPayment({...})` :407) and the `studentSubscriptions` junction row.
- `SubscriptionActivationService.processWebhookEvent(event: PaymentWebhookEvent, locale: string, outerTx?, options?): Promise<{ processed: boolean; replayed?: boolean }>` — subscription-activation.service.ts:554. Confirmed delivery → `withTransaction`: `SubscriptionRepository.activatePendingOnce(id, { startDate, endDate, paymentVerifiedAt }, tx)` (repo signature at `backend/db/repo/billing/subscription.repository.ts:158`) → `StudentPaymentRepository.markPaidOnce(...)` → `applyActivationCredit(...)` → notification. This is the only activation writer today; it is webhook-gated and **requires a `student_payments` row** (missing row = quarantine, `{ processed: false }`).

**MISSING / CREATE:** grep for `activateSubscription|createSubscription|OfflineCash|BankTransfer|Scholarship` across `backend/services/**` and `backend/graphql/**` (excluding tests) returns zero writer matches — no service accepts a `PaymentGateway` input or creates an already-`active` subscription with an offline `payment_method`. A new admin onboarding service must: insert user+student, insert subscription via `SubscriptionRepository.insertSubscription` with `status: active` + offline `paymentMethod` + `paymentVerifiedAt`, credit lane, insert junction, audit — all in ONE `withTransaction`, skipping `student_payments` entirely (feasible: nothing in the schema forces a payment row; analytics already anticipates offline activations, see below).

## (c) Session balance / quota credit — EXISTING

- `StudentRepository.creditLaneBalance(studentId: number, lane: SubscriptionCreditLane, amount: number, tx?: DBTransaction): Promise<StudentSelectType | null>` — `backend/db/repo/students/student.repository.ts:440` (relative `COALESCE(balance_<lane>, 0) + amount` UPDATE; null = student missing).
- `StudentRepository.setLaneBalanceValue(...)` — same file (~:465), exact-value setter used by plan-change settlement.
- Lanes: `SubscriptionCreditLane` enum — `backend/enum/billing/subscription-credit-lane.enum.ts`: `Hifz="hifz" | Tajweed="tajweed" | Reviews="reviews"`, mapped to `students.balance_hifz/balance_tajweed/balance_reviews` (student.repository.ts:99-100 callers use a frozen enum-keyed map).
- Canonical activation credit helper:
```
subscription-activation-credit.helpers.ts:101
export async function applyActivationCredit(
  subscription: SubscriptionSelectType,
  payment: StudentPaymentSelectType,
  plan: PlanSelectType & { balanceLane: Exclude<PlanSelectType["balanceLane"], null> },
  reference: string,
  tx: DBTransaction
): Promise<void>
```
It is **payment-row-coupled** (classifies by `payment.studentId`; verification purchase with `studentId === null` skips credit). The admin offline flow cannot reuse it verbatim (no payment row) — it should reuse only `subscriptionCreditLaneOf(plan.balanceLane, …)` (:57) + `StudentRepository.creditLaneBalance`.
- Free-trial comparator: `StudentTrialService.grantFreeTrial(studentId: number, locale: string, tx?: DBTransaction): Promise<void>` — student-trial.service.ts:29 (guarded `grantFreeTrialOnce`, idempotent, `FREE_TRIAL_SESSION_COUNT`).
- Plans carry the credit inputs: `plans.session_count` (:25), `interval_days` (:28), `balance_lane` (:29) — `backend/db/schema/billing/plans.ts`.
- `wallet.service.ts` is the **teacher** wallet (`getMyWallet` :172, `requestWithdrawal` :262) — NOT part of student session balance; do not confuse.

## (d) Audit log service — EXISTING

```
backend/services/admin/audit.service.ts:82
export async function createAuditLog(input: AuditLogWriteContract, tx: DBTransaction): Promise<void>
```
- Contract: `AuditLogWriteContract` — `backend/types/contracts/admin-audit.contract.types.ts:22`: `{ actorId (ctx.user.id-derived), actionType: AuditActionType, entityType: string, entityId, details: string (JSON-safe, ≤2000) }`. Writer truncates `details` to `varchar(2000)` and inserts raw via `tx.insert(auditLogs)` — append-only, shares caller's tx fate.
- `AuditActionType` members — `backend/enum/audit/audit-action-type.enum.ts:7-13`: `Create="create" | Update="update" | Delete="delete" | Override="override" | Adjust="adjust" | Suspend="suspend" | Reactivate="reactivate"`.
- Contract builders (per entity): `buildAuditContract(actorId, actionType, entityId, details): AuditLogWriteContract` — user-management.helpers.ts:334 (entityType `"user"`); `buildSubscriptionAuditContract(...)` — subscription-admin.helpers.ts:354 (entityType `SUBSCRIPTION_AUDIT_ENTITY_TYPE`, i.e. `"subscription"`); details = `JSON.stringify({...})` of ids/integers/timestamps only — never PII.
- Read surface: `AdminAuditTrailService.listAuditTrail(filters, page, pageSize, locale, actorId, outerTx?)` — audit-trail.service.ts:256.
- There is no `logAudit(...)` — the name is `AuditService.createAuditLog(contract, tx)`.

## (e) handshake_code generation — EXISTING (shared, reusable)

`backend/services/shared/user-provisioning.helpers.ts` (composed by BOTH public registration and admin `createUser`):
- `generateHandshakeCode(): string` — **private**, :43. Format `KSB-<8 uppercase hex>` from `randomUUID()`.
- `isUniqueViolation(error): boolean` — :54, walks Drizzle `cause` chain for PG `23505`/SQLite unique text.
- `export async function createStudentWithHandshakeRetry(userId: number, tx: DBTransaction, boundary: string, buildExhaustedError: (cause: Error | undefined) => Error): Promise<void>` — :118. Bounded in-tx retry (`HANDSHAKE_RETRY_LIMIT = 5`, :30) around `StudentRepository.createForRegistration(userId, handshakeCode, tx)` (student.repository.ts:163 — inserts `id: userId` shared PK, `balanceHifz/Tajweed/Reviews: 0`, `parentId: null`). Uniqueness is arbitrated by the DB unique constraint on `students.handshake_code` via the 23505 retry loop.
- `export async function createRoleChild(userId: number, role: RegisterPublicRole, tx, insertStudentRows: (userId, tx) => Promise<void>): Promise<void>` — :79. Student branch is injected per-caller (registration appends trial grant; admin omits).
- Read-back: `StudentRepository.findHandshakeCodeByStudentId(studentId, tx?)` — student.repository.ts:198.

## (f) Public self-registration (comparison path) — EXISTING

- `RegistrationService.registerUser(input: RegistrationSubmitInput, locale: string, outerTx?: DBTransaction): Promise<RegistrationReturnType>` — registration.service.ts:80. Single `withTransaction`: `users` insert (`createUserRow`, BOPLA field-by-field, `hashPassword` pre-tx) → `createRoleChild` (student → `createStudentWithHandshakeRetry` + `StudentTrialService.grantFreeTrial(userId, locale, childTx)`) → 23505 on email → `ConflictError(t.emailAlreadyExists)`. Field-error collection via `ApiFieldErrorType[]` entries.
- `RegistrationService.createAdminUser(input: AdminRegistrationSubmitInput, locale, outerTx?)` — :134 (super-admin onboarding only; NOT the ticket path — `AdminUserManagementService.createUser` is the admin surface to compose from).
- Parent self-service link (handshake-based, NOT admin): `ParentLinkRequestService.requestLink(code: string, parentActorId: number, locale, outerTx?, options?)` — parent-link-request.service.ts:168; `respondToLinkRequest` :250; final link write is `StudentRepository.linkParentIfUnlinked(studentId, parentId, tx): Promise<StudentSelectType | null>` — student.repository.ts:373 (guarded `parent_id IS NULL` UPDATE). For the ticket's admin parent-association, this repo method (or a new admin service wrapper) is the seam; NO admin service currently sets `students.parent_id`.

## Locale & error-helper conventions (verified)

- **Locale pattern**: every service takes `locale: string` (usually 2nd/3rd param, `outerTx`/`tx` LAST) and resolves `const t = getServerTranslations(locale).errorsTranslations` (or `.authTranslations`, `.subscriptionAdmin`, `.adminUsers`) from `@/shared/locale/server-graphql`. Notification copy uses the recipient's persisted locale (`UserRepository.findLocalesByIds`).
- **Error classes** — `backend/lib/errors.ts`: `NotFoundError(entity, message)` :37 (code = `${ENTITY}_NOT_FOUND`), `UnauthorizedError` :44, `ForbiddenError` :51, `ValidationError` :65 (overloaded, optional `fields: ApiFieldErrorType[]`), `ConflictError` :171. All extend `DomainError` and propagate `extensions.code` to GraphQL.
- `translateDbError(error, localizedMessage)` — from `@/backend/lib/errors`, maps 23505 → `ConflictError` (registration.service.ts:35 import, :119 usage).
- Expected rejections log via `logger.logDomainError(msg, { code, entity, entityId })` — ids/codes only, no PII, never `console.*`.

## Offline-payment evidence (schema/analytics ready; service gap confirmed)

- `PaymentGateway` enum — `backend/enum/billing/payment-gateway.enum.ts:10-19`: `stripe, paypal, paymob, fawry, offline_cash, bank_transfer, scholarship, other, mock` (mirrors `payment_gateway` pgEnum, backend/db/schema/enums.ts:61).
- `subscriptions` columns — `backend/db/schema/billing/subscriptions.ts`: `status` (:31, default `"pending"`), `paymentMethod: paymentGateway("payment_method")` (:41), `paymentReference varchar(255)` (:42, partial unique index `subscriptions_payment_reference_unique ... WHERE payment_reference IS NOT NULL` :56-58 — offline refs must be unique-or-null), `paymentVerifiedAt` (:43). Docstring at :12-14: "Offline payment tracking columns (`payment_method`, `payment_reference`, `payment_verified_at`) support admin-verified offline payments."
- Analytics already counts offline activations: `OFFLINE_ACTIVATION_GATEWAYS = [OfflineCash, BankTransfer, Scholarship]` — `backend/db/repo/admin/platform-analytics-query-helpers.ts:112-117`; `countOfflineActivationsImpl` counts `subscriptions.payment_method IN (...)` (:458-479), consumed by `platform-analytics.service.ts:148-172` as `offlineActivationsCount`. So the platform's data model already anticipates subscriptions activated with offline `payment_method` and **no `student_payments` ledger row** ("activated OUTSIDE the payments ledger").
- `student_payments.payment_gateway` is `NOT NULL` (`backend/db/schema/billing/student-payments.ts:64`) — consistent with the ticket's "offline bypass creates NO student_payments row".

## Net gap list for the plan (all MISSING/CREATE, proven by greps above)

1. Admin onboarding service (user+student+optional-parent+active-subscription in ONE `withTransaction`) — no `onboard|directStudent|manualStudent` service exists in `backend/services/**`.
2. Offline `payment_method` input surface — no service/resolver accepts `PaymentGateway` as client input; the only writers set `paymentMethod` from `checkout.provider` (gateway) or `null` (admin renew/plan-change).
3. Parent-association parameter on admin user creation — absent from `AdminCreateUserSubmitInput` and `createUser`; only the self-service handshake link flow exists (`ParentLinkRequestService` + `linkParentIfUnlinked`).
4. Audit `details` content for a new onboarding action must follow the ids-only contract (e.g. `{ role, planId, paymentMethod, creditedSessions }`), `AuditActionType.Create` (or `Override`) on `"subscription"`/`"user"` via the existing builders.</subagent>
<subagent agent_id="agent-2" item="GRAPHQL &amp; TYPES LAYER. Inspect backend/graphql/ (Pothos) and backend/types/: (1) existing admin mutations around users/students/subscriptions — list every mutation field touching student/user/subscription creation or admin management, with path:line; (2) pick ONE exemplary admin mutation (e.g. an admin-update-user or cold-start-sheikh mutation if present) and report its full skeleton: how builder.mutationField is declared, authScopes/permission string used, input type ref, service call, ctx usage (ctx.user, ctx.t, locale), error handling; (3) where mutations/queries register into the schema (index barrels, side-effect imports); (4) permission constants — where the permission strings/enum live (e.g. shared/constants or backend/lib/auth) and the exact names for admin-level user management permissions; (5) backend/types/ — report which canonical type files exist for user, student, parent, subscription, student_payment, audit_log (file names + the exported type names: SelectType/InsertType/ReturnType/SubmitInput) — verbatim exports for subscription &amp; student types especially." outcome="completed"># GraphQL & Types Layer — Ground-Truth Report: "Direct Student Onboarding with Offline Payment"

## 1. Existing admin mutations touching users / students / subscriptions

Full inventory of all 50 `mutationField` registrations lives under `backend/graphql/mutation/`; the ones relevant to this ticket:

| Mutation | Path:Line | Gate | Service called | Relevant to ticket |
|---|---|---|---|---|
| `adminCreateUser(input: AdminCreateUserInput!): AdminUserDetail!` | `backend/graphql/mutation/admin/admin-users.mutation.ts:58` | `$all { authenticated, role:[Admin] }` | `AdminUserManagementService.createUser` (`user-management.service.ts:261`) | **Core building block — already creates users row + students row (with handshake code) + audit log** |
| `adminUpdateUser(id: Int!, input: AdminUpdateUserInput!)` | `admin-users.mutation.ts:94` | same | `AdminUserManagementService.updateUser` (`user-management.service.ts:331`) | 5-field whitelist only (`fullName, phone, country, gender, dateOfBirth`) — cannot touch `parentId`/role |
| `adminSetUserDeleted(id: Int!, deleted: Boolean!)` | `admin-users.mutation.ts:127` | same | `AdminUserManagementService.setUserDeleted` | blocked-by dep: user CRUD ✅ EXISTING |
| `adminSetUserSuspended` / `adminSetUserBlocked` | `backend/graphql/mutation/admin/admin-governance.mutation.ts:45` / `:75` | same | governance service | governance CRUD ✅ EXISTING |
| `adminCertifyTeacherColdStart(userId, makeEvaluator)` | `backend/graphql/mutation/admin/admin-teachers.mutation.ts:36` | same | `ColdStartCertificationService` | exemplary admin mutation (§2) |
| `adminExtendSubscription(input)` | `backend/graphql/mutation/billing/subscription-admin.mutation.ts:88` | same | `SubscriptionAdminService.extendSubscription` (`subscription-admin.service.ts:159`) | blocked-by dep: subscription mgmt ✅ EXISTING |
| `adminRenewSubscription(input)` | `subscription-admin.mutation.ts:122` | same | `.renewSubscription` (`:299`) | 〃 |
| `adminCancelSubscription(input)` | `subscription-admin.mutation.ts:153` | same | `.cancelSubscription` (`:400`) | 〃 |
| `adminChangeSubscriptionPlan(input)` | `subscription-admin.mutation.ts:187` | same | `.changeSubscriptionPlan` (`:488`) | 〃 |
| `purchaseSubscription(input)` | `backend/graphql/mutation/subscription-purchase.mutation.ts:51` | `$all { authenticated, role:[Student] }` | `SubscriptionPurchaseService.purchase` | gateway checkout; creates pending subscription **+ student_payments row atomically** — the flow an offline path must bypass |
| `registerUser` | `backend/graphql/mutation/auth.mutation.ts:50` | public | `RegistrationService` | public registration; role enum excludes admin (BFLA) |
| `requestParentChildLink(code)` / `respondToParentLinkRequest` / `cancelParentLinkRequest` | `backend/graphql/mutation/parents/parent-link.mutation.ts:147` / `:178` / `:202` | role `[Parent]` | `ParentLinkRequestService` | parent link is a parent-initiated handshake-code flow — there is **no admin mutation to set `students.parent_id` directly** |
| `adminBroadcastNotification` / `adminStopBroadcast` | `backend/graphql/mutation/notifications/admin-broadcast.mutation.ts:56` / `admin-stop-broadcast.mutation.ts:52` | admin | notification service | pattern reference only |

**MISSING / CREATE (proved by absence):** grepped `mutationField\("` across all of `backend/graphql/mutation/**` — there is **no** `adminCreateStudent`, `adminOnboardStudent`, `adminCreateParent`, no mutation accepting a `paymentMethod`/offline payment input, and no mutation that writes `students.parent_id`, `subscriptions.payment_method`, `payment_reference`, or `payment_verified_at`. `grep -rn "offline_cash|OfflineCash|bank_transfer|Scholarship" backend/graphql/` matches only a doc comment in `pothos/shared/enum.pothos.ts:217`. The entire "direct onboarding + offline payment" mutation is new work.

Admin queries (context, all EXISTING): `adminStudents`/`adminStudentsExport` (`backend/graphql/query/admin/admin-students.query.ts:59`/`:86`), `adminUsers`/`adminUserStats`/`adminUserDetail`/`adminUserActivity` (`admin-users.query.ts:55`/`:83`/`:97`/`:117`), `adminAuditLogs` (`audit-trail.query.ts:47`), `mySubscriptions` (`backend/graphql/query/subscription.query.ts:42`).

## 2. Exemplary mutation skeleton — `adminCreateUser` (verbatim structure)

`backend/graphql/mutation/admin/admin-users.mutation.ts:58-86`:

```ts
gqlSchemaBuilder.mutationField("adminCreateUser", t =>
  t.field({
    type: AdminUserDetailPothosObject,          // imported from @/backend/graphql/pothos/admin
    args: {
      input: t.arg({ type: AdminCreateUserInput, required: true }),
    },
    authScopes: {
      $all: { authenticated: true, role: [UserRole.Admin] },  // MANDATORY $all conjunction
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.user) { throw new UnauthorizedError("Authentication required."); } // TS narrowing only
      const actorId = ctx.user.id;
      const { input } = args;
      return AdminUserManagementService.createUser(
        { fullName: input.fullName, email: input.email, phone: input.phone,
          password: input.password, gender: input.gender ?? undefined,
          country: input.country, role: input.role },
        actorId, ctx.locale
      );
    },
  })
);
```

Discipline observed across all admin mutations:
- **authScopes**: `$all { authenticated: true, role: [UserRole.Admin] }` written INLINE literally (never via a shared constant) — enforced by the static census scanner (§6). A plain map without `$all` is ANY-semantics = wrong. Anonymous → `UNAUTHORIZED` (401), authed non-admin → `FORBIDDEN` (403), both before the resolver runs (`builder.ts:100-143` scope mapping).
- **ctx usage**: `ctx.user` (nullable `RegistrationReturnType | null`), `ctx.locale` passed to every service as last arg, `ctx.t("errorsTranslations")` for localized throws, `ctx.user.id` for audit actorId.
- **ID args**: positive-safe-int guard `requirePositiveIntId(value, field): number` (`backend/graphql/shared/resolver-guards.ts:19`); wire `ID`s go through strict decimal coercion (e.g. `coerceSubscriptionId` at `subscription-admin.mutation.ts:84` import).
- **Errors**: resolvers throw nothing domain-specific; service `DomainError` subclasses propagate to `finalizeGraphqlErrors` masking boundary.
- Admin belt helper: `requireAdminUser(ctx): Promise<NonNullable<Context["user"]>>` (`backend/graphql/shared/admin-prelude.ts:31`) and `adminOnlyAuthScopes` const (`admin-prelude.ts:24-29`) — used by queries, NOT by census-scanned admin mutations (must be inline literal there).
- Service signature pattern: `createUser(input: AdminCreateUserSubmitInput, actorId: number, locale: string, outerTx?: DBTransaction): Promise<AdminUserDetailReturnType>` (`backend/services/admin/user-management.service.ts:261-266`) — `assertActorAdmin` inside, single `withTransaction`: `UserRepository.create` → role-child create (`StudentRepository.createForRegistration` with **handshake retry**, `ParentRepository.createForRegistration`) → `AuditService.createAuditLog` → `getUserDetail`. Duplicate email → localized `ConflictError`.

## 3. Schema registration / wiring (EXISTING)

- `backend/graphql/gqlSchema.ts:21-25`: imports `gqlSchemaBuilder` + `@/backend/graphql/gqlSchema.definitions`, then `export const graphQLSchema = gqlSchemaBuilder.toSchema();`
- `backend/graphql/gqlSchema.definitions.ts:15-21` — ordering: `@/backend/graphql/pothos` (object barrel) → `pothos/shared/scalar.pothos` → `pothos/shared/enum.pothos` → `@/backend/graphql/mutation` → `@/backend/graphql/query`.
- `backend/graphql/mutation/index.ts` — side-effect barrel importing `./auth.mutation`, `./admin`, `./billing`, `./classes`, `./parents`, `./notifications`, `./subscription-purchase.mutation`, etc.
- `backend/graphql/mutation/admin/index.ts:10-13` — side-effect imports of `admin-finance/admin-governance/admin-teachers/admin-users.mutation`.
- `backend/graphql/mutation/billing/index.ts` — wires `subscription-admin.mutation.ts`, `wallet.mutation.ts`.
- Pothos inputs/objects live in `backend/graphql/pothos/<domain>/` and are imported by mutation files by name (e.g. `AdminCreateUserInput` from `@/backend/graphql/pothos/admin`, defined `pothos/admin/admin-user.pothos.ts:313`; subscription inputs in `pothos/billing/subscription-admin.pothos.ts:54/71/89/112`).
- **After adding any mutation: `bun run generate:gqlSchema` then `bun codegen`** (per mutation AGENTS.md "Adding New Mutations" §).

## 4. Permission model — there are NO permission strings

- **MISSING/CREATE (proof):** `grep -rn "AppPermission|PERMISSION" backend/ shared/ --include="*.ts"` → only a test fixture string in `backend/db/test/logic/audit/audit-census-drift.test.ts:430` and placeholder comments. Admin authorization is **role-based only**: `UserRole` enum `backend/enum/users/user-role.enum.ts:5-10` (`Admin="admin", Teacher, Student, Parent`).
- `backend/graphql/pothos/builder.ts:126-143` defines the scope resolvers: `authenticated` (throws `UnauthorizedError` → 401), `role: (roles: UserRole[]) => ctx.role ? roles.includes(ctx.role) : false` (→ localized `ForbiddenError`, 403), `permission: () => true` (**placeholder, always passes** — `builder.ts:137-138` comment: "wired to PermissionsService.getUserContext later"), `superAdmin: () => ctx.isSuperAdmin`, `notImpersonating: true`.
- Context (`backend/graphql/gqlContextFactory.ts:76-89`): `ctx.user`, `ctx.safeUser`, `ctx.permissions: unknown[]` (unwired), `ctx.isSuperAdmin: boolean`, `ctx.role: UserRole | null`, `ctx.idempotencyKey?: string | null`, `ctx.cookies`, `ctx.authCookieOut`.
- **The exact admin-gate to use: `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`, inline literal.**

## 5. `backend/types/` canonical type inventory

| Entity | File | Exports (verbatim) |
|---|---|---|
| user | `backend/types/users/user.types.ts` | `UserSelectType`, `UserInsertType` (both `$inferSelect/Insert` of `users`) |
| registration | `backend/types/users/registration.types.ts` | `RegisterPublicRole = "student" \| "teacher" \| "parent"` (**admin excluded** — BFLA), `RegistrationSubmitInput`, `RegistrationReturnType` (`UserSelectType` minus `passwordHash`), `AdminRegistrationSubmitInput` (service-only, allows admin) |
| admin user | `backend/types/admin/admin-user.types.ts` | `AdminCreateUserSubmitInput` (`:209-217`: `fullName, email, phone, password, gender?, country, role: RegisterPublicRole`), `AdminUserDetailReturnType`, `AdminStudentSnapshotReturnType` (`:160-…`: `handshakeCode, parentId, primaryLanguage, anotherLanguage, hasParentLink, …` + balances), `AdminParentSnapshotReturnType`, `AdminUserListItemReturnType`, `AdminUserPageReturnType`, `AdminUpdateUserPatchInput` |
| student | `backend/types/students/student.types.ts` (43 lines total) | `StudentSelectType = typeof students.$inferSelect`; `HandshakeCodeLookupReturnType`; `HandshakeDiscoveryRowType`; `StudentLinkTargetRowType`. **NO `StudentInsertType`, NO `StudentReturnType`, NO `StudentSubmitInput`** — MISSING/CREATE if the new flow needs canonical shapes beyond SelectType |
| parent | `backend/types/parents/parent.types.ts` (3 lines) | `ParentSelectType` only. **NO `ParentInsertType`/`ParentReturnType`** |
| subscription | `backend/types/billing/subscription.types.ts` | `SubscriptionSelectType` (`:7`), `SubscriptionInsertType` (`:8`), `SubscriptionReturnType` (`:22-25`), `PurchaseSubscriptionSubmitInput` (`:42-44`: `{ readonly planId: number }`), `PurchaseSubscriptionReturnType` (`:50-54`), `ExpiredDueSubscriptionRow`, `SubscriptionExpirySweepReturnType` |
| subscription admin | `backend/types/billing/subscription-admin.types.ts` | `SubscriptionAuditTrailPeek`, `ChangeSubscriptionPlanResult`, `ExtendSubscriptionSubmitInput` (`subscriptionId, days`), `RenewSubscriptionSubmitInput`, (Cancel/Change inputs below) |
| student_payment | `backend/types/billing/student-payment.types.ts` | `StudentPaymentSelectType`, `StudentPaymentInsertType`, `StudentPaymentReturnType` (`Omit<Select,"status"|"paymentGateway"> & { status: PaymentStatus; paymentGateway: PaymentGateway }`) |
| audit_log | `backend/types/audit/audit-log.types.ts` (4 lines) | `AuditLogSelectType`, `AuditLogInsertType` |
| audit write contract | `backend/types/contracts/admin-audit.contract.types.ts:22-37` | `AuditLogWriteContract { actorId, actionType: AuditActionType, entityType: string, entityId, details: string }` — append-only, `actorId` always ctx-derived |
| gateway | `backend/types/billing/payment-gateway.types.ts` | `PaymentCheckoutInput`, `PaymentCheckoutSession { provider: PaymentGateway; providerReference: string; checkoutUrl: string | null }`, webhook outcome types |

**Verbatim — subscription core (`backend/types/billing/subscription.types.ts:7-25`):**

```ts
export type SubscriptionSelectType = typeof subscriptions.$inferSelect;
export type SubscriptionInsertType = typeof subscriptions.$inferInsert;
// paymentMethod stays nullable — a subscription exists before any gateway is
// involved, and admin-recorded offline payments may never set it.
export type SubscriptionReturnType = Omit<SubscriptionSelectType, "status" | "paymentMethod"> & {
  status: SubscriptionStatus;
  paymentMethod: PaymentGateway | null;
};
```

**Verbatim — student core (`backend/types/students/student.types.ts:4`):**

```ts
export type StudentSelectType = typeof students.$inferSelect;
```

Backed by schema columns (`backend/db/schema/students/students.ts:19-31`): `id` (PK=FK→users.id cascade), `balanceHifz/balanceReviews/balanceTajweed/balanceTrial`, `trialGrantedAt`, `primaryLanguage`, `anotherLanguage`, **`handshakeCode: varchar("handshake_code", {length:50}).notNull()`** (unique `students_handshake_code_unique`), **`parentId: integer("parent_id").references(users.id, onDelete:"set null")`**, timestamps.
Subscription columns (`backend/db/schema/billing/subscriptions.ts:33-41`): `status` (default `"pending"`), `startDate/endDate`, **`paymentMethod: paymentGateway("payment_method")` (nullable), `paymentReference: varchar("payment_reference",{length:255})` (partial unique when not null), `paymentVerifiedAt: timestamp("payment_verified_at")`** — all EXISTING, no schema change needed for offline payments.

## 6. Enums (all EXISTING)

- `PaymentGateway` — `backend/enum/billing/payment-gateway.enum.ts`: `Stripe, Paypal, Paymob, Fawry, OfflineCash="offline_cash", BankTransfer="bank_transfer", Scholarship="scholarship", Other="other", Mock="mock"`. Registered once as `PaymentGatewayPothosEnum` (`pothos/shared/enum.pothos.ts:226`) — **offline members already on the wire**. No backend `isPaymentGateway` guard exists (only a frontend one at `frontend/views/admin/finances/PaymentsFilterBar.tsx:51`) — **MISSING/CREATE** a value-guard if the new input takes a free-form method string; better: use `PaymentGatewayPothosEnum` as the input field type.
- `SubscriptionStatus` (`backend/enum/billing/subscription-status.enum.ts`): `Active, Pending, Expired, Cancelled, Suspended`.
- `AuditActionType` (`backend/enum/audit/audit-action-type.enum.ts`): `Create, Update, Delete, Override, Adjust, Suspend, Reactivate` — **no "payment"/"verify" member**; offline-activation audit would use `Create` or `Override`.
- `RegisterPublicRolePothosEnum` (student|teacher|parent) at `pothos/shared/enum.pothos.ts:90`.
- `UserRole` at `backend/enum/users/user-role.enum.ts:5`.

`SubscriptionPothosObject` already exposes `paymentMethod` (`t.expose(... type: PaymentGatewayPothosEnum, nullable: true)`, `pothos/billing/subscription.pothos.ts:84-88`), `paymentReference` (`:89`), `paymentVerifiedAt` (`:93-96`) — a returned offline-activated subscription needs **no new object type** (single-canonical-object rule).

## 7. Hard constraints the new mutation MUST satisfy (from tests + AGENTS.md)

1. **Anti-drift census (CRITICAL):** every admin-gated mutation (`role: [UserRole.Admin]` leg, literal `authScopes`) must have a `wired` row in `test/workflows/admin/audit-completeness.catalog.ts` (`AdminActionCensusEntry { mutationField, serviceEntry, expectedActionTypes, expectedEntityType, kind }`) — enforced in exact bijection by `backend/db/test/logic/audit/audit-census-drift.test.ts`. Add the census row or tests fail; also the audit-completeness journey executes it.
2. **authScopes must be inline literal** `$all` conjunction (scanner resolves literals only — `audit-census-drift.test.ts` header, and `subscription-admin.mutation.ts:57-61` comment).
3. **Pothos layer rules** (`backend/graphql/pothos/AGENTS.md`): no local types in pothos/mutation files — all shapes from `backend/types/**`; enums registered once in `shared/enum.pothos.ts` (never re-register); `id` exposed first; `DateTime`/string ISO serialization conventions.
4. **Mutation layer rules** (`backend/graphql/mutation/AGENTS.md`): side-effect imports only, no named exports; new file `mutation/<subdir>/<entity>.mutation.ts` + barrel entry; then `bun run generate:gqlSchema` + `bun codegen`. (Note: that AGENTS.md's layout tree is stale vs. the actual current tree — actual barrels are authoritative.)
5. **Types layer rules** (`backend/types/AGENTS.md`): single canonical type per entity in `backend/types/<domain>/`; naming `{Entity}SelectType/InsertType/ReturnType/SubmitInput`; no local types in Pothos files; barrels use relative `./` + `export *`.
6. **BOPLA/BFLA discipline** seen throughout: inputs are closed field-by-field whitelists (never `...input` spread); `AdminUpdateUserInput` structurally cannot reach `parentId`/role (`admin-user.pothos.ts:317-331`); admin role creation is service-gated. The new onboarding input must follow the same whitelist pattern (identity from `ctx.user.id`, financial fields server-derived; only the offline `paymentMethod` + `paymentReference` are legitimately client-supplied for this flow).

## 8. Gaps to CREATE (summary for the planner)

1. New admin mutation (e.g. `adminOnboardStudentOffline` / split user-create + offline-activate) — nothing exists; place under `mutation/admin/` or a new sub-dir; add to `admin/index.ts`.
2. New Pothos input(s) — reuse `AdminCreateUserInput`-style whitelist + `PaymentGatewayPothosEnum` for method; no offline input type exists today.
3. Optional parent association: no direct `students.parent_id` write surface exists — either extend the new input/service or drive the existing handshake link flow; `AdminUpdateUserInput` cannot do it.
4. `StudentInsertType`/`StudentReturnType` and `ParentInsertType` don't exist — create in `backend/types/students|parents/` if the flow's service contracts need them.
5. Census row + `bun run generate:gqlSchema` + `bun codegen` are mandatory post-steps; the audit write uses `AuditService.createAuditLog(input: AuditLogWriteContract, tx: DBTransaction)` (`backend/services/admin/audit.service.ts:82`) with `AuditActionType.Create`/`Override` — no new enum member exists for payment verification.</subagent>
<subagent agent_id="agent-3" item="FRONTEND + i18n + NAV. Inspect app/(dashboard)/ and frontend/views/dashboard/ for the ADMIN area: (1) existing admin pages for users/students/parents (exact route paths under app/, the view components, list+create/edit forms) — does any 'create student' or 'onboard student' admin UI exist?; (2) the sidebar/navigation config file where admin menu items are registered (path:line, group ids like grp_*, how items are added, permission-gated how); (3) the permission-gating mechanism for routes/components (requirePermissionForPage / RequirePermission — exact import paths + usage example); (4) how admin forms submit (Apollo useMutation hooks, which sharedDocuments files define them, naming convention {entity}MutationDocument); (5) shared/locale/ — the namespace structure for admin user/student management (exact directory + file names + key patterns), the Translation enum pattern with a REAL example from an existing admin view (import lines + usage), server-component getTranslations usage example; (6) shared UI components used by admin pages (AppDataGrid, PageContainer, form patterns — paths). Report path:line evidence for each." outcome="completed"># FRONTEND + i18n + NAV — Ground-Truth Report: "Direct Student Onboarding with Offline Payment"

## 1. Existing admin pages for users/students/parents

### Users directory + create/edit (EXISTING — closest analog, but NO subscription/payment/parent fields)
| Item | Evidence |
|---|---|
| Route `/admin/users` (server component) | `app/(dashboard)/admin/users/page.tsx:30-33` — `await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/users" }); return <AdminUsersDirectoryContainer />;` |
| Route `/admin/users/[id]` (detail) | `app/(dashboard)/admin/users/[id]/page.tsx:32-37` — `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/users" })`, params is `Promise<{ id: string }>` |
| Client container | `frontend/views/admin/users/directory/AdminUsersDirectoryContainer.tsx:49-50` — `const labels = useAppTranslation(AdminUsers); const directory = useAdminUsersDirectory();` |
| **Create User dialog** (supports `role: "Student" \| "Teacher" \| "Parent"`) | `frontend/views/admin/users/dialogs/CreateUserDialog.tsx:47-71` — `CreateUserDialogInput { fullName, email, phone, password, gender?: "Male"\|"Female"\|"Other", country, role: CreateUserDialogRole }`; `export type CreateUserDialogRole = "Student" \| "Teacher" \| "Parent"` (line 60). Plain registration ONLY. |
| Backend input confirms scope | `backend/graphql/pothos/shared/userFieldHelpers.ts:97-107` — `userRegistrationInputFields` returns only `fullName, email, phone, password, gender?, country, role: RegisterPublicRolePothosEnum` — **no plan/subscription/payment/parent fields** |
| Edit / delete / governance dialogs | `frontend/views/admin/users/dialogs/` (`EditUserDialog.tsx`, `DeleteConfirmDialog.tsx`, `DirectoryMutationDialogs.tsx`); suspend/block in `frontend/views/admin/users/hooks/useGovernanceActions.ts:71-72` |

### Students directory (EXISTING — read-only + subscription lifecycle, no student creation)
| Item | Evidence |
|---|---|
| Route `/students` (admin-only) | `app/(dashboard)/students/page.tsx` — renders `AdminStudentsDirectoryContainer`, guard `withPageAuth({ roles: [UserRole.Admin] })` (comment: "the read-only admin student directory") |
| Container + drawer | `frontend/views/admin/students/AdminStudentsDirectoryContainer.tsx:36,49,105` — mounts `AdminStudentDetailDrawer`; data via `useQuery(adminStudentsQueryDocument)` (`hooks/useAdminStudentsDirectory.ts:71`) |
| Drawer is read-only except subscriptions | `frontend/views/admin/students/AdminStudentDetailDrawer.tsx:11-14` — "The ONE exception is the subscription-management section … which hosts its own admin-only read + lifecycle mutations via `SubscriptionAdminSection`" |
| No create-student affordance | Grep for `Create|AddOutlined|Fab` in `AdminStudentsToolbar.tsx` + `AdminStudentsDirectoryContainer.tsx` → **0 matches** |

### Blocked-by: admin subscription management (EXISTING — extend/renew/cancel/upgrade/downgrade all shipped)
- Hook: `frontend/views/admin/students/subscriptions/hooks/useSubscriptionAdminActions.ts:45-60`:
  - `extend: (subscriptionId: string, days: number) => Promise<string | null>`
  - `renew: (subscriptionId: string) => Promise<string | null>`
  - `cancel: (subscriptionId: string, reason: string | null) => Promise<string | null>`
  - `changePlan: (subscriptionId: string, newPlanId: string) => Promise<string | null>`
  - plus `loading: { extend, renew, cancel, changePlan }` flags; resolves `null` on success, server-localized error string otherwise.
- Documents: `frontend/graphql/sharedDocuments/admin/admin-subscriptions.documents.ts:93-155` — `adminSubscriptionExtendMutationDocument` (`mutation AdminSubscriptionExtend($input: ExtendSubscriptionInput!)`, line 98), `adminSubscriptionRenewMutationDocument` (114), `adminSubscriptionCancelMutationDocument` (130), `adminSubscriptionPlanChangeMutationDocument` (148). List query `adminStudentSubscriptionsQueryDocument` (line 77), consumed by `SubscriptionAdminSection.tsx:85`.
- Dialogs: `frontend/views/admin/students/subscriptions/dialogs/{Extend,Renew,Cancel,ChangeSubscriptionPlan}SubscriptionDialog.tsx` + `SubscriptionActionDialogs.tsx`.

### MISSING / CREATE (proven absence)
- **No "onboard student" / "create student" UI**: `grep -ril "onboard\|CreateStudent\|createStudent\|registerStudent"` across `frontend/` + `app/` → 0 files.
- **No admin parents page/directory**: `frontend/views/admin/` has no `parents/` dir (verified `find frontend/views/admin -maxdepth 2 -type d`); nav has no parents route. Parents appear only as: a role filter in the users directory, and `AdminStudentParentContent.tsx` (display-only in the student drawer).
- **No admin parent-association mutation**: only self-scoped flows exist in `frontend/graphql/sharedDocuments/parents/parent-link.documents.ts` (`requestParentChildLink` line 100, `respondToParentLinkRequest` line 113) — no admin-side link.
- **No offline payment / payment_method UI anywhere in admin**: grep `offline_cash|bank_transfer|scholarship` in `frontend/` hits only `frontend/views/admin/finances/` filter plumbing (`paymentsFilterOptions.ts`, `PaymentsFilterSelects.tsx`) — no payment-method *entry* form.
- **`AppDataGrid`, `PageContainer` do not exist** (prompt assumed them): `find frontend -name "AppDataGrid*" -o -name "PageContainer*"` → 0 matches. The real table pattern is `DirectoryTableScaffold` (see §6). `MetricCard` exists at `frontend/views/admin/analytics/MetricCard.tsx`.
- **`requirePermissionForPage` / `RequirePermission` / `grp_*` nav group ids do not exist** (see §2–3).

## 2. Sidebar / navigation config

**File: `frontend/views/dashboard/nav/navItems.ts`** (223 lines). Rendered by `frontend/views/dashboard/nav/DashboardSidebar.tsx:7` via `getNavItemsForRole(user.role)`.

- Item shape (navItems.ts:42-46): `export interface DashboardNavItem { readonly route: string; readonly labelKey: NavLabelKey; readonly Icon: SvgIconComponent; }`
- Role map (navItems.ts:127): `const NAV_ITEMS_BY_ROLE: Record<UserRole, readonly DashboardNavItem[]>` — **role-keyed, NOT permission-keyed; there are NO `grp_*` group ids anywhere** (grep `grp_` across `frontend/`+`app/` → 0).
- Admin array (navItems.ts:156-176): `/admin/dashboard`, `/notifications`, `/admin/users` (line 159, labelKey `"users"`), `/teachers`, `/students`, `/admin/plans`, `/admin/lessons`, `/audit`, `/admin/finances`, `/admin/broadcasts`, `/admin/analytics`, `/admin/session-governance`, `/disputes`, `/profile`.
- Adding an item = (a) append `{ route, labelKey, Icon }` to the `[UserRole.Admin]` array, (b) add the `labelKey` to `DashboardLabels` (`shared/locale/types/dashboard/index.ts` — keys at lines 19-53: `title, dashboard, sessions, subscriptions, homework, schedule, wallet, users, teachers, students, plans, lessons, audit, finances, analytics, broadcasts, disputes, sessionGovernance, profile, …`) and BOTH `en` + `ar` leaves (`shared/locale/en/dashboard/`, `shared/locale/ar/dashboard/`), (c) update `frontend/views/dashboard/nav/navItems.test.ts`. `NavLabelKey` union (navItems.ts:60) excludes cross-namespace collisions between `DashboardLabels` and `HandshakeCodeLabels`; discriminator `isDashboardLabelKey` at line 70.
- Resolver: `getNavItemsForRole` at navItems.ts:198-201 (fallback = student nav).
- Cross-surface rule (frontend/AGENTS.md): route strings consumed by multiple surfaces must be single-sourced in a leaf lib module (e.g. `STUDENT_SESSIONS_ROUTE` from `@/frontend/lib/notification-route-resolution`, navItems.ts:31).

## 3. Permission/route gating mechanism

- **Role-based only** (auth ≠ permission machinery not built). The guard is:
  ```ts
  import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
  // signature (frontend/lib/auth/withPageAuth.ts:66):
  export async function withPageAuth(options?: WithPageAuthOptions): Promise<WithPageAuthResult>
  // WithPageAuthOptions (lines 34-47): { roles?: readonly UserRole[]; redirectTo?: string }
  // WithPageAuthResult (lines 49-56): { userId: number; user: RegistrationReturnType; role: UserRole }
  ```
  Usage (every admin page): `await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/users" })` (`app/(dashboard)/admin/users/page.tsx:31`).
- **MISSING: `requirePermissionForPage` and `<RequirePermission>`** — `app/AGENTS.md:39-45` documents them as the permission layer ("Missing `AppPermission`(s) → `requirePermissionForPage`"), and cites `app/(dashboard)/shared/withPageAuth.ts`, but grep for both identifiers across `app/ frontend/ backend/` → **0 matches**, and `app/(dashboard)/shared/` contains only `coming-soon-metadata.ts` + `index.ts`. There is no `AppPermission` enum. Any "permission-gated" UI for this ticket must be invented or shipped role-gated via `withPageAuth`. GraphQL-level denials surface through `PermissionDeniedBanner` (`frontend/components/ui/graphqlErrorSurface/PermissionDeniedBanner.tsx`) + `PermissionDeniedFallback` (`frontend/components/ui/PermissionDeniedFallback.tsx`) — display-only, not gating.

## 4. Admin form submission pattern (Apollo)

- Import: `import { useMutation, useQuery } from "@apollo/client/react";` (e.g. `useAdminUsersDirectory.ts:20`) — never bare `@apollo/client`.
- Documents live in `frontend/graphql/sharedDocuments/<domain>/<domain>.documents.ts` with co-located `.documents.test.ts` contract tests; barrel `frontend/graphql/sharedDocuments/admin/index.ts` re-exports all 10 files.
- **Actual naming convention**: `admin<Verb><Entity>MutationDocument` (camelCase, prefixed), e.g. `adminCreateUserMutationDocument` (`admin-users.documents.ts:179`), `adminUpdateUserMutationDocument` (189), `adminSubscriptionExtendMutationDocument` (`admin-subscriptions.documents.ts:93`). Queries: `adminUsersQueryDocument` (110). NOT the plain `{entityName}MutationDocument` from the ticket prompt — the `admin*` prefix is the house style.
- Mutation wiring idiom (`frontend/views/admin/users/hooks/useAdminUsersDirectory.ts:77-97`):
  ```ts
  const refetchAfterWrite = [{ query: adminUsersQueryDocument, variables }];
  const [createUser, { loading: createLoading }] = useMutation(adminCreateUserMutationDocument, {
    refetchQueries: refetchAfterWrite, awaitRefetchQueries: true,
  });
  ```
- Error handling: dialog `onSubmit` MUST let rejections propagate; `useAdminUserFormFeedback().runWithFeedback` (`frontend/views/admin/users/hooks/useAdminUserFormFeedback.ts:4-16`) projects VALIDATION field errors → `fieldErrors` (inline `helperText`), field-less → top-level alert. Server messages via `extractErrorMessage` / `extractErrorCode` from `@/frontend/lib/graphql-error-utils` (`useSubscriptionAdminActions.ts:33`, "Server denials arrive already localized by the backend").

## 5. i18n — `shared/locale/` structure

Namespace anatomy (4 files + parity test per namespace, exemplified by `adminUsers`):
| Piece | Path + evidence |
|---|---|
| Labels type | `shared/locale/types/adminUsers/index.ts` — `export interface AdminUsersLabels { title; detailTitle; headers: {...}; statusBadges: {...}; directoryChips: { childrenCount: { zero/one/two/few/many/other } } … }` — key pattern: nested `readonly` groups, plurals as `{zero,one,two,few,many,other}` with `{count}` ICU interpolation, interpolation as function types e.g. `planChangeCarried: (carry: number) => string` |
| en leaf | `shared/locale/en/adminUsers/index.ts:3` — `export const adminUsersEn: AdminUsersLabels = { title: "Users", … }` (single export per leaf, no logic) |
| ar leaf | `shared/locale/ar/adminUsers/index.ts` (mirror, exact key parity) |
| Namespace handle | `shared/locale/namespaces/adminUsers/adminUsers.namespace.ts:4-6` — `export const AdminUsers = defineNamespace<AdminUsersLabels>("adminUsers.adminUsers", translations => translations.adminUsersTranslations);` |
| `Translations` registry | `shared/locale/types/message.ts:44` — `adminUsersTranslations: AdminUsersLabels;` (also `adminStudentsTranslations:46`, `subscriptionAdminTranslations:56`, `dashboardTranslations:34`) |
| Parity test | `shared/locale/adminUsers-namespace.parity.test.ts` (one per namespace at `shared/locale/*-namespace.parity.test.ts`) |

- **Client usage (real example)**: `frontend/views/admin/users/directory/AdminUsersDirectoryContainer.tsx:47-50`:
  ```ts
  import { useAppTranslation } from "@/shared/locale/client";
  import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";
  const labels = useAppTranslation(AdminUsers);
  ```
  Signature (`shared/locale/client/use-app-translation.ts:9-11`): `useAppTranslation(): Translations` / `useAppTranslation<TLabels>(handle: NamespaceHandle<TLabels>): TLabels`. `defineNamespace` at `shared/locale/namespaces/define-namespace.ts:8-12`: `defineNamespace<TLabels>(id: string, getLabels: (translations: Translations) => TLabels): NamespaceHandle<TLabels>`.
- **Server usage (real example)**: `app/(dashboard)/admin/users/page.tsx:24-27`:
  ```ts
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).adminUsersTranslations;  // from @/shared/locale/server + @/shared/locale/server-cookies
  ```
  `getTranslations(locale: string): Translations` (`shared/locale/server.ts:15`).
- **Pattern rule (critical)**: server pages mount client containers **label-free** — namespaces carry interpolation closures that cannot cross the server→client props boundary (`app/(dashboard)/admin/users/page.tsx:15-19`).
- For this ticket you'd likely extend `adminStudents`/`subscriptionAdmin` (e.g. `subscriptionAdmin` success keys at `shared/locale/en/subscriptionAdmin/index.ts:89-94`: `success.extend: days => …`, `renew`, `cancel`, `planChange`) or add a new namespace following the 4-file + parity-test anatomy.
- Locale dir also has `subscriptionAdmin`, `adminStudents`, `parentLink`, `checkout` namespaces; no "onboarding" namespace (MISSING/CREATE).

## 6. Shared admin UI components (paths)

- **MISSING**: `AppDataGrid`, `PageContainer` (grep proved absence).
- EXISTING directory scaffolds: `frontend/views/admin/directory-shared/` — `DirectoryTableScaffold.tsx:38-52` (`props: { headers: readonly DirectoryTableHeader[]; loading: boolean; loadingLabel: string; skeletonKeys: readonly string[]; empty: ReactNode; rows: readonly ReactElement[]; pagination?: ReactNode }`), `DirectoryDetailDrawer`, `DirectoryToolbarCard`, `DirectoryPagerRow`, `DirectoryMobileCardList`, `DirectoryPageHeader`, `DirectoryEmptyState`, `DirectoryErrorAlert`, `DirectoryFeedbackSnackbar`, `DirectoryQuickFilterChips` (33+ files).
- EXISTING form scaffold: `frontend/views/admin/forms/FormDialogShell.tsx:12-31` — `FormDialogShellProps { titleId; dialogTitle; labels: { cancel; save; saving }; loading; globalError?: string | null; onClose: () => void; onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => void; children }` ("shared by every admin entity form content (plans, lessons)").
- EXISTING admin dialog primitives: `frontend/views/admin/users/dialogs/AdminDialogBands.tsx`, `AdminDialogFieldLabel.tsx`, `CreateUserFormGrid.tsx`, `CreateUserCredentialField.tsx`, `CreateUserRoleSegments.tsx`.
- EXISTING misc UI: `frontend/components/ui/` — `AdminDesktopTable.tsx`, `ErrorRetryAlert.tsx`, `NoticeSnackbar.tsx`, `PermissionDeniedFallback.tsx`; `frontend/views/admin/analytics/MetricCard.tsx`.
- URL-state helpers: `frontend/views/admin/directory-url-state/users.ts:42,57` — `parseUsersUrlState(searchParams: ReadableSearchParams)`, `serializeUsersUrlState(input: {...})` (filter/pagination state synced to the URL; students equivalent `frontend/views/admin/students/hooks/useStudentsUrlSync.ts`).

## 7. Most relevant layer AGENTS.md rules (verbatim-ish)

From `frontend/AGENTS.md`, `shared/locale/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md`, `app/AGENTS.md`:
1. **No hardcoded colors** — everything via `sx={(theme) => ({ ... })}` theme callbacks; MUI v9 forbids style props (`fontWeight`, `mb`, …) on Typography/Stack/Box; Material 3 `on<Color>` for contrast.
2. **React 19**: never `FormEvent`; use `React.SubmitEvent` / `React.SyntheticEvent<HTMLFormElement>`; cast FormData gets.
3. **Cross-surface routes** (nav entries, card CTAs, notification deep-links) must single-source their route string in a leaf lib module.
4. **i18n discipline** (`shared/locale/AGENTS.md`): leaf modules export a single typed const, **no logic**, ICU `{var}` interpolation; imports inside `shared/locale/**` must use `@/shared/locale/...` aliases; en/ar exact key parity enforced by per-namespace parity tests.
5. **Documents layout** (`sharedDocuments/AGENTS.md`): by-domain sub-directories with `index.ts` barrels, co-located `.documents.test.ts` contract tests.
6. **App Router** (`app/AGENTS.md`): pages are Server Components; containers (client) get mounted label-free; `withPageAuth` is the guard (its doc block cites `app/(dashboard)/shared/withPageAuth.ts` but the actual shipped module is `frontend/lib/auth/withPageAuth.ts`).

## 8. Key conclusions for the plan

1. The only "create student" path today is the **role-generic CreateUserDialog** (no `students`-row creation UI beyond it, no parent association, no subscription activation, no payment fields) — the full onboarding flow (multi-step: profile → parent → plan → offline payment) is **MISSING/CREATE**, and the backend input `AdminCreateUserInput` has no fields for it either.
2. Blocked-by **admin subscription management already exists** (extend/renew/cancel/changePlan) and can serve as the mutation/dialog/i18n blueprint; the student drawer (`SubscriptionAdminSection`) is the natural host for any "activate subscription" affordance — or a new dedicated route + nav item in `NAV_ITEMS_BY_ROLE[UserRole.Admin]`.
3. There is **no permission layer** — gating is `withPageAuth({ roles: [UserRole.Admin] })`; do not plan around `requirePermissionForPage`/`RequirePermission`/`grp_*` (they don't exist despite `app/AGENTS.md` referencing them).
4. No admin **parents CRUD** UI exists (only users-directory role filter + self-scoped parent-link flows) — the "associate a parent" step has no existing frontend surface.</subagent>
<subagent agent_id="agent-4" item="TICKET CONTEXT &amp; FINISHED-PLAN CONVENTIONS. (a) Read docs/planning/TICKETS.md lines 2357-2402 (the Direct Student Onboarding ticket) AND the appendix/decision tables near lines 3050-3124 — extract VERBATIM the definitions of decision refs B.9 (offline payment), A.5 (audit_logs), FR-10.2, INV-PAY5, and any surrounding rows mentioning subscriptions/payment_gateway/offline payment. (b) Explore ai/finished_plans/milestone_3_parent_portal_admin_governance/ — focus on: cold-start-bootstrapping-direct-sheikh-c/, immutable-audit-logging-for-all-admin-ac/, student-handshake-code-generation/, parent-child-link-request-workflow-7-day/, admin-crud-users-teachers-students-paren/. For each, report: file list, the heading skeleton of specs.md/plan.md/tasks.md (heading lines only), how EXISTING/UPDATE/CREATE labels and path:line citations are used, the subtask pipeline format (.QL/.TE/.SEC/.SR/.IV), journey-test task format, and deferred-items.md format. Report the plan directory naming convention actually used. (c) CRITICAL VERDICT: does 'Admin Subscription Management (Extend/Renew/Cancel/Upgrade/Downgrade)' exist as a finished plan AND as implemented code (grep backend/services for subscription extend/renew/cancel functions)? The ticket's Blocked-By lists it — report IMPLEMENTED/PARTIAL/NOT-IMPLEMENTED with evidence. (d) List relevant docs under docs/admin/, docs/billing/, docs/specs/, docs/workflows/, docs/parents/ touching onboarding/subscriptions/offline payment (paths + 1-line summaries)." outcome="completed"># Ground-Truth Report: Direct Student Onboarding with Offline Payment (TICKETS.md:2357)

## (a) Ticket & Decision-Ref Ground Truth (VERBATIM)

### The ticket — `docs/planning/TICKETS.md:2357-2402`

- **Heading**: `### Direct Student Onboarding with Offline Payment` (TICKETS.md:2357)
- **Fields** (TICKETS.md:2359-2365): Owner Stream **Dev 3**, Milestone **3**, Story Points **5**, Blocked By: `Admin CRUD: Users, Teachers, Students, Parents, Admin Subscription Management (Extend/Renew/Cancel/Upgrade/Downgrade)`
- **Description & Scope** (TICKETS.md:2367-2368): "Admin can manually register a student with profile, parent association, direct subscription activation, and offline payment (cash/bank transfer/scholarship). Offline payments bypass student_payments and are tracked via subscriptions.payment_method, payment_reference, and payment_verified_at."
- **Acceptance Criteria** (TICKETS.md:2369-2394, Gherkin): `users` row with `role='student'`; `students` row with `handshake_code`; `subscriptions` row with `payment_method = 'offline_cash' or 'bank_transfer' or 'scholarship'`, `payment_reference = admin-provided reference number`, `payment_verified_at = current timestamp`, `status = 'active'`; session balance credited immediately; **NO** `student_payments` row; parent link `parent_id` set + parent gains monitoring access; only valid `payment_gateway` enum values accepted.
- **Test Scenarios** (TICKETS.md:2395-2401): cash (active, balance credited, no student_payments); bank transfer (payment_reference stored); scholarship (`payment_method='scholarship'`); parent association; invalid payment method rejected; action logged in `audit_logs`.
- **Decision Refs** (TICKETS.md:2402): `B.9 (offline payment), A.5 (audit_logs), FR-10.2, INV-PAY5`

### Decision-ref definitions (verbatim)

| Ref | Verbatim definition | Evidence |
|---|---|---|
| **B.9** — Offline Payment Audit Trail | "**✅ RESOLVED** — **Decision:** Add payment method fields to the `subscriptions` table. **Schema impact:** `subscriptions.payment_method` (payment_gateway enum, extended with `offline_cash`, `bank_transfer`, `scholarship`), `subscriptions.payment_reference` (varchar), `subscriptions.payment_verified_at` (timestamp) columns added. The `payment_gateway` enum was extended with offline payment types." | `docs/specs/open-decisions-and-gaps.md:123-127` |
| **A.5** — No Audit Log Table | "**✅ RESOLVED** — **Decision:** Create an `audit_logs` table in the database. **Schema impact:** New `audit_logs` table added with `id`, `actor_id` (FK to users), `action_type` (audit_action_type enum), `entity_type`, `entity_id`, `details` (varchar for JSON), `created_at`. New `audit_action_type` enum created. Append-only (immutable)." | `docs/specs/open-decisions-and-gaps.md:35-40` |
| **FR-10.2** — Direct Student Onboarding | "**Requirement:** The Admin can manually register a student with profile, parent association, direct subscription activation (offline cash/transfer/scholarship), and teacher assignment." | `docs/specs/functional-requirements.md:263-264` |
| **INV-PAY5** | "Admin direct onboarding with offline payment (cash/transfer/scholarship) bypasses `student_payments`. **✅ RESOLVED (B.9):** Audit trail maintained via `subscriptions.payment_method`, `subscriptions.payment_reference`, and `subscriptions.payment_verified_at` fields." | `docs/specs/state-machine-invariants.md:302` |

Related rows: **INV-PAY2** (guarded `student_payments` UPDATE via `prevent_student_payments_update()`) at `state-machine-invariants.md:299`; **INV-PAY4** (`payment_gateway` (stripe, paypal, paymob, fawry, other)) at `:301`; **A.9 (subscription status)** → Subscription Purchase via Payment Gateway at `TICKETS.md:3101`; **B.17 (prorated plan changes)** at `TICKETS.md:3120`-ish Decision Coverage; **A.5 ticket mapping** at `TICKETS.md:3097`, **B.9 mapping** at `TICKETS.md:3111`. Milestone plan row: `docs/planning/MILESTONE_PLAN.md:270`; Dev-3 priority ordering at `MILESTONE_PLAN.md:280` (Direct onboarding is 4th, after Admin CRUD, Audit Logging, Cold-Start).

## (b) Finished-Plan Conventions — `ai/finished_plans/milestone_3_parent_portal_admin_governance/`

### Directory naming convention (EXISTING, verified)
`ai/finished_plans/milestone_<N>_<milestone_slug>/<ticket-title-kebab-case-truncated-to-~32-chars>/{specs.md, plan.md, tasks.md}`. Examples: `admin-crud-users-teachers-students-paren`, `cold-start-bootstrapping-direct-sheikh-c`, `immutable-audit-logging-for-all-admin-ac`, `parent-child-link-request-workflow-7-day`, `student-handshake-code-generation`. One historical exception: `milestone_1_core_domain_mvp/Admin Subscription Management-admin-subscription-management/` (space+slug compound). `admin-crud-users-teachers-students-paren/` additionally has a `ui_refactor/plan.md` subdir.

### File skeletons (heading lines, verified)

All five `specs.md` share one skeleton: `# Requirements & Specification: <Title>` → `## 1. Executive Summary & Problem Statement` → `## 2. Requirements & Acceptance Criteria (EARS Format)` with `### 2.1 Baseline & Foundational Preparation (MANDATORY)` … `### 2.9 Cross-Actor Workflow Scenarios (Journeys)` (incl. `#### Actor Table`, `#### Ordered Step List`, `#### Cross-Actor EARS Criteria` — e.g. parent-child-link specs.md:148-186) → `## 3. System Decisions & State Machine Invariants Alignment` (subsections: Decision References, State Machine invariants, Canonical Workflow Alignment, Architectural & Foundational Standards) → `## 4. Cross-Layer Traceability Matrix`.

All five `plan.md`: `# Technical Architecture & Implementation Design: <Title>` → `## 1. System Overview & Architecture Diagram` (`### 1.1 Scope Statement`, `### 1.2 Data Flow`/`Layer Flow`, `### 1.3 Key Design Decisions Table`) → `## 2. Data Models & Database Schema` (`### 2.1 Existing Schema Verification (READ-ONLY — zero drift gate REQ-0XX)`, then CREATE/EXTEND items per file) → `## 3. API Contracts & Pothos Resolvers` (`### 3.1 SDL additions (exact — REQ-060)`, `### 3.2 Pothos Registration`, `### 3.3 Error Mapping (extensions.code)`, `### 3.4 Permission Matrix`, `### 3.5 Schema-Baseline Updates (REQ-061)`) → `## 4. Backend Services, Repositories & Concurrency Model` (per-file sections) → later phases (frontend, testing, docs) → closing `## Deferred items` section (e.g. cold-start plan.md:476).

`tasks.md`: `# Implementation Tasks: <Title>` → `## Non-Negotiable Execution Protocol` → `## Phase 0: Pre-Implementation Baseline` (`### 0.1 Record Error Baseline & Seed Deferred-Items Ledger`, `### 0.2 Prerequisite & Dependency Verification (Read-Only Sweep)`) → numbered phases (Types/Enums/i18n → Repos/Services + Journey Tests (Test-First) → GraphQL → Frontend → Integration/Differential → Post-Implementation Review Waves → Knowledge Propagation & Documentation) → `## Dependency-Ordered Summary`.

### Label conventions (EXISTING, verified)
- **EXPERIENCE labels in plan.md headings/flow diagrams**: `(EXISTING — reuse)`, `(CREATE, first-lander)`, `(ADDITIVE — path)`, `(EXTENDED additive-only, REQ-003)`, `(ADDITIVE methods only)`, `(READ-ONLY — zero drift gate REQ-045)`. Examples: admin-crud plan.md:60-64 (`UserRepository.create (EXISTING — reuse)`), cold-start plan.md:237 (`### 4.1 … admin-gate.helpers.ts (CREATE, first-lander)`), student-handshake plan.md:101, 288.
- **path:line citations** used inline in prose/tables, e.g. cold-start plan.md:26 (`AdminUserDetailPothosObject` at `backend/graphql/pothos/admin/admin-user.pothos.ts:235-300`), plan.md:89 (`backend/graphql/gqlContextFactory.ts:167-238`, `:203-224`).

### Subtask pipeline format (tasks.md, verified)
Every major task has suffix-piped sub-items `<task-id>.<SUF> **<Name>:**`:
- `<id>.QL **Quality Loop:**` — `bun run scripts/health/sub-loop.ts <file> --lifecycle <stage>` exit 0 (admin-crud tasks.md:85)
- `<id>.TE **Test Engineering:**` — specific test commands + expected green (immutable-audit tasks.md:57)
- `<id>.SEC **Security & Tenancy Audit:**` (immutable-audit tasks.md:58)
- `<id>.SR **Semantic Review:**` (immutable-audit tasks.md:59)
- `<id>.IV **Instruction Verification:**` — validate against `.agents/instructions/backend.instructions.md` + applicable AGENTS.md (immutable-audit tasks.md:60)

All 13 M3 task files use these five labels (counted: .QL/.TE/.SEC/.SR/.IV appear in every tasks.md).

### Journey-test task format (verified, admin-crud tasks.md:141-195)
Pattern: `**<n.n> Write <Domain> journey test — TEST-FIRST (Journey X, specs §2.9)**` → file path `test/workflows/admin/<domain>.journey.test.ts` → scaffold-gate rule for `test/workflows/` layer (AGENTS.md + `helpers/journey-fixtures.ts` + `helpers/journey-cleanup.ts`) → real `users.role='admin'` actor rows (no monkey-patching, no scope-stubbing) → sequential numbered actor-attributed steps asserting shared-state transitions + `audit_logs` rows + atomicity.

### deferred-items.md format (verified — from `.kilo/worktrees/tree-culotte/ai/plans/…/Admin Subscription Management-admin-subscription-management/deferred-items.md`)
`# Deferred Items Ledger` → Purpose (every row must reach ✅; `grep -c "❌\|⚠️"` must print 0 at final gate) → `## Ledger Table` with columns `| ID | Deferred Item | Source Task | Target Task/Owner | Status | Verified By | Notes |` → `## Status Values` (✅ Done / ⚠️ Partial / ❌ Blocked / 🔄 In Progress) → `## Enforcement (final gate)`. NOTE: deferred-items.md files live under `ai/plans/<milestone_dir>/<feature>/` during execution, not in finished_plans — currently none present in the live `ai/plans/` (only `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones`); surviving copies found under `.kilo/worktrees/tree-culotte/ai/plans/…`. Plan.md seeds it at Task 0 (`### 0.1 Record Error Baseline & Seed Deferred-Items Ledger`, admin-crud tasks.md:24; cold-start plan.md:476).

## (c) VERDICT — Admin Subscription Management: **IMPLEMENTED**

Finished plan EXISTS: `ai/finished_plans/milestone_1_core_domain_mvp/Admin Subscription Management-admin-subscription-management/{specs,plan,tasks}.md` (with its `deferred-items.md` ledger — all D1–D5 ✅). Canonical doc: `docs/billing/admin-subscription-management.md` (373 lines; §3 Lifecycle Transition Table, §5 Proration, §11 Admin Drawer Surface).

Implemented code (EXISTING, verified):
- `backend/services/billing/subscription-admin.service.ts` — full signatures (all take `(input, actorId, locale, tx?: DBTransaction)`):
  - `extendSubscription(input: ExtendSubscriptionSubmitInput, actorId: number, locale: string, tx?: DBTransaction): Promise<SubscriptionReturnType>` (:159)
  - `renewSubscription(input: RenewSubscriptionSubmitInput, …): Promise<SubscriptionReturnType>` (:299)
  - `cancelSubscription(input: CancelSubscriptionSubmitInput, …): Promise<SubscriptionReturnType>` (:400)
  - `changeSubscriptionPlan(input: ChangeSubscriptionPlanSubmitInput, …): Promise<ChangeSubscriptionPlanResult>` (:488, delegates to `changeSubscriptionPlanFlow` in `subscription-plan-change.helpers.ts:448`)
  - `listForAdmin` (:526), `auditEntriesCount` (:561), `auditTrailPeek` (:586)
- GraphQL: `backend/graphql/mutation/billing/subscription-admin.mutation.ts` registers `adminExtendSubscription` (:88), `adminRenewSubscription` (:121+), `adminCancelSubscription`, `adminChangeSubscriptionPlan`; Pothos at `backend/graphql/pothos/billing/subscription-admin.pothos.ts`.
- Tests: `backend/services/billing/subscription-admin.service.test.ts` (EXISTING).
- Blocked-by "Admin CRUD" is likewise implemented: `backend/services/admin/user-management.service.ts` (+ `.helpers.ts`, `.mappers.ts`, chaos tests), `teacher-directory.service.ts`, `student-directory.service.ts`, `backend/services/parents/parent-link-request.service.ts` + `parent-monitoring.helpers.ts`; doc `docs/admin/user-management.md` ("Status: Implemented and verified").

## Schema / enum ground truth (relevant, EXISTING)

- `backend/db/schema/billing/subscriptions.ts:38-56` — `status` (`subscriptionStatus`, default `'pending'`), `paymentMethod: paymentGateway("payment_method")` (:41, nullable), `paymentReference: varchar("payment_reference", { length: 255 })` (:42), `paymentVerifiedAt: timestamp("payment_verified_at")` (:43), partial unique `subscriptions_payment_reference_unique WHERE payment_reference IS NOT NULL` (:54-56). File header (:13-14) already documents "support admin-verified offline payments".
- `backend/enum/billing/payment-gateway.enum.ts:15-17` — `OfflineCash = "offline_cash"`, `BankTransfer = "bank_transfer"`, `Scholarship = "scholarship"` (+ stripe, paypal, paymob, fawry, other, mock; order matters per :4-5). DB enum mirrored at `backend/db/schema/enums.ts:61-63`.
- `backend/db/schema/students/students.ts:31-32` — `handshakeCode: varchar("handshake_code", { length: 50 }).notNull()`, unique constraint (:40); `parentId: integer("parent_id").references(() => users.id, { onDelete: "set null" })` (:32).
- `backend/db/schema/audit/audit-logs.ts:34-45` — `actor_id` FK, `actionType: auditActionType("action_type").notNull()`, `entityType` varchar(100), `entityId` integer, `details` varchar(2000). Enum members at `backend/db/schema/enums.ts:102-110`: `create, update, delete, override, adjust, suspend, reactivate`.
- `backend/db/schema/users/users.ts:19` — `role: userRole("role").notNull()`.

Layer rules most relevant (from `backend/services/AGENTS.md`): domain-driven services (no monoliths); all types from `backend/types/` (`{Entity}SubmitInput`, `DBTransaction`), service-layer `.types.ts` prohibited; i18n via `getServerTranslations(locale, "…")` from `@/shared/locale/server-graphql`; logger `logDomainError` for denials; SSR-usable (no GraphQL ctx reliance). `backend/db/schema/AGENTS.md`: Drizzle-only, one domain per file, domain-grouped subdirectories with barrels.

## (d) Relevant docs

| Path | Summary |
|---|---|
| `docs/billing/admin-subscription-management.md` | Canonical admin subscription lifecycle reference (extend/renew/cancel/change-plan, proration arithmetic, audit-verb mapping, drawer UI) |
| `docs/billing/subscription-purchase.md` | Gateway purchase flow; `subscriptions_payment_reference_unique` partial-unique semantics (line 189) |
| `docs/billing/plan-catalog.md` | Plan catalog (plans CRUD, admin-only) |
| `docs/billing/segregated-session-balance.md` | Session balance crediting model (needed for "credit balance immediately") |
| `docs/billing/subscription-validity-window-expiry.md` | Subscription window/expiry sweep interplay |
| `docs/billing/admin-financial-auditing.md` | Admin payments/wallet audit surface |
| `docs/admin/user-management.md` | Admin CRUD canonical reference — "Implemented and verified"; specs A.5/A.7/B.6/B.7 |
| `docs/admin/audit-trail.md` | `audit_logs` read-back canonical (FR-10.5, INV-U1/U5) |
| `docs/admin/account-governance.md` | Four-state users governance lifecycle |
| `docs/admin/cold-start-certification.md` | Cold-start sheikh certification (nearest "direct registration" precedent) |
| `docs/specs/functional-requirements.md` | FR-10.2 at :263; FR-10.1 CRUD; FR-10.5 audit |
| `docs/specs/state-machine-invariants.md` | INV-PAY2/4/5 at :299-302 (offline bypass + immutability guards) |
| `docs/specs/open-decisions-and-gaps.md` | A.5 (:35), B.9 (:123) definitions |
| `docs/workflows/05-admin-governance-override.md` | Workflow 05 — super-admin governance & override source of truth |
| `docs/workflows/04-parent-supervision-handshake.md` | Parent linking; `students.handshake_code` (A.3) and `students.parent_id` (A.2) resolved decisions (:89, :150, :160) |
| `docs/parents/handshake-code-discovery.md` | Handshake-code discovery read-side contract |
| `docs/parents/parent-link-request.md` | Link-request workflow (7-day expiry) canonical |
| `docs/parents/monitoring-portal.md` | Parent read-only monitoring (post-link access) |

**Bottom line for the plan**: both Blocked-By dependencies are IMPLEMENTED (admin CRUD services + admin subscription lifecycle mutations with audit integration). All schema columns and enum values the ticket requires already exist (`subscriptions.payment_method/payment_reference/payment_verified_at`, offline `payment_gateway` members, `students.handshake_code`, `students.parent_id`, `audit_logs`). The new work is a direct-onboarding orchestration service/mutation that reuses `UserRepository.create` / `StudentRepository.createForRegistration`-style primitives (per admin-crud plan.md:60-61), subscription creation with offline payment fields, immediate balance credit, offline bypass of `student_payments`, and an `audit_logs(create)` write — following the M3 plan conventions above.</subagent>
<subagent agent_id="agent-5" item="TEST INFRASTRUCTURE. (1) Read test/workflows/AGENTS.md fully and report its binding rules; list existing workflow test files per domain dir (admin/, billing/, parents/, helpers/) and read ONE representative journey test in full — report its skeleton: imports, fixture/cast provisioning helper usage, assertion style, cleanup pattern, how it runs services vs GraphQL. (2) Inspect backend/db/test/ — report runInRollback import path + usage pattern, expectRepoError or equivalent helper, and the entity-setup helpers relevant to students/parents/subscriptions/users (exact helper names + full signatures from entity-setup.ts or similar). (3) Inspect frontend/graphql/test/ — report setupTestServerLifecycle + testClient import paths and a minimal mutation-test skeleton from an existing test. (4) Report exact commands to run: a single workflow test, db repo test, services test (the repo's run-test.ts wrapper), citing package.json script names. (5) Check backend/services tests location/existence (test:services script) and one example service test's mocking pattern. All with path:line evidence." outcome="completed"># Test Infrastructure Report — "Direct Student Onboarding with Offline Payment" (TEST INFRASTRUCTURE scope)

## 1. Workflow / Journey layer (`test/workflows/`)

### 1a. Binding rules — `test/workflows/AGENTS.md` (98 lines, read fully)

EXISTING. Key hard rules with line evidence:

1. **NO `runInRollback` — ever** in this layer; services use the global `db` and spawn their own top-level transactions (`test/workflows/AGENTS.md:8-11`). This layer is the documented exception to the db-test rollback rule.
2. **Committed fixtures + tracked cleanup**: full actor cast created in `beforeAll` inside ONE committing `db.transaction(...)` (commit-or-nothing); every created row id (incl. service-minted side-effect rows) tracked and hard-deleted in `afterAll` in FK-safe reverse order; mandatory post-teardown zero-residue probes — a leaking `afterAll` must fail the suite (`:12-19`).
3. **Unique per-run prefixes**: `` const prefix = `jrn_<domain>_${randomUUID().slice(0, 8)}` `` (`:20-22`). Helper: `journeyPrefix(domain: string): string` → returns `jrn_${domain}_${randomUUID().slice(0,8)}` (`test/workflows/helpers/session-cast.ts:314-316`).
4. **Honest authorization only**: real `users` rows + real role-child rows via the actor-context factory; never monkey-patch role/permission resolution; negative steps must fail through real auth checks (`:23-26`).
5. **External effects always intercepted**: nothing reaches real email/SMS/push/FX; spy the dispatch boundary with `spyOn` from `bun:test` (fallback `mock.module` + restore in `afterAll`); assert both that a dispatch happened and WHICH userIds it targeted (`:27-29` + `:56-58`).
6. **Never `expect(...).rejects.toThrow()`** — use a try/catch helper and assert translated substrings from `getServerTranslations("en").errorsTranslations` (`:30-31`).
7. **`bun:test` for framework imports** — no Jest/Vitest, no `console.*`, no `any` (`:32-33`).
8. **`@/` import aliases** (`@/test/workflows/helpers`), never relative parent paths (`:34-35`).
9. **Never use demo/seeded rows** — create entities via `backend/db/test/entity-setup.ts` helpers (`createTestUser`, `createTestStudent`, `createTestParent`, `createTestApplicant`, `createTestAdmin`); verify signatures first (`:36-39`).
10. **Organization**: one journey file per workflow at `test/workflows/<domain>/<workflow>.test.ts`; shared scaffolding only in `test/workflows/helpers/` with a pure `export *` barrel (`:40-41`).
11. **Sequential actor-attributed steps**: each service call receives the actor's real `actorUserId` from the actor-context factory; later steps observe state earlier steps committed (`:42-46`).
12. **Cross-actor visibility + denial assertions**: assert both the intended observer sees the change AND other cast members see no fan-out, plus at least one denial probe through the real auth path (`:47-50`).

Running (per `test/workflows/AGENTS.md:91-98`): single journey `bun run test/scripts/run-test.ts test/workflows/<domain>/<workflow>.test.ts`; whole layer `bun run test/scripts/run-test.ts test/workflows`.

### 1b. Existing journey files per domain dir (EXISTING, `ls test/workflows/`)

| Dir | Files |
|---|---|
| `admin/` | account-governance, admin-session-governance, admin-user-denials, admin-user-lifecycle, audit-completeness.catalog.ts, audit-completeness.journey, audit-trail, cold-start-certification, platform-analytics (all `.journey.test.ts`) |
| `billing/` | admin-financial-auditing, financial-safety-verification, paymob-live-tunnel.journey, paymob-purchase-journey, subscription-admin-lifecycle.journey, subscription-expiry.journey, subscription-purchase.journey |
| `classes/` | session-report-cross-teacher, session-report-homework, session-request-notifications |
| `helpers/` | `actor-context.ts`, `admin-governance-cast.ts`, `in-memory-claim-cache.ts`, `journey-actor-fixtures.ts`, `journey-cleanup.ts`, `journey-fixture-registry.ts`, `journey-fixtures.ts`, `second-precision.ts`, `session-cast.ts`, `spied-transport.ts`, `tracked-fixtures.ts`, `index.ts` (barrel) + self-tests (`helpers.self-test.test.ts`, `journey-fixtures.smoke.test.ts`) |
| `notifications/` | admin-broadcast.journey, broadcast-retraction.journey, j1-targeted-single-recipient, j2-cohort-broadcast-offline-persistence |
| `parents/` | handshake-discovery, parent-link-request.journey, parent-monitoring.journey, parent-session-completion-deep-link, student-confirmation-of-link |
| `sessions/` | post-confirmation-dispute, recitation-record, session-dual-confirmation, session-lifecycle-denials, session-lifecycle, session-state-machine |
| `teachers/` | evaluation-loop-booking, student-teacher-rating |

Note: **no `students/` domain dir exists** — student onboarding journeys would create it or live under `admin/`. MISSING/CREATE (grepped `ls test/workflows/` — no `students/` dir).

### 1c. Representative journey skeleton — `test/workflows/billing/subscription-admin-lifecycle.journey.test.ts` (901 lines; read setup/teardown + 3 step bodies)

- **Imports** (`:53-87`): `import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"`; `drizzle-orm` operators; `import { db, queryDb } from "@/backend/db"`; schema tables (`subscriptions`, `students`, `auditLogs`, `plans`, `studentSubscriptions`, `notifications`, `subscriptionPurchaseIdempotency`); entity-setup `createTestPlan, createTestSubscription` from `@/backend/db/test/entity-setup` (`:64`); enums from `@/backend/enum/...`; services `SubscriptionAdminService`, `SubscriptionPurchaseService` (`:70-73`); `getServerTranslations` from `@/shared/locale/server-graphql` (`:75`); `countUsersByIds, deleteUsersByIds, withAuditDeleteTriggersSuspended` from `@/test/helpers/db-cleanup` (`:76`); helpers barrel: `type JourneyActor, journeyPrefix, provisionAdminActor, provisionStudentActor, TrackedFixtures` from `@/test/workflows/helpers` (`:78-87`).
- **Prefix / translations** (`:91-93`): `const tErrors = getServerTranslations(LOCALE).errorsTranslations;` `const runPrefix = journeyPrefix("billing")`.
- **Spy** (`:173`): `const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});` (module-level; restored in `afterAll`).
- **Fixture registry** (`:175`): `const tracked = new TrackedFixtures()` — one per suite.
- **beforeAll** (`:343-390`): one COMMITTING `await db.transaction(async tx => { admin = await provisionAdminActor(tx, { tracked }); student = await provisionStudentActor(tx, { tracked }); ... await createTestPlan(tx, {...}); tracked.register(plans, sourcePlanId); ... await createTestSubscription(tx, student.userId, sourcePlanId, { status: SubscriptionStatus.Active, startDate: S_START, endDate: S_END }); sId = subscription.id; tracked.register(subscriptions, sId); })`.
- **afterAll** (`:391-467`): assert zero dispatches + `publishSpy.mockRestore()` (`:393-395`); sweep audit rows FIRST inside `withAuditDeleteTriggersSuspended(async () => { db.delete(auditLogs).where(inArray(auditLogs.actorId, journeyUserIds)); queryDb("DELETE FROM audit_logs WHERE entity_type = 'user' ...") })` (`:405-414`); defensive notification sweep (`:417`); `await deleteUsersByIds(journeyUserIds)` (`:422`); `await tracked.cleanup()` (`:433`); then **mandatory post-teardown probes**: `expect(await countUsersByIds(journeyUserIds)).toBe(0)` (`:437`), zero audit rows per actor/entity, zero `studentSubscriptions` residue (`:439-460`).
- **Step style** — sequential `test("step N — <actor>: ...", ...)` blocks in declaration order inside one `describe` (`:468-881`). Steps call **services directly, NOT GraphQL** — e.g. `await SubscriptionAdminService.extendSubscription({ subscriptionId: sId, days: EXTEND_DAYS }, admin.userId, LOCALE)` (`:502-507`). Assertions are read-back against the real DB via local helpers (`readSubscriptionRow`, `readStudentLanes`, `countAuditRowsForActor`, `readSubscriptionAuditRows`) plus exact audit-row contracts (`expect(updateRow.actionType).toBe(UPDATE_VERB)` etc., `:523-538`).
- **Denial pattern** (`:837-845`): `const error = await catchJourneyError(() => SubscriptionAdminService.adminCancelSubscription(...))`; `expect(error).toBeInstanceOf(ForbiddenError)`; `expect(error.message).toContain(<translated substring from tErrors>)` — verified for steps 10–11 (`:837-881`).
- **Mid-journey System steps commit their own small `db.transaction`** (`:623`).

### 1d. Journey helper signatures (EXISTING)

- `test/workflows/helpers/index.ts:21-29` — pure `export *` barrel of: `actor-context`, `in-memory-claim-cache`, `journey-actor-fixtures`, `journey-cleanup`, `journey-fixture-registry`, `journey-fixtures`, `second-precision`, `session-cast`, `spied-transport`, `tracked-fixtures`. (AGENTS.md `:60-62` mentions `createSessionFixtureRegistry()`; the actual class in use is **`TrackedFixtures`** — `tracked-fixtures.ts:173`.)
- **actor-context** (`actor-context.ts:43-48`): `interface JourneyActor { readonly userId: number; readonly locale: AppLocale; readonly role: UserSelectType["role"] }`; options `ActorProvisionOptions { locale?: AppLocale; tracked?: TrackedFixtures }` (`:50-61`).
  - `provisionStudentActor(tx: DBTransaction, options: ActorProvisionOptions = {}): Promise<JourneyActor>` (`:88-92`) — `createTestUser(tx, { role: "student" })` + `createTestStudent(tx, user.id)`, registers user row then child row.
  - `provisionCertifiedTeacherActor(tx, options)` (`:105-113`) — teacher row with `isApproved: true`.
  - `provisionParentActor(tx, options)` (`:122-129`) — `createTestParent(tx, user.id)`.
  - `provisionAdminActor(tx, options)` (`:136-143`) — `createTestAdmin(tx, user.id)`.
- **TrackedFixtures** (`tracked-fixtures.ts:173`): `register(table: PgTable, id: number, options: TrackedFixtureRegisterOptions = {}): void` (`:203`) — duplicate `(table,id)` no-op, garbage id throws; `async cleanup(): Promise<TrackedFixtureCleanupReport>` (`:244`) — hard-deletes in reverse registration order inside one committed transaction, then existence-probes every registered row, throws on any residue; `cleanup` is idempotent (registry cleared).
- **catchJourneyError** (`journey-fixtures.ts:226`): `export async function catchJourneyError(fn: () => Promise<unknown>): Promise<Error>` — try/catch, throws if call resolved, wraps non-Error throws.
- **SpiedFanoutTransport** (`spied-transport.ts:49`): `export class SpiedFanoutTransport implements FanoutTransportLike` with `async publishFanout(userIds: readonly number[], payload: RealtimeNotificationPayload): Promise<void>` (`:57`), getters `calls` / `publishCount` / `lastCall` / `publishedUserIds`, `clear()`.
- **journeyPrefix** (`session-cast.ts:314`): `export function journeyPrefix(domain: string): string`.

## 2. `backend/db/test/` (repo/logic layer)

### 2a. Rules — `backend/db/test/AGENTS.md`

- Every DB test MUST run inside `runInRollback` imported from `./test-utils`; pass `tx` to ALL repository methods AND direct Drizzle queries; type tx params as `DBTransaction`, never `any` (`AGENTS.md:19-23`).
- Use `entity-setup.ts` helpers (`createTestUser`, `createTestStudent`, `createTestTeacher`, `setupTeacher`, `setupStudent`) or define clear local helpers; unique emails/keys via `randomUUID()`/prefixes (`:25-29`).
- **NEVER `expect(...).rejects.toThrow()` inside `runInRollback`** — deadlocks. Use the try/catch `expectRepoError` helper; assert on `.message` with translated substrings (never raw keys) via `.toContain()` (`:31-46`).
- Provider/external integration tests do NOT go here — `test/integration/` only (`:5-15`).

### 2b. `runInRollback` + `expectRepoError` — `backend/db/test/test-utils.ts`

- `export async function runInRollback<T>(fn: (tx: DBTransaction) => Promise<T>): Promise<T | undefined>` (`test-utils.ts:34`) — top-level `db.transaction` forced to roll back via a discarded `SENTINEL` throw; real test failures propagate.
- `export async function expectRepoError(fn: () => Promise<unknown>): Promise<Error>` (`test-utils.ts:73`, body confirmed) — try/catch, throws `expectRepoError: expected the call to throw...` if resolved; also re-exports `export type { DBTransaction } from "@/backend/types"` (`:15`).
- Import path: `import { type DBTransaction, expectRepoError, runInRollback } from "@/backend/db/test/test-utils"` (verbatim in `backend/db/test/repo/billing/wallet.repository.admin.test.ts:50`, `student-payment.repository.admin.test.ts:53`; service tests use the same alias — `backend/services/admin/user-management.service.test.ts:46`).

### 2c. entity-setup helpers — `backend/db/test/entity-setup.ts` (full signatures, verbatim)

| Helper | Signature (line) | Defaults |
|---|---|---|
| `createTestUser` | `(tx: DBTransaction, overrides: Partial<UserSelectType> = {}) => Promise<UserSelectType>` (`:74`) | `fullName: "Test User <uuid8>"`, `email: "test-<uuid>@test.local"`, `role: "student"`, `isDeleted/suspended/isBlocked: false`, `lastActiveAt: new Date()`, stub bcrypt hash |
| `createTestStudent` | `(tx: DBTransaction, userId: number, overrides: Partial<StudentSelectType> = {}) => Promise<StudentSelectType>` (`:104`) | `id: userId`, `handshakeCode: "KSB-<uuid8 upper>"`, `balanceHifz/balanceTajweed/balanceReviews: 0`, `parentId: null` |
| `createTestParent` | `(tx: DBTransaction, userId: number) => Promise<ParentSelectType>` (`:131`) | PK-only `parents` row |
| `createTestApplicant` | `(tx, userId: number, overrides: Partial<ApplicantSelectType> = {})` (`:143`) | `status: "pending"`, `verificationAttempts: 0` |
| `createTestAdmin` | `(tx: DBTransaction, userId: number) => Promise<AdminSelectType>` (`:169`) | PK-only `admin` row |
| `createTestPlan` | `(tx, overrides: Partial<PlanSelectType> = {}) => Promise<PlanSelectType>` (`:180`) | `sessionCount: 8`, `price: "200.00"`, `currency: "EGP"`, `intervalDays: 30`, `isActive: true` |
| `createTestSubscription` | `(tx, userId: number, planId: number, overrides: Partial<SubscriptionSelectType> = {}) => Promise<SubscriptionSelectType>` (`:222`) | `status: SubscriptionStatus.Active`, `startDate: new Date()`, `endDate: null`, **`paymentMethod: null`, `paymentReference: null`, `paymentVerifiedAt: null`** — directly relevant: overrides can set offline payment fields |
| `createTestStudentPayment` | `(tx, studentId: number, subscriptionId: number | null, overrides: Partial<StudentPaymentSelectType> = {})` (`:264`) | `amount: "100.00"`, `currency: "EGP"`, `paymentGateway: PaymentGateway.Stripe`, `status: PaymentStatus.Paid`; doc comment says "Offline-payment channels are set via `paymentGateway` overrides" (`:259`) |
| Others | `createTestSession` (`:303`), `createTestSessionReport` (`:344`), `createTestHomeWork` (`:376`), `createTestLesson` (`:410`), `createTestEvaluation` (`:440`), `createTestWallet` (`:478`), `createTestTeacherTransaction` (`:514`), `createTestTeacherRow` (`:550`) | — |

## 3. `frontend/graphql/test/` (GraphQL integration layer)

### 3a. Rules — `frontend/graphql/test/AGENTS.md` (187 lines, read fully; most relevant)

- Import shared infra from `@/test/helpers` — `import { setupTestServerLifecycle, testClient } from "@/test/helpers"` (preferred alias, `AGENTS.md:30`).
- `setupTestServerLifecycle()` hooks `beforeAll`/`afterAll` to spawn the Next.js dev server on fixed port `3066` (`TEST_PORT`, env override `GRAPHQL_TEST_PORT`), poll until ready, kill the process tree after the suite (`:45-53`).
- No raw string queries, no raw `fetch` — pass `TypedDocumentNode` documents from `@/frontend/graphql/sharedDocuments/<subdir>/` (with `generate:gqlSchema` + `codegen`) to `testClient` (`:64-77`).
- `errorPolicy: "all"`: GraphQL errors do NOT throw — assert on `result.error`, use `expectMutationError(result.error, "CODE")` (`:87-89` + `test/helpers/expect-mutation-error.ts:33`).
- **Strict interface separation**: tests interact exclusively via GraphQL/`testClient`; NEVER import backend repositories, drizzle schemas, or services (except fixture provisioning/teardown via sanctioned helpers) (`:99-102`).
- **Mutation Argument Coverage (CRITICAL)**: every mutation call site must pass ALL input args (required + optional); optional fields appear explicitly as `null`; enums always from generated `@/frontend/graphql/generated/gql/graphql`, never hardcoded strings (`:104-140`).
- Cleanup guards must guard ALL required ids (no `id || ""` for `String!`) (`:158-166`).
- `gateway/` suites run in-process against the built schema (`import { graphQLSchema } from "@/backend/graphql/gqlSchema"`), no live server (`:36-38`).

### 3b. Exact import paths (EXISTING)

- `setupTestServerLifecycle` — `test/helpers/test-lifecycle.ts:41`: `export function setupTestServerLifecycle(): void` (spawns `node_modules/.bin/next dev --turbopack` on `TEST_PORT` via `Bun.spawn`, 60s poll deadline / 90s beforeAll timeout); re-exported at `test/helpers/index.ts:13`.
- `testClient` — `test/helpers/graphql-test-helpers.ts:8`: `export const testClient = new ApolloClient({...})` (HttpLink, `TEST_PORT = Number(process.env.GRAPHQL_TEST_PORT ?? 3066)` at `:6`); re-exported at `test/helpers/index.ts:11` with `extractErrorCode, TEST_PORT`.
- Also from `@/test/helpers`: `expectMutationError` (`test/helpers/expect-mutation-error.ts:33`: `export function expectMutationError(error: unknown, expectedCode?: string): CombinedGraphQLErrors`), `insertAdminUserWithChildRow` (`test/helpers/fixture-rows.ts:69`: `export async function insertAdminUserWithChildRow(params: { fullName: string; email: string; phone: string; password: string }): Promise<number>` — admin BFLA seam, real bcrypt hash so public `login` mints a genuine token), `deleteUsersByIds` / `countUsersByIds` / `deleteSessionsByParticipantUserIds` (`test/helpers/db-cleanup.ts:123/143/295`), `withAuditDeleteTriggersSuspended` (`db-cleanup.ts:83`), `withImmutabilityTriggersSuspended` (`db-cleanup.ts:229`).

### 3c. Minimal mutation-test skeleton — `frontend/graphql/test/subscription-admin/subscription-admin.test.ts` (871 lines)

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  countUsersByIds, deleteUsersByIds, describeGraphqlSuite,
  expectMutationError, insertAdminUserWithChildRow,
  setupTestServerLifecycle, testClient,
} from "@/test/helpers";                       // :103-112

describeGraphqlSuite("...", () => {
  setupTestServerLifecycle();                  // per AGENTS.md:48-50
  // fixture provisioning via registerUserMutationDocument + loginMutationDocument
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: { input: { fullName, email, phone, password, gender: null, country: "EG", role, preferredRecitation: null } },
  });                                          // :305-318 — ALL optional fields as null
  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: TEST_CREDENTIAL },
  });                                          // :325-329 → accessToken
  // admin: const userId = await insertAdminUserWithChildRow({...}); then login  :341-357
  // per-request identity: context: { headers: { Authorization: `Bearer ${token}` } } (bearer() :142-144)
  const result = await testClient.mutate({
    mutation: adminExtendSubscriptionMutation,
    variables: { input: { subscriptionId: "1", days: 5 } },
  });                                          // :554-558
  expectMutationError(result.error, "UNAUTHORIZED");   // errorPolicy "all" → assert result.error
```

Auth pattern: shared `testClient` sends NO cookies — every operation carries its own `Authorization: Bearer <accessToken>` header; anonymous probes omit it (`subscription-admin.test.ts:35-38, 142-144`). Cleanup: track created user ids, top-level `afterAll` `deleteUsersByIds` + `countUsersByIds(...) === 0` probes. Wire documents here are local `parse(...)`d `TypedDocumentNode`s (`:199-201`) because shared admin-subscription documents don't exist; new suites should prefer sharedDocuments + codegen.

## 4. Exact run commands (package.json evidence)

| Purpose | Command (verbatim) | Evidence |
|---|---|---|
| Single workflow journey | `bun run test/scripts/run-test.ts test/workflows/<domain>/<workflow>.test.ts` (also `--last`, `--last --focus "<pattern>"`) | `test/workflows/AGENTS.md:91-98`; root `AGENTS.md` mandates run-test wrapper for db tests |
| Whole workflows layer | `bun run test/scripts/run-test.ts test/workflows` | `test/workflows/AGENTS.md:96-98` |
| Single db repo/logic test | `bun run test/scripts/run-test.ts backend/db/test/repo/billing/wallet.repository.test.ts` | root `AGENTS.md` (run-test.ts mandatory for db tests); wrapper defined `test/scripts/run-test.ts:1-12` |
| Single services test | `bun run test/scripts/run-test.ts backend/services/billing/subscription-admin.service.test.ts` | same wrapper pattern |
| All db tests | `bun run test:db` → `bun --env-file=.env.test test/scripts/run-db-tests-parallel.ts` | `package.json:22` |
| db tests sequential | `bun run test:db:sequential` | `package.json:24` |
| Services tests | `bun run test:services` → `bun --env-file=.env.test test/scripts/run-services-tests-parallel.ts` | `package.json:26` |
| GraphQL tests | `bun run test:graphql` → `bun run test/scripts/run-server-tests.ts` (needs dev server lifecycle per suite) | `package.json:36` |
| Everything | `bun run test` (locked) | `package.json:20` |
| Paymob live journey | `bun run test:workflows:paymob` | `package.json:32` |

## 5. Backend services tests — location, runner, mocking pattern (EXISTING)

- 73 test files co-located with services: `backend/services/**/*.test.ts` (e.g. `backend/services/billing/subscription-admin.service.test.ts`, `backend/services/admin/user-management.service.test.ts`, `backend/services/students/__tests__/student-handshake.service.test.ts`). Runner: `test/scripts/run-services-tests-parallel.ts:1-14` — `runParallelTests({ pattern: "**/*.test.ts", cwd: "backend/services", maxWorkers: isEmbeddedDb ? 1 : 8, timeoutMs: 60_000 })` (parallel worker pools prevent Bun module-registry/mock pollution across files).
- **Mocking pattern** (`backend/services/billing/subscription-admin.service.test.ts:96-194`): framework imports from `bun:test` (`afterEach, describe, expect, spyOn, test`); `runInRollback` from `@/backend/db/test/test-utils` (`:116`); every transactional case runs `await runInRollback(async tx => ...)` passing `tx` to every service/entity-setup call (`:502`+); spies are tracked in a `trackedSpies` array and restored by file-level `afterEach` because `spyOn` reuses ONE mock per object+method pair until restored (`:166-178` — verbatim rule in comments); translated errors via `getServerTranslations("en").errorsTranslations` helper `t()` (`:159-161`); fixtures via `createTestUser/createTestPlan/createTestSubscription` (`:184-212`).
- Companion pattern in `user-management.service.test.ts`: `silenceDomainLog()` = `spyOn(logger, "logDomainError").mockImplementation(() => {})` (`:108-112`); `assertErrorCode(error, code)` asserts `DomainError` + `.code` (`:118-123`); admin actor provisioned as `createTestUser(tx, { role: "admin" })` (+ `createTestAdmin` there, `:128-131`). Header doc (`:4-22`) confirms: 4-Tier mixed suite, `expectRepoError` for all rejections, translated-message assertions, entity-setup-only fixtures.

## 6. Relevant layer rules — `backend/services/AGENTS.md` (skimmed; top rules for this scope)

- Services usable directly by SSR/Server Actions — must not rely on GraphQL-specific context unless passed explicitly (`AGENTS.md:5-6`).
- All user-facing errors via `getServerTranslations(locale, "<namespace>")` from `@/shared/locale/server-graphql`; hardcoded exception strings forbidden; `getBackendTranslations` deprecated (`:7-8`).
- Types imported from `backend/types/` (`{Entity}ReturnType`, `{Entity}SubmitInput`, `DBTransaction`); **service-layer `.types.ts` files prohibited** — runtime helpers split as `.helpers.ts`/`.constants.ts` (`:9-11`).
- GraphQL-resolved services must expose batch methods for Pothos DataLoader (`ids: string[]`) (`:12-13`).
- Domain-driven, no monolithic services; business rules/permission gating live here before repo calls (`:3-4`).

## Summary of gaps for the ticket (MISSING/CREATE — verified absent)

- No `test/workflows/students/` journey dir; no journey touching "direct student onboarding with offline payment" (grepped `ls test/workflows/{admin,billing,parents}` file lists — nothing matches onboarding + offline).
- No shared admin-subscription GraphQL documents referenced by `subscription-admin.test.ts` (`:199-201` states "The shared admin-subscription documents do not exist" — local `parse` is used); a new mutation suite for an onboarding mutation would follow the `sharedDocuments/` + codegen route or the local-parse fallback.
- `entity-setup.ts` already supports the offline-payment shape: `createTestSubscription` overrides can set `paymentMethod`/`paymentReference`/`paymentVerifiedAt` (`:222-238`), and `createTestStudentPayment` doc explicitly notes offline channels via `paymentGateway` overrides (`:259-263`) — but the ticket's flow creates NO `student_payments` row, so journeys should assert its absence (row-count-delta pattern, `test/workflows/AGENTS.md:62-64`).</subagent>
</agent_swarm_result>