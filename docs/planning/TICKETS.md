# Draft Academy — Tracer-Bullet Ticket Catalog

> **Format:** `to-tickets` tracer-bullet vertical slices
> **Source of truth:** `docs/specs/`, `backend/db/schema/`, `docs/scenarios/user-story-map.md`
> **Related:** `docs/planning/MILESTONE_PLAN.md`, `docs/planning/TEAM_ALLOCATION.md`

---

## Ticket Format

Each ticket follows the tracer-bullet format: a vertical slice cutting through every layer (schema, API, UI, tests) that is demoable on its own.

| Field | Description |
|---|---|
| **Title** | Action-oriented title |
| **Owner Stream** | Dev 1 / Dev 2 / Dev 3 / Shared |
| **Milestone** | Milestone 0, 1, 2, 3, or 4 |
| **Story Points** | Fibonacci sizing (1, 2, 3, 5, 8) |
| **Blocked By** | Ticket prerequisites |
| **Description** | Specific functional boundaries |
| **Acceptance Criteria** | Gherkin format / checklists |
| **Test Scenarios** | Boundary condition validations |

---

## Milestone 0 — Foundation Tickets

---

### Database Schema Migration

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 (Shared) |
| **Milestone** | 0 |
| **Story Points** | 5 |
| **Blocked By** | None — can start immediately |

**Description & Scope:**
Migrate the canonical schema (`backend/db/schema/`, Drizzle) to a runnable PostgreSQL migration. All 22 tables, 13 enums, and all relationships must be created. This is the foundation for all three streams.

**Acceptance Criteria:**
```gherkin
Given the Drizzle schema in backend/db/schema/
When the migration is executed
Then all 22 tables are created with correct columns and types
And all 13 enums are created with correct values
And all foreign key relationships are established
And all check constraints are enforced
And all indexes are created
And the migration is reversible (down migration exists)
And the Drizzle schema type-checks (`bun tsgo`)
```

**Test Scenarios:**
- Migration up creates all tables without errors
- Migration down drops all tables without errors
- Re-running migration (up → down → up) is idempotent
- All unique constraints enforced (users.email, students.handshake_code, wallet.teacher_id)
- All check constraints enforced (balance >= 0, score 0-100, average_rating 0-5)

**Decision Refs:** All 33 decisions (schema is the ground truth)

---

### User Registration with Role-Specific Child Table Creation

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 0 |
| **Story Points** | 5 |
| **Blocked By** | Database Schema Migration |

**Description & Scope:**
Implement user registration endpoint that creates a `users` record and the corresponding role-specific child table record (admin, teacher, students, parents, applicants) via shared PK inheritance. Include governance fields on `users` table (is_deleted, suspended, is_blocked, last_active_at).

**Acceptance Criteria:**
```gherkin
Given a new user wants to register
When they submit registration with name, email, phone, password, gender, country, and role
Then a users record is created with the specified role
And the corresponding child table record is created with shared PK
And governance fields are initialized (is_deleted=false, suspended=false, is_blocked=false)
And last_active_at is set to current timestamp
And email uniqueness is enforced
And password is hashed (not stored in plaintext)

Given a user registers as role=student
When registration completes
Then a students record is created with balance_hifz=0, balance_reviews=0, balance_tajweed=0
And a unique handshake_code is generated

Given a user registers as role=teacher
When registration completes
Then an applicants record is created (not teacher — teacher record only after verification)
And applicants.status = 'pending'

Given a user registers as role=parent
When registration completes
Then a parents record is created
```

**Test Scenarios:**
- Register with each role (admin, teacher, student, parent) — child table created
- Register with duplicate email — rejected with 409
- Register with missing required fields — rejected with 422
- Teacher registration creates applicants record, NOT teacher record (B.6/B.7)
- Student registration generates unique handshake_code (A.3)
- Password is hashed

**Decision Refs:** A.1 (parents table), A.7 (governance on users), B.6 (applicants table), B.7 (teacher after verification), C.1 (parent role)

---

### Recitation Selection on Registration

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 0 |
| **Story Points** | 2 |
| **Blocked By** | User Registration with Role-Specific Child Table Creation |

**Description & Scope:**
Allow users to select their recitation reading (Qira'ah) during or after registration. The recitation is stored in the `recitation` table linked to the user. This is used by the matching algorithm (Dev 3) to filter teachers.

**Acceptance Criteria:**
```gherkin
Given a registered user
When they select their recitation reading (Qira'ah)
Then a recitation record is created linked to their user_id
And the recitation name is stored

Given a user with an existing recitation
When they add another recitation reading
Then a second recitation record is created (1:M relationship)
```

**Test Scenarios:**
- User can select recitation during registration
- User can add multiple recitation readings
- Recitation records are linked to user via session_id (C.5: 1:1 per session)

**Decision Refs:** C.5 (recitation 1:1 session — recitation table repurposed)

---

### Free Trial Session Provisioning

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 0 |
| **Story Points** | 3 |
| **Blocked By** | User Registration with Role-Specific Child Table Creation |

**Description & Scope:**
Credit new students with a free trial session upon registration. The trial session is credited to the appropriate balance field.

**Acceptance Criteria:**
```gherkin
Given a new student completes registration
When the student record is created
Then a free trial session is credited to their balance
And the trial session is tracked (can be in balance_hifz or a dedicated trial field)

Given a student with a free trial session
When they book their first session
Then the trial session balance is decremented
```

**Test Scenarios:**
- New student receives free trial session on registration
- Trial session is decremented on first session booking
- Student without trial cannot book without a subscription

---

### JWT Authentication Service

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 (Shared) |
| **Milestone** | 0 |
| **Story Points** | 5 |
| **Blocked By** | Database Schema Migration |

**Description & Scope:**
Implement JWT-based authentication: login endpoint, token issuance, token verification, and token refresh. Tokens include user role for RBAC.

**Acceptance Criteria:**
```gherkin
Given a registered user with correct credentials
When they submit login with email and password
Then a JWT token is issued containing user_id, role, and expiration
And the token is valid for the configured duration

Given a valid JWT token
When a request includes the token in the Authorization header
Then the token is verified and the user is authenticated

Given an expired JWT token
When a request includes the expired token
Then the request is rejected with 401

Given an invalid JWT token
When a request includes an invalid token
Then the request is rejected with 401
```

**Test Scenarios:**
- Login with correct credentials returns valid JWT
- Login with incorrect password returns 401
- Login with non-existent email returns 401
- Expired token is rejected
- Tampered token is rejected
- Token refresh works for valid tokens

---

### Role-Based Authorization Middleware

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 (Shared) |
| **Milestone** | 0 |
| **Story Points** | 3 |
| **Blocked By** | JWT Authentication Service |

**Description & Scope:**
Implement RBAC middleware that enforces role-based access control on all endpoints. Middleware checks the user's role from the JWT token and allows/denies access based on required role.

**Acceptance Criteria:**
```gherkin
Given a request with a valid JWT token
When the user's role matches the required role for the endpoint
Then the request is allowed through

Given a request with a valid JWT token
When the user's role does NOT match the required role
Then the request is rejected with 403

Given a request without a JWT token
When accessing a protected endpoint
Then the request is rejected with 401

Given an admin user
When accessing admin-only endpoints
Then access is granted

Given a student user
When accessing admin-only endpoints
Then access is denied with 403

Given a soft-deleted user (is_deleted=true)
When attempting to access any endpoint
Then access is denied with 403
```

**Test Scenarios:**
- Admin can access admin endpoints
- Teacher cannot access admin endpoints
- Student cannot access teacher endpoints
- Parent can access parent-only endpoints
- Soft-deleted user is denied access
- Blocked user is denied access
- Suspended user is denied access to session creation

**Decision Refs:** A.7 (governance fields on users), C.1 (parent role)

---

### Shared Types & Interface Contracts

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 (Shared) |
| **Milestone** | 0 |
| **Story Points** | 3 |
| **Blocked By** | Database Schema Migration |

**Description & Scope:**
Define shared TypeScript types, interfaces, and cross-stream contracts that all three streams code against. This includes user types, session types, notification types, and the interface contracts defined in TEAM_ALLOCATION.md.

**Acceptance Criteria:**
```gherkin
Given the shared types module
When any stream imports types
Then all cross-stream data structures are typed
And the interface contracts from TEAM_ALLOCATION.md are encoded as TypeScript interfaces
And the types are validated at compile time
```

**Test Scenarios:**
- All shared types compile without errors
- Cross-stream contracts match the documented interfaces
- Type changes require PR review from all streams

---

### CI/CD Pipeline with Mermaid Validation

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 (Shared) |
| **Milestone** | 0 |
| **Story Points** | 5 |
| **Blocked By** | None — can start immediately |

**Description & Scope:**
Set up CI/CD pipeline that runs on every PR: lint, test, and Mermaid validation (`bun run scripts/validate-mermaid.ts`). Pipeline must be green before merge.

**Acceptance Criteria:**
```gherkin
Given a pull request is opened
When CI/CD pipeline runs
Then linting is executed and must pass
And unit tests are executed and must pass
And `bun run scripts/validate-mermaid.ts` is executed on changed .mmd/.md files
And the PR cannot be merged if any check fails
```

**Test Scenarios:**
- PR with valid code and schema — all checks pass
- PR with invalid Mermaid — Mermaid check fails, merge blocked
- PR with failing tests — test check fails, merge blocked

---

### Shared Error Handling & Response Contracts

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 (Shared) |
| **Milestone** | 0 |
| **Story Points** | 3 |
| **Blocked By** | None — can start immediately |

**Description & Scope:**
Implement shared error handling middleware and standardized API response format. All streams use the same error codes and response structure.

**Acceptance Criteria:**
```gherkin
Given any API endpoint
When an error occurs
Then the response follows the standardized error format with code, message, and details
And HTTP status codes are consistent (200, 201, 400, 401, 403, 404, 409, 422, 500)
And validation errors include field-level details
```

**Test Scenarios:**
- 200 OK for successful GET
- 201 Created for successful POST
- 400 Bad Request for malformed input
- 401 Unauthorized for missing/invalid auth
- 403 Forbidden for insufficient role
- 404 Not Found for missing resources
- 409 Conflict for duplicate resources
- 422 Unprocessable Entity for validation failures
- 500 Internal Server Error for unexpected failures

---

### API Gateway & Routing Skeleton

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 (Shared) |
| **Milestone** | 0 |
| **Story Points** | 3 |
| **Blocked By** | Shared Error Handling & Response Contracts |

**Description & Scope:**
Set up the API gateway and routing skeleton that all streams will use. Include health check endpoints, route registration, and middleware chain (auth → RBAC → handler).

**Acceptance Criteria:**
```gherkin
Given the API gateway is running
When a health check request is sent
Then a 200 OK response is returned with status information

Given a route is registered by any stream
When a request matches the route
Then the middleware chain is executed (auth → RBAC → handler)
And the response is returned in standardized format
```

**Test Scenarios:**
- Health check returns 200
- Unknown route returns 404
- Middleware chain executes in correct order
- Route registration works for all streams

---

## Milestone 1 — Core Domain MVP Tickets

---

### Plan Catalog CRUD (Admin Only)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 1 |
| **Story Points** | 3 |
| **Blocked By** | User Registration with Role-Specific Child Table Creation |

**Description & Scope:**
Implement admin-only CRUD for the plan catalog. Admin can create, edit, activate, and deactivate all subscription plan types (Hifz Jadid, Muraja'ah, Tathbeet, Atfal, Mukathaf, Tajweed, Teacher Verification).

**Acceptance Criteria:**
```gherkin
Given an authenticated admin
When they create a plan with title, session_count, price, currency, interval_days
Then the plan is created in the plans table
And session_count > 0 is enforced
And price >= 0 is enforced
And interval_days > 0 is enforced

Given an existing plan
When the admin edits the plan
Then the plan is updated

Given an existing plan
When the admin deactivates a plan
Then the plan is no longer visible to students for purchase
But existing subscriptions to the plan remain active

Given a non-admin user
When they attempt to access plan CRUD endpoints
Then access is denied with 403
```

**Test Scenarios:**
- Admin creates plan with valid data — 201 Created
- Admin creates plan with session_count=0 — 422 Validation error
- Admin creates plan with price=-1 — 422 Validation error
- Non-admin attempts plan CRUD — 403 Forbidden
- Deactivated plan not shown to students
- Existing subscriptions remain active after deactivation

**Decision Refs:** FR-2.1, FR-2.2, FR-2.3

---

### Subscription Purchase via Payment Gateway

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 1 |
| **Story Points** | 5 |
| **Blocked By** | Plan Catalog CRUD (Admin Only) |

**Description & Scope:**
Implement subscription purchase flow: student selects a plan, pays via payment gateway, subscription is created with status=pending, payment is recorded, and upon payment confirmation, subscription status changes to active and session balance is credited.

**Acceptance Criteria:**
```gherkin
Given an authenticated student
When they purchase a plan via payment gateway
Then a student_payments record is created with status=pending
And a subscriptions record is created with status=pending
And the payment gateway processes the payment

Given a payment is confirmed by the gateway
When the webhook/callback is received
Then student_payments.status changes to paid
And subscriptions.status changes to active
And subscriptions.start_date and end_date are set based on interval_days
And the full session_count is credited to the respective balance

Given a payment fails
When the webhook/callback is received
Then student_payments.status changes to failed
And subscriptions.status remains pending

Given a student with an active subscription
When they attempt to purchase the same plan again
Then a new subscription period is created (renewal)
```

**Test Scenarios:**
- Student purchases plan — payment pending → paid → subscription active
- Payment fails — subscription stays pending
- Subscription activation credits correct balance (Hifz → balance_hifz, Tajweed → balance_tajweed)
- Subscription start_date and end_date set correctly
- Duplicate purchase creates renewal subscription

**Decision Refs:** A.9 (subscription status), B.8/C.2 (user_id generic), FR-2.4, FR-2.5

---

### Segregated Session Balance Crediting

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 1 |
| **Story Points** | 5 |
| **Blocked By** | Subscription Purchase via Payment Gateway |

**Description & Scope:**
Implement segregated session balance crediting logic. When a subscription is activated, the full session_count is credited to the respective balance (balance_hifz, balance_tajweed, or balance_reviews) based on the plan type. Balances are non-negative integers.

**Acceptance Criteria:**
```gherkin
Given a student purchases a Hifz plan with session_count=8
When the subscription is activated
Then students.balance_hifz is incremented by 8
And students.balance_tajweed and balance_reviews are unchanged

Given a student purchases a Tajweed plan with session_count=12
When the subscription is activated
Then students.balance_tajweed is incremented by 12

Given a student with balance_hifz=4
When they attend a Hifz session (dual confirmation)
Then balance_hifz is decremented by 1 to 3

Given a student with balance_hifz=0
When they attempt to request a Hifz session
Then the request is rejected with 422 "Insufficient balance"
```

**Test Scenarios:**
- Hifz plan credits balance_hifz only
- Tajweed plan credits balance_tajweed only
- Review plan credits balance_reviews only
- Balance decrement on session completion
- Insufficient balance prevents session request
- Balance cannot go negative (check constraint)

**Decision Refs:** FR-2.5, INV-B1, INV-B2, INV-B4, INV-B5

---

### Subscription Validity Window & Expiry

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 1 |
| **Story Points** | 3 |
| **Blocked By** | Segregated Session Balance Crediting |

**Description & Scope:**
Implement subscription validity window: set start_date and end_date based on interval_days. Unused sessions expire at the end of the interval with no carryover. A background job checks for expired subscriptions and sets status=expired.

**Acceptance Criteria:**
```gherkin
Given a subscription is activated with interval_days=30
When the subscription start_date is set
Then end_date = start_date + 30 days

Given a subscription past its end_date
When the expiry job runs
Then subscriptions.status is set to expired
And any remaining session balance for that subscription period is zeroed

Given a student with an expired subscription
When they attempt to request a session
Then the request is rejected with 422 "Subscription expired"

Given a subscription within its validity window
When the student checks their balance
Then the balance reflects sessions remaining in the current period
```

**Test Scenarios:**
- Subscription end_date = start_date + interval_days
- Expired subscription → status=expired, balance zeroed
- Active subscription → balance available
- No carryover of unused sessions to next period
- Expiry job correctly identifies and expires subscriptions

**Decision Refs:** FR-2.4, INV-B3, INV-B6

---

### Admin Subscription Management (Extend/Renew/Cancel/Upgrade/Downgrade)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 1 |
| **Story Points** | 5 |
| **Blocked By** | Subscription Validity Window & Expiry |

**Description & Scope:**
Implement admin subscription management: extend validity window, renew subscription, cancel subscription, and upgrade/downgrade with prorated balance handling.

**Acceptance Criteria:**
```gherkin
Given an admin and an active subscription
When the admin extends the validity window
Then subscriptions.end_date is extended
And the action is logged in audit_logs

Given an admin and an expired subscription
When the admin renews the subscription
Then a new subscription period is created with fresh session credits

Given an admin and an active subscription
When the admin cancels the subscription
Then subscriptions.status is set to cancelled
And remaining balance is preserved (not zeroed)

Given a student with an active subscription (Hifz, 4 sessions remaining)
When the admin upgrades the plan to a larger Hifz plan
Then the remaining 4 sessions are prorated (value credited toward new plan)
And a new subscription is created with the new plan's session_count
And the validity window resets to the new plan's interval_days

Given a student with an active subscription (Hifz, 8 sessions remaining)
When the admin downgrades to a smaller Hifz plan
Then the remaining 8 sessions are prorated (excess value forfeited)
And a new subscription is created with the new plan's session_count
```

**Test Scenarios:**
- Admin extends subscription — end_date updated, audit logged
- Admin renews expired subscription — new period created
- Admin cancels subscription — status=cancelled, balance preserved
- Admin upgrades plan — prorated balance, new interval
- Admin downgrades plan — prorated balance, new interval
- Non-admin attempts subscription management — 403

**Decision Refs:** B.17 (prorated plan changes), FR-2.7, A.5 (audit logging)

---

### Teacher Applicant Registration & Applicants Table

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 1 |
| **Story Points** | 3 |
| **Blocked By** | Role-Based Authorization Middleware |

**Description & Scope:**
Implement teacher applicant registration flow. When a user registers as role=teacher, an applicants record is created (NOT a teacher record). The applicants table tracks verification_attempts, last_attempt_at, cooldown_until, and status.

**Acceptance Criteria:**
```gherkin
Given a new user registers as role=teacher
When registration completes
Then an applicants record is created with status='pending'
And verification_attempts=0
And cooldown_until is null
And NO teacher record is created (teacher record only after passing verification)

Given an applicant with status='pending'
When they view their profile
Then they see their applicant status, not teacher status

Given an applicant who failed evaluation
When their cooldown expires
Then they can re-purchase the verification plan
And verification_attempts is incremented
And last_attempt_at is updated
```

**Test Scenarios:**
- New teacher registration creates applicants record, not teacher record
- Applicants status starts as 'pending'
- Failed applicant has cooldown_until set
- Re-application after cooldown increments verification_attempts
- Teacher record is NOT created until verification passes

**Decision Refs:** B.6 (applicants table), B.7 (teacher record after verification), FR-3.1

---

### Verification Plan Purchase (5 Sessions)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 1 |
| **Story Points** | 3 |
| **Blocked By** | Teacher Applicant Registration & Applicants Table, Subscription Purchase via Payment Gateway |

**Description & Scope:**
Implement verification plan purchase for teacher applicants. The verification plan is a specialized plan with session_count=5. Upon purchase, 5 evaluation session credits are available. Uses the same subscription/payment infrastructure as student plans (subscriptions.user_id is generic).

**Acceptance Criteria:**
```gherkin
Given a teacher applicant with status='pending'
When they purchase the "New Teacher Verification & Evaluation Plan"
Then a subscriptions record is created with user_id = applicant's user_id
And the subscription is linked to the verification plan (session_count=5)
And payment is processed via student_payments
And applicants.status changes to 'in_evaluation'

Given an applicant in cooldown
When they attempt to purchase the verification plan
Then the purchase is rejected with 422 "Cooldown active until {cooldown_until}"

Given an applicant's cooldown has expired
When they purchase the verification plan
Then the purchase is allowed
And verification_attempts is incremented
```

**Test Scenarios:**
- Applicant purchases verification plan — subscription created, status=in_evaluation
- Applicant in cooldown — purchase rejected
- Applicant after cooldown — purchase allowed, attempts incremented
- Verification plan has exactly 5 sessions

**Decision Refs:** B.8/C.2 (user_id generic), FR-3.2, FR-3.3

---

### 5-Session Evaluation Loop Booking

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 1 |
| **Story Points** | 5 |
| **Blocked By** | Verification Plan Purchase (5 Sessions) |

**Description & Scope:**
Implement the 5-session evaluation loop. The applicant must book 5 evaluation sessions with 5 distinct certified Shuyukh. Each session has session_type=teacher_evaluation and intent=evaluation. The system enforces that no evaluator evaluates the same applicant twice.

**Acceptance Criteria:**
```gherkin
Given an applicant with an active verification subscription
When they book an evaluation session
Then a session record is created with session_type='teacher_evaluation'
And session.intent = 'evaluation'
And the evaluator (teacher) must have is_approved=true AND is_evaluator=true

Given an applicant who has completed 3 evaluation sessions with 3 distinct evaluators
When they book the 4th session
Then the system prevents booking with any of the 3 previous evaluators
And only shows available certified evaluators not yet used

Given an applicant who has completed 5 evaluation sessions
When they attempt to book a 6th evaluation session
Then the request is rejected with 422 "Evaluation loop complete"

Given an applicant with 0 remaining evaluation credits
When they attempt to book an evaluation session
Then the request is rejected with 422 "No evaluation sessions remaining"
```

**Test Scenarios:**
- Book evaluation session with certified evaluator — session created
- Attempt to book with same evaluator twice — rejected
- 5th session completes the loop — 6th rejected
- No remaining credits — booking rejected
- Evaluator must be is_approved=true AND is_evaluator=true

**Decision Refs:** A.8 (session_type), A.10 (session_intent), INV-TV2 (5 distinct evaluators), FR-3.3

---

### Evaluation Rubric Scoring (≥80% Threshold)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 1 |
| **Story Points** | 5 |
| **Blocked By** | 5-Session Evaluation Loop Booking |

**Description & Scope:**
Implement evaluation rubric scoring. Each evaluator submits an evaluation with score (0-100), notes, and pass/fail. The system aggregates 5 evaluation results and applies the ≥80% pass threshold. If the applicant meets the threshold, teacher.is_approved is set to true and a teacher record is created.

**Acceptance Criteria:**
```gherkin
Given an evaluator completing an evaluation session
When they submit the evaluation
Then an evaluations record is created with evaluated_id=applicant, evaluator_id=sheikh
And evaluations.score is 0-100 (check constraint)
And evaluations.notes contains qualitative observations

Given 5 evaluation sessions are complete
When the system aggregates results
Then if the applicant scored >= 80 on all 5 evaluations, they PASS
And if the applicant scored < 80 on any evaluation, they FAIL
And the primary failure area (Tajweed or Hifz) is identified

Given an applicant who passed (all 5 >= 80)
When the aggregation completes
Then a teacher record is created (shared PK with users)
And teacher.is_approved = true
And applicants.status = 'passed'
And the applicant gains full teaching permissions

Given an applicant who failed
When the aggregation completes
Then applicants.status = 'failed'
And the applicant enters cooldown (1-month Tajweed or 3-month Hifz)
And a students record is created for the failed applicant
```

**Test Scenarios:**
- All 5 scores >= 80 — pass, teacher record created
- One score < 80 — fail, cooldown assigned
- Score of exactly 80 — pass (boundary)
- Score of 79 — fail (boundary)
- Primary failure is Tajweed — 1-month cooldown
- Primary failure is Hifz — 3-month cooldown
- Failed applicant gets students record
- Evaluations record has evaluated_id and evaluator_id (C.3)

**Decision Refs:** B.1 (80% threshold), B.7 (teacher record after verification), C.3 (evaluated_id/evaluator_id), INV-E1, FR-3.5, FR-3.6

---

### Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 1 |
| **Story Points** | 5 |
| **Blocked By** | Evaluation Rubric Scoring (≥80% Threshold) |

**Description & Scope:**
Implement the cooldown state machine. Failed applicants are assigned a cooldown period: 1 month (30 days) for Tajweed weakness, 3 months (90 days) for Hifz weakness. During cooldown, the applicant is suspended and cannot re-purchase the verification plan. After cooldown, they can re-apply.

**Acceptance Criteria:**
```gherkin
Given an applicant who failed with major Tajweed weakness
When the failure is recorded
Then users.suspended = true
And users.suspended_at = current timestamp
And users.suspended_period_days = 30
And applicants.cooldown_until = now + 30 days
And applicants.status = 'failed'

Given an applicant who failed with major Hifz weakness
When the failure is recorded
Then users.suspended_period_days = 90
And applicants.cooldown_until = now + 90 days

Given an applicant in cooldown
When they attempt to purchase the verification plan
Then the purchase is rejected with 422 "Cooldown active"

Given an applicant whose cooldown has expired
When they check their status
Then users.suspended = false (reactivated)
And they can re-purchase the verification plan

Given a failed applicant
When they are converted to a student
Then a students record is created
And they can subscribe to plans and attend sessions during cooldown
```

**Test Scenarios:**
- Tajweed failure — 30-day cooldown
- Hifz failure — 90-day cooldown
- Cooldown active — verification plan purchase rejected
- Cooldown expired — re-application allowed
- Failed applicant can attend sessions as student during cooldown
- Cooldown period is a minimum (can be extended by admin)

**Decision Refs:** FR-3.7, INV-TV3, INV-TV4, INV-TV6, INV-U2

---

### Failed Applicant → Student Record Conversion

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 1 |
| **Story Points** | 3 |
| **Blocked By** | Cooldown State Machine (1-Month Tajweed / 3-Month Hifz) |

**Description & Scope:**
When an applicant fails evaluation, create a students record for them so they can subscribe to plans and attend sessions during their cooldown period. The applicant retains their applicants record for re-evaluation tracking.

**Acceptance Criteria:**
```gherkin
Given an applicant who failed evaluation
When the failure is recorded
Then a students record is created (shared PK with users)
And students.balance_hifz = 0, balance_tajweed = 0, balance_reviews = 0
And a unique handshake_code is generated for the student record
And the applicants record is preserved (not deleted)

Given a failed applicant with a students record
When they subscribe to a plan during cooldown
Then the subscription works normally
And they can attend sessions

Given a failed applicant who later passes re-evaluation
When they are certified
Then their teacher record is created
And their students record is preserved (historical data)
```

**Test Scenarios:**
- Failed applicant gets students record
- Students record has zeroed balances
- Handshake code generated for student record
- Applicants record preserved
- Failed applicant can subscribe and attend sessions
- Re-certified applicant has both teacher and student records

**Decision Refs:** B.6 (applicants table), B.7 (teacher record after verification), INV-TV6, FR-3.6

---

### Admin Override of Evaluation Results

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 1 |
| **Story Points** | 3 |
| **Blocked By** | Cooldown State Machine (1-Month Tajweed / 3-Month Hifz) |

**Description & Scope:**
Implement admin override capability for evaluation results. The admin can inspect all 5 session reports and evaluation notes, and manually certify, reject, or grant re-evaluation to an applicant. The override supersedes the automated algorithm and is logged in audit_logs.

**Acceptance Criteria:**
```gherkin
Given an admin and an applicant's evaluation results
When the admin inspects the 5 session reports and evaluations
Then all reports and evaluations are visible to the admin

Given an admin and an applicant who failed automated evaluation
When the admin manually certifies the applicant
Then teacher.is_approved = true
And a teacher record is created
And the action is logged in audit_logs with action_type='override'

Given an admin and an applicant who passed automated evaluation
When the admin manually rejects the applicant
Then the applicant enters cooldown
And the action is logged in audit_logs

Given an admin and an applicant
When the admin grants re-evaluation
Then the applicant can re-purchase the verification plan without waiting for cooldown
And the action is logged in audit_logs
```

**Test Scenarios:**
- Admin certifies failed applicant — teacher record created, audit logged
- Admin rejects passed applicant — cooldown assigned, audit logged
- Admin grants re-evaluation — cooldown bypassed, audit logged
- Non-admin attempts override — 403 Forbidden
- All override actions are in audit_logs

**Decision Refs:** FR-3.8, INV-TV5, A.5 (audit_logs)

---

### Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 1 |
| **Story Points** | 5 |
| **Blocked By** | Database Schema Migration, Role-Based Authorization Middleware |

**Description & Scope:**
Implement the session lifecycle: creation (scheduled), start (started), completion (completed), and cancellation (cancelled). Enforce state machine invariants. Session must have both teacher_id and student_id (NOT NULL). Teacher must be certified (is_approved=true).

**Acceptance Criteria:**
```gherkin
Given a student requests a session with a certified teacher
When the teacher accepts
Then a session record is created with status='scheduled'
And session.teacher_id and session.student_id are NOT NULL
And session.session_type = 'student_session' (default)
And session.fee is set by the platform (B.3)
And session.fee_held = true (B.4: escrow hold at request)
And session.confirmation_deadline = now + 24h (B.2)

Given a scheduled session
When the session begins
Then session.status changes to 'started'
And session.started_at is set

Given a started session
When the teacher marks it complete and submits a report
Then session.status changes to 'completed'
And session.ended_at is set

Given a scheduled or started session
When the session is cancelled
Then session.status changes to 'cancelled'
And if fee_held=true, the held funds are released back to the student's balance

Given a completed session
When any attempt is made to transition back to started or scheduled
Then the transition is rejected (INV-S1)

Given a cancelled session
When any attempt is made to transition to any other state
Then the transition is rejected (INV-S2)
```

**Test Scenarios:**
- Session created with correct defaults (scheduled, fee_held=true, confirmation_deadline set)
- Session transitions: scheduled → started → completed
- Session transitions: scheduled → cancelled (funds released)
- Session transitions: started → cancelled (funds released)
- Completed → started: rejected (INV-S1)
- Cancelled → any: rejected (INV-S2)
- Session without teacher_id or student_id: rejected (INV-S4)
- Teacher not certified: rejected (INV-S5)

**Decision Refs:** B.2 (24h timeout), B.3 (platform-set fees), B.4 (escrow), A.8 (session_type), INV-S1 through INV-S7, FR-5.1

---

### Session Status State Machine Enforcement

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 1 |
| **Story Points** | 3 |
| **Blocked By** | Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled) |

**Description & Scope:**
Implement and enforce all session state machine invariants from `docs/specs/state-machine-invariants.md`. This includes transition validation, in-session locking, and report/homework timing constraints.

**Acceptance Criteria:**
```gherkin
Given a session in 'started' state
When the teacher's is_online is checked
Then teacher.is_online must be false (INV-S6: in-session lock)

Given a session not in 'completed' state
When an attempt is made to submit a session report
Then the submission is rejected (INV-S7)

Given a session report is submitted
When homework is created
Then homework can only be created when the session report is submitted (INV-S8)

Given a session in 'disputed' state (B.18)
When the dispute is resolved by admin
Then the session transitions to 'completed' (refund/partial refund) or stays 'completed' (uphold)
```

**Test Scenarios:**
- In-session teacher has is_online=false (INV-S6)
- Report submission before completion — rejected (INV-S7)
- Homework creation without report — rejected (INV-S8)
- Disputed session — admin can resolve
- All state transitions validated against allowed transitions

**Decision Refs:** B.18 (disputed status), INV-S1 through INV-S8

---

### Session Report & Homework Infrastructure

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 1 |
| **Story Points** | 5 |
| **Blocked By** | Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled) |

**Description & Scope:**
Implement the session report and homework infrastructure. Reports table (session_id, teacher_notes, student_rating_by_teacher) and home_work table (session_id, current/revision fields with grades and Surah/Juz). Reports.teacher_id is removed (access via session.teacher_id — C.4).

**Acceptance Criteria:**
```gherkin
Given a completed session
When the teacher submits a report
Then a reports record is created with session_id
And reports.teacher_id is NOT a column (C.4: removed, access via session)
And reports.teacher_notes contains performance notes
And reports.student_rating_by_teacher is 0-5 (check constraint)

Given a submitted session report
When homework is assigned
Then a home_work record is created with session_id
And home_work.current_from_ayah, current_to_ayah, current_grade are set (Jadid)
And home_work.revision_from_ayah, revision_to_ayah, revision_grade are set (Madi)
And home_work.current_surah_juz and revision_surah_juz use surah_juz_ref enum (B.11)
And grades are 0-100 (check constraints)
```

**Test Scenarios:**
- Report created for completed session — success
- Report created for non-completed session — rejected
- Homework created with Surah/Juz enum — success
- Grades outside 0-100 — rejected
- student_rating_by_teacher outside 0-5 — rejected
- Report has no teacher_id column (C.4)

**Decision Refs:** B.11 (Surah/Juz enum), C.4 (reports.teacher_id removed), INV-S7, INV-S8, INV-HW1, INV-HW2

---

### Recitation Record per Session (1:1)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 1 |
| **Story Points** | 2 |
| **Blocked By** | Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled) |

**Description & Scope:**
Implement the recitation record for sessions. The recitation table has a 1:1 relationship with sessions (session_id is unique). Each session has exactly one recitation record. The recitation.user_id column was renamed to session_id (C.5).

**Acceptance Criteria:**
```gherkin
Given a session is created
When a recitation record is created
Then recitation.session_id = session.id
And recitation.session_id is unique (one per session)
And recitation.name and description are stored

Given a session with an existing recitation record
When an attempt is made to create a second recitation record
Then the attempt is rejected (unique constraint)
```

**Test Scenarios:**
- Recitation created for session — success
- Second recitation for same session — rejected (unique)
- Recitation has session_id (not user_id — C.5)

**Decision Refs:** C.5 (recitation 1:1 session)

---

## Milestone 2 — Matching, Notifications & Escrow Tickets

---

### Tajweed Curriculum Lessons CRUD

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 2 |
| **Story Points** | 3 |
| **Blocked By** | Subscription Validity Window & Expiry |

**Description & Scope:**
Implement CRUD for Tajweed curriculum lessons. Lessons belong to plans (lessons.plan_id). Admin can create, edit, and delete lessons. Lessons are used for student progress tracking.

**Acceptance Criteria:**
```gherkin
Given an admin
When they create a lesson with plan_id and title
Then a lessons record is created
And the lesson is linked to the specified plan

Given a Tajweed plan
When lessons are created for the plan
Then the lessons form the curriculum sequence
And students subscribing to the plan get progress tracking for these lessons
```

**Test Scenarios:**
- Admin creates lesson — success
- Lesson linked to plan — success
- Non-admin attempts lesson CRUD — 403
- Lesson with non-existent plan_id — 422

**Decision Refs:** FR-6.1, INV-PR3

---

### Student Progress Tracking & Increment

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 2 |
| **Story Points** | 5 |
| **Blocked By** | Tajweed Curriculum Lessons CRUD |

**Description & Scope:**
Implement student progress tracking. Progress records link students to lessons (progress.student_id, progress.lesson_id). Upon successful completion of a Tajweed session, the student's progress is updated and incremented to the next lesson.

**Acceptance Criteria:**
```gherkin
Given a student subscribed to a Tajweed plan
When they complete a Tajweed session successfully
Then their progress record is updated
And progress.lesson_id is incremented to the next lesson in the curriculum

Given a student's current progress
When a teacher views the student's progress before a session
Then the current lesson and completion percentage are displayed

Given a student who has completed all lessons in a plan
When they complete another Tajweed session
Then progress remains at the last lesson (curriculum complete)
```

**Test Scenarios:**
- Progress incremented on session completion
- Progress linked to correct student and lesson
- Teacher can view student progress
- Curriculum completion — progress stays at last lesson

**Decision Refs:** FR-6.2, FR-6.3, INV-PR1, INV-PR2

---

### Teacher Preparation View (Student Progress Before Session)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 2 |
| **Story Points** | 3 |
| **Blocked By** | Student Progress Tracking & Increment |

**Description & Scope:**
When a student requests a Tajweed session, the teacher can review the student's current lesson progress before accepting the request. This ensures the teacher is prepared with the appropriate lesson material.

**Acceptance Criteria:**
```gherkin
Given a teacher receives a Tajweed session request
When they view the request details
Then the student's current lesson progress is displayed
And the teacher can see which lesson the student is on
And the teacher can see previous homework assignments

Given a teacher views a student's progress
When the student has no prior progress
Then the teacher sees "First session — diagnostic"
```

**Test Scenarios:**
- Teacher sees student progress on session request
- Student with no prior progress — "First session" indicator
- Student with progress — current lesson displayed
- Progress view is read-only for teachers

**Decision Refs:** FR-6.2

---

### Teacher Availability Toggle (Available/Unavailable)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 2 |
| **Story Points** | 3 |
| **Blocked By** | Cooldown State Machine (1-Month Tajweed / 3-Month Hifz) |

**Description & Scope:**
Implement teacher availability toggle. Certified teachers (is_approved=true) can manually toggle their status between Available (is_online=true) and Unavailable (is_online=false). Only certified teachers can set Available.

**Acceptance Criteria:**
```gherkin
Given a certified teacher (is_approved=true)
When they toggle their status to Available
Then teacher.is_online = true
And they appear in the Available Teachers directory

Given a certified teacher
When they toggle their status to Unavailable
Then teacher.is_online = false
And they are hidden from the Available Teachers directory

Given a non-certified teacher (is_approved=false)
When they attempt to toggle Available
Then the request is rejected with 403 "Not certified"

Given a teacher in an active session
When the session is in 'started' state
Then teacher.is_online must be false (INV-A2: in-session lock)
And the teacher cannot toggle to Available during the session
```

**Test Scenarios:**
- Certified teacher toggles Available — is_online=true
- Certified teacher toggles Unavailable — is_online=false
- Non-certified teacher attempts toggle — 403
- Teacher in session — is_online=false, cannot toggle
- Only is_approved=true teachers can set Available (INV-A1)

**Decision Refs:** INV-A1, INV-A2, FR-4.1, FR-4.3

---

### 15-Minute Inactivity Auto-Offline

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 2 |
| **Story Points** | 5 |
| **Blocked By** | Teacher Availability Toggle (Available/Unavailable) |

**Description & Scope:**
Implement 15-minute inactivity timeout. Teachers are marked unavailable (is_online=false) after 15 minutes of inactivity (no WebSocket heartbeat or API call). The users.last_active_at field tracks the last activity timestamp.

**Acceptance Criteria:**
```gherkin
Given a teacher with is_online=true
When 15 minutes pass without any WebSocket heartbeat or API call
Then teacher.is_online is set to false
And users.last_active_at is updated on each activity

Given a teacher who was auto-set to offline
When they resume activity (open app, send API request)
Then users.last_active_at is updated
And teacher.is_online can be toggled back to true by the teacher

Given a teacher in an active session
When the inactivity check runs
Then the teacher is NOT auto-set to offline (in-session lock takes priority)
```

**Test Scenarios:**
- Teacher active — last_active_at updated
- Teacher inactive for 15 min — is_online set to false
- Teacher inactive for 14 min — is_online stays true
- Teacher resumes activity — can toggle Available again
- Teacher in session — not auto-offlined (in-session lock priority)

**Decision Refs:** B.15 (15-min inactivity), A.7 (last_active_at on users), FR-4.2

---

### In-Session Locking (Hide from Directory)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 2 |
| **Story Points** | 3 |
| **Blocked By** | Teacher Availability Toggle (Available/Unavailable) |

**Description & Scope:**
When a teacher accepts a session request, their status automatically becomes Unavailable and they are hidden from the Available Teachers directory until the session concludes.

**Acceptance Criteria:**
```gherkin
Given a teacher with is_online=true
When they accept a session request
Then teacher.is_online is set to false
And the teacher is hidden from the Available Teachers directory for all other students

Given a teacher in an active session
When another student browses the directory
Then the teacher does not appear in the results

Given a teacher whose session has concluded
When the session reaches 'completed' or 'cancelled' state
Then the teacher's status returns to Available only if they are still active (app open)
```

**Test Scenarios:**
- Teacher accepts session — is_online=false, hidden from directory
- Other students browse — in-session teacher not shown
- Session concludes — teacher returns to Available if still active
- Session concludes — teacher stays Unavailable if app closed

**Decision Refs:** INV-A2, INV-A3, INV-A4, FR-4.3

---

### Session Report Submission with Homework (Jadid & Madi)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 2 |
| **Story Points** | 5 |
| **Blocked By** | Session Report & Homework Infrastructure |

**Description & Scope:**
Implement the teacher's session report submission flow. At the end of every completed session, the teacher submits a report with performance notes, homework assignments (Jadid: new memorization, Madi: review), and a numerical grade. The first session is diagnostic (no prior homework to evaluate).

**Acceptance Criteria:**
```gherkin
Given a teacher completing a session
When they submit the session report
Then a reports record is created with teacher_notes and student_rating_by_teacher
And a home_work record is created with:
  | current_from_ayah | current_to_ayah | current_grade | current_surah_juz | (Jadid)
  | revision_from_ayah | revision_to_ayah | revision_grade | revision_surah_juz | (Madi)

Given the first session with a student
When the teacher submits the report
Then homework is assigned (not graded) — no prior homework to evaluate (INV-HW3)

Given a subsequent session
When the teacher submits the report
Then the previous session's homework is graded
And new homework is assigned for the next session (INV-HW4)

Given a teacher viewing a student's homework
When the student has sessions with different teachers
Then all homework assignments are visible (cross-teacher continuity)
```

**Test Scenarios:**
- Report submitted with homework — both Jadid and Madi fields populated
- First session — homework assigned, not graded
- Subsequent session — previous homework graded, new homework assigned
- Cross-teacher homework visibility — all assignments visible
- Grades outside 0-100 — rejected

**Decision Refs:** B.11 (Surah/Juz enum), INV-HW1, INV-HW2, INV-HW3, INV-HW4, FR-5.2, FR-5.3, FR-5.4

---

### Surah/Juz Enum Homework Tracking

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 2 |
| **Story Points** | 3 |
| **Blocked By** | Session Report Submission with Homework (Jadid & Madi) |

**Description & Scope:**
Implement Surah/Juz enum-based homework tracking. Homework uses the surah_juz_ref enum for current_surah_juz and revision_surah_juz. This allows non-contiguous review assignments (e.g., "Surah Al-Baqarah" or "Juz 30").

**Acceptance Criteria:**
```gherkin
Given a teacher assigning homework
When they select a Surah or Juz
Then the surah_juz_ref enum value is stored in current_surah_juz or revision_surah_juz
And the enum value is validated against the surah_juz_ref enum

Given homework with Surah Al-Baqarah
When the teacher assigns revision homework for Juz 30
Then both current_surah_juz and revision_surah_juz can be different values
And non-contiguous assignments are supported
```

**Test Scenarios:**
- Valid Surah enum value — accepted
- Valid Juz enum value — accepted
- Non-contiguous assignments — both fields can differ
- Invalid enum value — rejected

**Decision Refs:** B.11 (Surah/Juz enum)

---

### On-Demand Matching Algorithm (Filter/Sort Pipeline)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 2 |
| **Story Points** | 8 |
| **Blocked By** | Teacher Availability Toggle (Available/Unavailable), Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled) |

**Description & Scope:**
Implement the on-demand matching algorithm. Students browse available teachers filtered by: (1) Qira'ah match, (2) subject availability, (3) country priority, (4) language match, (5) rating ranking. Only teachers with is_online=true and is_approved=true appear. In-session teachers are excluded.

**Acceptance Criteria:**
```gherkin
Given a student browsing available teachers
When the matching algorithm runs
Then only teachers with is_online=true AND is_approved=true are returned
And teachers are filtered by the student's recitation (Qira'ah) — Priority 1
And teachers are filtered by subject availability matching the student's intent — Priority 2
And teachers in the student's country are prioritized — Priority 3
And teachers fluent in the student's language are filtered for non-Arabic speakers — Priority 4
And teachers are sorted by average_rating descending — Priority 5

Given a student in Egypt with intent=Hifz and recitation=Hafs
When they browse teachers
Then Hafs-certified teachers in Egypt with Hifz subject appear first
And Hafs-certified teachers in other countries appear next
And non-Hafs teachers are excluded
And teachers without Hifz subject are excluded

Given a non-Arabic-speaking student
When they browse teachers
Then only teachers fluent in the student's language are shown

Given no teachers match all criteria
When the student browses
Then an empty result is returned with a message "No teachers available"
```

**Test Scenarios:**
- All filters applied correctly (Qira'ah, subject, country, language, rating)
- Country priority — same country first, fallback to others
- Rating sort — descending order
- No matches — empty result
- In-session teachers excluded
- Non-certified teachers excluded
- Unavailable teachers excluded

**Decision Refs:** B.10 (on-demand model), A.6 (teacher.subjects), FR-4.4

---

### Teacher Directory Browse & Filter API

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 2 |
| **Story Points** | 5 |
| **Blocked By** | On-Demand Matching Algorithm (Filter/Sort Pipeline) |

**Description & Scope:**
Implement the teacher directory API. Students can browse available teachers with pagination, filter by subject/country/language, and sort by rating. The API returns teacher profiles with relevant details for the student to choose.

**Acceptance Criteria:**
```gherkin
Given a student browsing the teacher directory
When they request the list with pagination
Then a paginated list of available teachers is returned
And each teacher entry includes: name, subjects, average_rating, country, is_online

Given a student filtering by subject=Hifz
When they request the directory
Then only teachers with Hifz in their subjects are returned

Given a student filtering by country=Egypt
When they request the directory
Then only teachers in Egypt are returned

Given a student sorting by rating
When they request the directory
Then teachers are sorted by average_rating descending
```

**Test Scenarios:**
- Paginated results — correct page size and offset
- Filter by subject — only matching teachers
- Filter by country — only matching teachers
- Sort by rating — descending order
- Combined filters — all filters applied
- Empty result when no teachers match

**Decision Refs:** B.10 (on-demand model), FR-4.4

---

### Real-Time Notification Engine (WebSocket)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 2 |
| **Story Points** | 8 |
| **Blocked By** | API Gateway & Routing Skeleton |

**Description & Scope:**
Implement the real-time notification engine using WebSocket. Notifications are persisted in the notifications table and pushed in real-time to connected users. Notification types: session_request, session_completion, session_cancellation, parent_link_request, system_broadcast, payment_confirmation, evaluation_result.

**Acceptance Criteria:**
```gherkin
Given a user is connected via WebSocket
When a notification is created for them
Then a notifications record is persisted in the database
And the notification is pushed in real-time to the user's WebSocket connection
And the notification includes type, title, body, related_entity_type, related_entity_id

Given a user is NOT connected via WebSocket
When a notification is created for them
Then the notification is persisted in the database
And it can be retrieved later via the notifications API
And is_read=false

Given a user reads a notification
When they mark it as read
Then notifications.is_read is set to true

Given a notification is created
When the type is validated
Then only valid notification_type enum values are accepted
```

**Test Scenarios:**
- Connected user receives real-time notification
- Disconnected user — notification persisted, retrieved later
- Mark notification as read — is_read=true
- Invalid notification type — rejected
- Notification includes related_entity_type and related_entity_id
- User can list all notifications (read and unread)
- User can filter notifications by type

**Decision Refs:** A.4 (notifications table), FR-9.1, FR-9.2, FR-9.3

---

### Session Request Notification to Teacher

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 2 |
| **Story Points** | 3 |
| **Blocked By** | Real-Time Notification Engine (WebSocket) |

**Description & Scope:**
When a student requests an instant session, a real-time notification is sent to the teacher. The notification includes session request details and allows the teacher to accept or decline.

**Acceptance Criteria:**
```gherkin
Given a student requests a session with a teacher
When the request is created
Then a notification is created with type='session_request'
And the notification is pushed to the teacher in real-time
And notifications.related_entity_type='session'
And notifications.related_entity_id=session.id

Given a teacher receives a session request notification
When they view the notification
Then they see the student's name, requested subject (intent), and can accept or decline

Given a teacher's request_preference='reject' (B.16)
When they receive a concurrent session request while in a session
Then the request is automatically rejected
And the student is notified

Given a teacher's request_preference='queue' (B.16)
When they receive a concurrent session request while in a session
Then the request is queued
And the teacher sees it after the current session concludes

Given a teacher's request_preference='offer_alternatives' (B.16)
When they receive a concurrent session request while in a session
Then the student is offered alternative available teachers
```

**Test Scenarios:**
- Session request — notification sent to teacher
- Teacher accepts — session created
- Teacher declines — student notified
- request_preference=reject — auto-reject concurrent requests
- request_preference=queue — requests queued
- request_preference=offer_alternatives — alternatives offered

**Decision Refs:** B.16 (request_preference), A.4 (notifications), FR-4.5, FR-9.1

---

### Dual-Confirmation Completion Handshake (24h Timeout)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 2 |
| **Story Points** | 5 |
| **Blocked By** | Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled) |

**Description & Scope:**
Implement the dual-confirmation completion handshake. Session completion requires: (1) teacher marks complete + submits report, (2) student confirms satisfactory completion. If neither party confirms within 24 hours, the session is auto-cancelled and held funds are refunded.

**Acceptance Criteria:**
```gherkin
Given a started session
When the teacher marks it complete and submits a report
Then session.status changes to 'completed'
And session.confirmed_by_teacher_at is set
And the student is notified to confirm

Given a completed session (teacher confirmed)
When the student confirms satisfactory completion
Then session.confirmed_by_student_at is set
And the dual confirmation is complete
And the escrow is triggered (balance decremented, wallet credited)

Given a completed session (teacher confirmed)
When 24 hours pass without student confirmation
Then the session is auto-cancelled
And session.status changes to 'cancelled'
And held funds (fee_held) are released back to the student's balance
And the student is notified

Given a completed session
When the student disputes the session (B.18)
Then session.status changes to 'disputed'
And the dispute is sent to admin for arbitration
```

**Test Scenarios:**
- Teacher marks complete — student notified to confirm
- Student confirms — dual confirmation complete, escrow triggered
- 24h timeout — auto-cancel, funds released
- Student disputes — session enters 'disputed' state
- confirmation_deadline is set correctly (now + 24h)
- Both confirmations recorded with timestamps

**Decision Refs:** B.2 (24h timeout), B.18 (disputed status), FR-5.5, INV-S3

---

### Fee Escrow: Hold at Request, Decrement at Completion

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 2 |
| **Story Points** | 5 |
| **Blocked By** | Dual-Confirmation Completion Handshake (24h Timeout), Segregated Session Balance Crediting |

**Description & Scope:**
Implement the fee escrow model. When a session is requested, the fee is held (fee_held=true, balance held but not decremented). Upon dual confirmation, the balance is decremented and the teacher's wallet is credited. If cancelled, held funds are released back.

**Acceptance Criteria:**
```gherkin
Given a student requests a session
When the session is created
Then session.fee is set by the platform (B.3)
And session.fee_held = true (B.4)
And the student's balance is held (not decremented yet)

Given a session with fee_held=true
When dual confirmation completes
Then the student's balance is decremented by 1
And session.fee_held is set to false
And the teacher's wallet is credited with session.fee

Given a session with fee_held=true
When the session is cancelled
Then session.fee_held is set to false
And the held balance is released (no decrement)
And no wallet transaction is created

Given a student with insufficient balance
When they request a session
Then the request is rejected with 422 "Insufficient balance"
And no session is created
```

**Test Scenarios:**
- Session request — fee held, balance held (not decremented)
- Dual confirmation — balance decremented, wallet credited, fee_held=false
- Cancellation — fee released, no decrement, no wallet credit
- Insufficient balance — request rejected
- Fee is platform-set (B.3), not negotiated

**Decision Refs:** B.3 (platform-set fees), B.4 (escrow hold-at-request), INV-B4, INV-W4, FR-5.5

---

### Teacher Wallet Crediting (Earning Transactions)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 2 |
| **Story Points** | 5 |
| **Blocked By** | Fee Escrow: Hold at Request, Decrement at Completion |

**Description & Scope:**
Implement teacher wallet crediting. Upon dual confirmation, a teacher_transaction (type=earning) is created, crediting the session fee to the teacher's wallet. Wallet balance and total_earning are updated. Each teacher has exactly one wallet.

**Acceptance Criteria:**
```gherkin
Given a session with dual confirmation complete
When the wallet crediting runs
Then a teacher_transaction record is created with type='earning'
And teacher_transaction.wallet_id = teacher's wallet
And teacher_transaction.session_id = session.id
And teacher_transaction.amount = session.fee
And teacher_transaction.status = 'completed'
And wallet.balance is incremented by session.fee
And wallet.total_earning is incremented by session.fee

Given a teacher without a wallet
When the first earning transaction is attempted
Then a wallet record is created for the teacher
And the earning transaction is linked to the new wallet

Given a cancelled session
When the wallet crediting is checked
Then NO teacher_transaction is created (no earning for cancelled sessions)
```

**Test Scenarios:**
- Dual confirmation — earning transaction created, wallet credited
- Wallet balance and total_earning updated correctly
- Cancelled session — no earning transaction
- Teacher without wallet — wallet created on first earning
- Wallet balance >= 0 (check constraint)
- Transaction amount >= 0 (check constraint)

**Decision Refs:** INV-W1, INV-W2, INV-W3, INV-W4, INV-W7, INV-W8, FR-5.5

---

### Teacher Withdrawal Workflow & Admin Approval

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 2 |
| **Story Points** | 5 |
| **Blocked By** | Teacher Wallet Crediting (Earning Transactions) |

**Description & Scope:**
Implement teacher withdrawal workflow. Teachers can request withdrawals from their wallet. Withdrawal requests start as pending and transition to completed (admin approves) or failed (admin rejects). Financial records are immutable.

**Acceptance Criteria:**
```gherkin
Given a teacher with wallet.balance > 0
When they request a withdrawal
Then a teacher_transaction is created with type='withdrawal', status='pending'
And the transaction amount is validated against wallet.balance

Given a pending withdrawal request
When the admin approves it
Then teacher_transaction.status changes to 'completed'
And wallet.balance is decremented by the withdrawal amount

Given a pending withdrawal request
When the admin rejects it
Then teacher_transaction.status changes to 'failed'
And wallet.balance is NOT decremented

Given a withdrawal request for more than wallet.balance
When the teacher submits it
Then the request is rejected with 422 "Insufficient wallet balance"

Given a completed or failed withdrawal transaction
When any attempt is made to modify it
Then the attempt is rejected (INV-W6: financial immutability)
```

**Test Scenarios:**
- Teacher requests withdrawal — pending transaction created
- Admin approves — completed, balance decremented
- Admin rejects — failed, balance unchanged
- Withdrawal > balance — rejected
- Attempt to modify completed transaction — rejected (immutable)
- Attempt to modify failed transaction — rejected (immutable)

**Decision Refs:** INV-W5, INV-W6, INV-W8, FR-5.6, FR-5.7

---

## Milestone 3 — Parent Portal & Admin Governance Tickets

---

### Student Handshake Code Generation

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 3 |
| **Story Points** | 2 |
| **Blocked By** | User Registration with Role-Specific Child Table Creation |

**Description & Scope:**
Each student is assigned a unique handshake code on creation. The code is used by parents to search for and link to their child. The handshake_code is unique, not null, and generated automatically.

**Acceptance Criteria:**
```gherkin
Given a new student is registered
When the student record is created
Then a unique handshake_code is generated
And students.handshake_code is unique (enforced by DB constraint)
And the code is not null

Given a student with an existing handshake code
When they view their profile
Then their handshake code is displayed

Given a parent searching for a child
When they enter the handshake code
Then the corresponding student is found
```

**Test Scenarios:**
- New student — handshake code generated
- Handshake code is unique across all students
- Parent can search by code — student found
- Invalid code — student not found

**Decision Refs:** A.3 (handshake_code), FR-7.1

---

### Parent-Child Link Request Workflow (7-Day Expiry)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 3 |
| **Story Points** | 5 |
| **Blocked By** | Student Handshake Code Generation |

**Description & Scope:**
Implement the parent-child link request workflow. A parent searches for their child using the handshake code and sends a link request. The student must explicitly confirm within 7 days. After 7 days, the link request expires.

**Acceptance Criteria:**
```gherkin
Given a parent with the child's handshake code
When they search for the child
Then the student is found (by handshake_code)
And the parent can send a link request

Given a parent sends a link request
When the request is created
Then students.parent_id is set to the parent's user_id (pending)
And the link request has a 7-day expiry
And the student is notified to confirm

Given a pending link request
When the student confirms within 7 days
Then the link is established
And students.parent_id is confirmed
And the parent gains read-only monitoring access

Given a pending link request
When 7 days pass without student confirmation
Then the link request expires
And students.parent_id is cleared (set to null)
And the parent must re-initiate the link request

Given a student with an existing parent link
When another parent attempts to link
Then the attempt is rejected (B.12: one parent per student)
```

**Test Scenarios:**
- Parent searches by code — student found
- Link request sent — student notified
- Student confirms within 7 days — link established
- Link request expires after 7 days — parent_id cleared
- Second parent attempts link — rejected (one parent per student)
- Parent can link to multiple children (different students, same parent_id)

**Decision Refs:** A.2 (parent_id FK), A.3 (handshake_code), B.12 (one parent per student), B.13 (parent multiple children), B.14 (7-day expiry), INV-P1, INV-P4, FR-7.2

---

### Student Confirmation of Parent Link

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 3 |
| **Story Points** | 3 |
| **Blocked By** | Parent-Child Link Request Workflow (7-Day Expiry) |

**Description & Scope:**
The student must explicitly confirm or reject the parent link request. This prevents unauthorized tracking. The student sees the pending link request and can accept or reject it.

**Acceptance Criteria:**
```gherkin
Given a student with a pending parent link request
When they view their notifications
Then they see the link request from the parent
And they can accept or reject it

Given a student accepts the link request
When the confirmation is submitted
Then students.parent_id is confirmed
And the parent gains read-only monitoring access
And a notification is sent to the parent

Given a student rejects the link request
When the rejection is submitted
Then students.parent_id is cleared
And the parent is notified of the rejection
And the parent cannot monitor the student
```

**Test Scenarios:**
- Student sees pending link request
- Student accepts — parent gains access, parent notified
- Student rejects — parent_id cleared, parent notified
- Student cannot be linked without explicit confirmation (INV-P1)

**Decision Refs:** B.14 (7-day expiry), INV-P1, FR-7.2

---

### Parent Read-Only Monitoring Portal

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 3 |
| **Story Points** | 8 |
| **Blocked By** | Student Confirmation of Parent Link, Session Request Notification to Teacher |

**Description & Scope:**
Implement the parent read-only monitoring portal. Parents can view their linked children's: attendance history, session reports, homework assignments, teacher evaluations, and academic progress statistics. MVP parents are read-only — they cannot modify data, request sessions, or make payments.

**Acceptance Criteria:**
```gherkin
Given a parent with a confirmed link to a child
When they access the monitoring portal
Then they see their child's:
  | Attendance history (sessions attended, cancelled)
  | Session reports (teacher notes, ratings)
  | Homework assignments (Jadid & Madi, grades)
  | Teacher evaluations (scores, notes)
  | Academic progress statistics (Tajweed curriculum progress)

Given a parent viewing their child's data
When they attempt to modify any data
Then the attempt is rejected with 403 "Read-only access" (INV-P2)

Given a parent without a confirmed link
When they attempt to access a student's data
Then access is denied with 403

Given a parent with multiple linked children
When they access the portal
Then they can switch between children's views
```

**Test Scenarios:**
- Parent views child's attendance — success
- Parent views child's session reports — success
- Parent views child's homework — success
- Parent views child's evaluations — success
- Parent views child's progress — success
- Parent attempts to modify data — 403 (read-only)
- Unlinked parent attempts access — 403
- Parent with multiple children — can switch views

**Decision Refs:** INV-P2, INV-P3, FR-7.3

---

### Parent Session Completion Notification Display

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 3 |
| **Story Points** | 3 |
| **Blocked By** | Parent Read-Only Monitoring Portal, Real-Time Notification Engine (WebSocket) |

**Description & Scope:**
When a child's session completes, the linked parent receives a real-time notification with a link to the session report, homework, and evaluation score. The parent portal displays these notifications.

**Acceptance Criteria:**
```gherkin
Given a linked child's session reaches 'completed' status
When the session completes
Then a notification is created for the parent with type='session_completion'
And the notification includes a link to the session report, homework, and evaluation
And the notification is pushed in real-time to the parent

Given a parent receives a session completion notification
When they click the link
Then they are taken to the session report view in the monitoring portal
```

**Test Scenarios:**
- Session completes — parent notified with link to report
- Parent clicks link — session report displayed
- Unlinked parent — no notification
- Notification includes session report, homework, and evaluation

**Decision Refs:** A.4 (notifications), INV-P3, FR-7.4

---

### Student Evaluation Submission (Teacher Rating)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 3 |
| **Story Points** | 3 |
| **Blocked By** | Dual-Confirmation Completion Handshake (24h Timeout) |

**Description & Scope:**
Students can submit a teacher evaluation (rating) at the end of each completed session. The rating directly influences the teacher's search ranking and visibility.

**Acceptance Criteria:**
```gherkin
Given a student who completed a session (dual confirmation done)
When they submit a teacher evaluation
Then an evaluations record is created with evaluated_id=teacher, evaluator_id=student
And evaluations.score is 0-100 (or a 0-5 rating converted to score)
And evaluations.session_id is set

Given a student who has not completed the session
When they attempt to submit a teacher evaluation
Then the attempt is rejected with 422 "Session not completed"
```

**Test Scenarios:**
- Student submits rating after completed session — success
- Student submits rating before completion — rejected
- Rating is linked to the session
- evaluated_id = teacher, evaluator_id = student (C.3)

**Decision Refs:** C.3 (evaluated_id/evaluator_id), FR-8.2, INV-E4

---

### Teacher Average Rating Aggregation & Update

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 3 |
| **Story Points** | 3 |
| **Blocked By** | Student Evaluation Submission (Teacher Rating) |

**Description & Scope:**
The teacher's average_rating is updated based on student evaluations. The average is computed from all evaluation scores for the teacher and stored in teacher.average_rating (0-5 scale, check constraint).

**Acceptance Criteria:**
```gherkin
Given a teacher receives a new student evaluation
When the evaluation is submitted
Then teacher.average_rating is recalculated as the average of all student evaluations
And the rating is on a 0-5 scale (check constraint)
And the updated rating influences search ranking

Given a teacher with no evaluations
When their average_rating is checked
Then teacher.average_rating = 0 (default)
```

**Test Scenarios:**
- New evaluation — average_rating recalculated
- Multiple evaluations — correct average computed
- No evaluations — average_rating = 0
- average_rating stays within 0-5 (check constraint)

**Decision Refs:** FR-8.2, INV-E4

---

### Admin-Ordered Re-Evaluation (Teacher Wallet Deduction)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 3 |
| **Story Points** | 5 |
| **Blocked By** | Cooldown State Machine (1-Month Tajweed / 3-Month Hifz), Teacher Wallet Crediting (Earning Transactions) |

**Description & Scope:**
When an admin orders a re-evaluation for a teacher, the cost is deducted from the teacher's wallet balance. This is recorded as a teacher_transaction with type=withdrawal. The re-evaluation process follows the same 5-session loop.

**Acceptance Criteria:**
```gherkin
Given an admin orders a re-evaluation for a teacher
When the order is processed
Then a teacher_transaction is created with type='withdrawal'
And the transaction amount is the re-evaluation fee
And wallet.balance is decremented by the fee
And the action is logged in audit_logs

Given a teacher with insufficient wallet balance
When the admin orders a re-evaluation
Then the order is rejected with 422 "Insufficient wallet balance for re-evaluation"

Given a re-evaluation is ordered
When the teacher enters the evaluation loop
Then the same 5-session evaluation loop applies
And the teacher's is_approved is set to false during re-evaluation
```

**Test Scenarios:**
- Admin orders re-evaluation — wallet deducted, audit logged
- Insufficient wallet — rejected
- Re-evaluation loop — same 5-session process
- Teacher's is_approved set to false during re-evaluation

**Decision Refs:** B.5 (re-eval paid by teacher), A.5 (audit_logs), FR-3.8

---

### Admin Academic Tracking (Memorization & Revision Milestones)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 3 |
| **Story Points** | 3 |
| **Blocked By** | Session Report Submission with Homework (Jadid & Madi) |

**Description & Scope:**
Admin can monitor student memorization and revision milestones. This includes tracking homework grades, Surah/Juz progress, and overall academic advancement across all students.

**Acceptance Criteria:**
```gherkin
Given an admin
When they view the academic tracking dashboard
Then they see:
  | Student memorization progress (current Surah/Juz)
  | Revision milestones (Madi homework grades)
  | Overall academic advancement statistics
  | Students needing attention (low grades, slow progress)

Given an admin viewing a specific student
When they drill into the student's academic record
Then they see all homework assignments, grades, and progress over time
```

**Test Scenarios:**
- Admin views academic dashboard — all students' progress visible
- Admin drills into specific student — full academic history
- Students with low grades — flagged for attention
- Non-admin attempts access — 403

**Decision Refs:** B.11 (Surah/Juz enum), FR-6.3 (admin academic tracking)

---

### Admin CRUD: Users, Teachers, Students, Parents

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 3 |
| **Story Points** | 5 |
| **Blocked By** | Role-Based Authorization Middleware |

**Description & Scope:**
Implement full CRUD for admin over all entities: users, teachers, students, parents, plans, subscriptions, sessions, reports, evaluations, wallets, and transactions. Admin can view, create, update, and soft-delete records.

**Acceptance Criteria:**
```gherkin
Given an authenticated admin
When they access the admin CRUD endpoints
Then they can:
  | List all users with filtering by role, status, country
  | View any user's full profile
  | Create users (direct onboarding)
  | Update user profiles
  | Soft-delete users (is_deleted=true)
  | List all teachers with verification status
  | List all students with subscription status
  | List all parents with linked children
  | View all plans, subscriptions, sessions, reports, evaluations
  | View all wallets and transactions

Given a non-admin user
When they attempt to access admin CRUD endpoints
Then access is denied with 403
```

**Test Scenarios:**
- Admin lists users — all users returned with filters
- Admin views user profile — full profile visible
- Admin creates user — user created
- Admin updates user — user updated
- Admin soft-deletes user — is_deleted=true
- Non-admin — 403

**Decision Refs:** FR-10.1, A.7 (governance on users)

---

### Account Soft-Delete Governance (users.is_deleted)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 3 |
| **Story Points** | 3 |
| **Blocked By** | Admin CRUD: Users, Teachers, Students, Parents |

**Description & Scope:**
Implement soft-delete governance. Users, students, and teachers must never be hard-deleted. Deletions use soft delete (is_deleted=true). Historical data (sessions, reports, financial transactions) is preserved. Soft-deleted users cannot access the platform.

**Acceptance Criteria:**
```gherkin
Given an admin soft-deletes a user
When the soft delete is executed
Then users.is_deleted = true
And users.deleted_at = current timestamp
And NO records are hard-deleted
And the user's historical sessions, reports, and financial transactions are preserved

Given a soft-deleted user
When they attempt to log in
Then access is denied with 403 "Account deleted"

Given a soft-deleted user
When the admin reactivates them
Then users.is_deleted = false
And users.deleted_at is cleared
And the user can access the platform again

Given any user, student, or teacher record
When an attempt is made to hard-delete it
Then the attempt is rejected (INV-U4: no hard deletes)
```

**Test Scenarios:**
- Soft delete — is_deleted=true, deleted_at set
- Soft-deleted user login — denied
- Reactivation — is_deleted=false, access restored
- Hard delete attempt — rejected
- Historical data preserved after soft delete
- Financial transactions preserved (INV-U1)

**Decision Refs:** A.7 (governance on users), INV-U1, INV-U4, INV-U5, FR-1.4, FR-10.2

---

### Cold-Start Bootstrapping (Direct Sheikh Certification)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 3 |
| **Story Points** | 3 |
| **Blocked By** | Admin CRUD: Users, Teachers, Students, Parents |

**Description & Scope:**
Admin can directly onboard and certify foundational Shuyukh without requiring evaluation purchases. These certified Shuyukh form the "Certified Evaluation Committee" and can evaluate new applicants. teacher.is_approved=true and teacher.is_evaluator=true are set directly.

**Acceptance Criteria:**
```gherkin
Given an admin
When they directly certify a foundational sheikh
Then a teacher record is created (if not exists)
And teacher.is_approved = true
And teacher.is_evaluator = true
And the action is logged in audit_logs with action_type='override'
And the sheikh can immediately evaluate new applicants

Given a cold-start certified sheikh
When they appear in the evaluation system
Then they are available as evaluators for new applicants
And they can also teach students

Given a non-admin
When they attempt to cold-start certify
Then access is denied with 403
```

**Test Scenarios:**
- Admin certifies sheikh — teacher record created, is_approved=true, is_evaluator=true
- Cold-start sheikh can evaluate applicants
- Cold-start sheikh can teach students
- Non-admin — 403
- Action logged in audit_logs

**Decision Refs:** FR-3.9, INV-TV1(b), A.5 (audit_logs)

---

### Direct Student Onboarding with Offline Payment

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 3 |
| **Story Points** | 5 |
| **Blocked By** | Admin CRUD: Users, Teachers, Students, Parents, Admin Subscription Management (Extend/Renew/Cancel/Upgrade/Downgrade) |

**Description & Scope:**
Admin can manually register a student with profile, parent association, direct subscription activation, and offline payment (cash/bank transfer/scholarship). Offline payments bypass student_payments and are tracked via subscriptions.payment_method, payment_reference, and payment_verified_at.

**Acceptance Criteria:**
```gherkin
Given an admin
When they directly onboard a student with offline payment
Then a users record is created with role='student'
And a students record is created with handshake_code
And a subscriptions record is created with:
  | payment_method = 'offline_cash' or 'bank_transfer' or 'scholarship'
  | payment_reference = admin-provided reference number
  | payment_verified_at = current timestamp (admin verifies immediately)
  | status = 'active'
And the session balance is credited immediately
And NO student_payments record is created (offline bypass)
And the action is logged in audit_logs

Given an admin directly onboarding a student
When they associate a parent
Then the parent link is established (parent_id set)
And the parent gains monitoring access

Given an admin
When they specify the payment method
Then only valid payment_gateway enum values are accepted (including offline types)
```

**Test Scenarios:**
- Direct onboarding with cash — subscription active, balance credited, no student_payments
- Direct onboarding with bank transfer — payment_reference stored
- Direct onboarding with scholarship — payment_method='scholarship'
- Parent associated during onboarding — link established
- Invalid payment method — rejected
- Action logged in audit_logs

**Decision Refs:** B.9 (offline payment), A.5 (audit_logs), FR-10.2, INV-PAY5

---

### Immutable Audit Logging for All Admin Actions

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 3 |
| **Story Points** | 5 |
| **Blocked By** | Admin CRUD: Users, Teachers, Students, Parents |

**Description & Scope:**
Implement immutable audit logging for all admin actions. Every administrative action is permanently logged in audit_logs with actor_id, action_type, entity_type, entity_id, details (JSON), and created_at. The audit log is append-only (immutable).

**Acceptance Criteria:**
```gherkin
Given an admin performs any action (create, update, delete, override, adjust, suspend, reactivate)
When the action is executed
Then an audit_logs record is created with:
  | actor_id = admin's user_id
  | action_type = the action type (audit_action_type enum)
  | entity_type = the affected entity type
  | entity_id = the affected entity ID
  | details = JSON with action details
  | created_at = current timestamp

Given an audit log record
When any attempt is made to modify or delete it
Then the attempt is rejected (append-only, immutable)

Given an admin
When they review the audit trail
Then they can filter by actor_id, action_type, entity_type, entity_id, and date range
And the results show all administrative actions in chronological order
```

**Test Scenarios:**
- Admin creates user — audit log created with action_type='create'
- Admin updates user — audit log created with action_type='update'
- Admin soft-deletes user — audit log created with action_type='delete'
- Admin overrides evaluation — audit log created with action_type='override'
- Admin adjusts wallet — audit log created with action_type='adjust'
- Admin suspends user — audit log created with action_type='suspend'
- Admin reactivates user — audit log created with action_type='reactivate'
- Attempt to modify audit log — rejected (immutable)
- Attempt to delete audit log — rejected (immutable)
- Admin can filter audit trail by various criteria

**Decision Refs:** A.5 (audit_logs), FR-10.5

---

### Admin Session Governance (View/Filter/Reschedule/Cancel/Reassign/Join)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 3 |
| **Story Points** | 5 |
| **Blocked By** | Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled) |

**Description & Scope:**
Admin can view all sessions with filtering by teacher, student, type, date. Admin can reschedule, cancel, reassign teachers, join live sessions, and review reports/evaluations.

**Acceptance Criteria:**
```gherkin
Given an admin
When they view all sessions
Then they can filter by teacher, student, session_type, status, and date range
And the results include all session details

Given an admin and a scheduled session
When the admin reschedules the session
Then the session timing is updated
And the action is logged in audit_logs

Given an admin and any session
When the admin cancels the session
Then session.status = 'cancelled'
And held funds are released
And the action is logged in audit_logs

Given an admin and a session
When the admin reassigns the teacher
Then session.teacher_id is updated to a new certified teacher
And the action is logged in audit_logs

Given an admin and a live session (status='started')
When the admin joins the session
Then they can observe the session
And the action is logged in audit_logs
```

**Test Scenarios:**
- Admin views sessions with filters — correct results
- Admin reschedules — timing updated, audit logged
- Admin cancels — status=cancelled, funds released, audit logged
- Admin reassigns teacher — teacher_id updated, audit logged
- Admin joins live session — can observe, audit logged
- Non-admin — 403

**Decision Refs:** FR-10.3, A.5 (audit_logs)

---

### Dispute Resolution with Admin Arbitration

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 3 |
| **Story Points** | 5 |
| **Blocked By** | Dual-Confirmation Completion Handshake (24h Timeout) |

**Description & Scope:**
After dual confirmation, if a student disputes a session, the session enters 'disputed' status. An admin reviews the case via the audit log and makes a binding arbitration decision: refund, partial refund, or uphold.

**Acceptance Criteria:**
```gherkin
Given a completed session (dual confirmation done)
When the student disputes the session
Then session.status changes to 'disputed'
And a notification is sent to the admin
And the dispute is recorded with details

Given a disputed session
When the admin reviews the case
Then they can see the session report, homework, evaluations, and audit trail

Given a disputed session
When the admin decides to refund
Then the session fee is refunded to the student's balance
And the teacher's wallet is debited (reversal of earning)
And the action is logged in audit_logs

Given a disputed session
When the admin decides to uphold
Then the session remains 'completed'
And no financial changes are made
And the action is logged in audit_logs

Given a disputed session
When the admin decides partial refund
Then a partial fee is refunded to the student
And the teacher's wallet is partially debited
And the action is logged in audit_logs
```

**Test Scenarios:**
- Student disputes completed session — status='disputed', admin notified
- Admin refunds — student balance credited, teacher wallet debited, audit logged
- Admin upholds — no changes, audit logged
- Admin partial refund — partial credit/debit, audit logged
- Non-admin cannot dispute — 403
- Non-admin cannot arbitrate — 403

**Decision Refs:** B.18 (admin arbitration), A.5 (audit_logs)

---

### Admin Financial Auditing (Payments, Wallets, Withdrawal Approval)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 3 |
| **Story Points** | 5 |
| **Blocked By** | Teacher Wallet Crediting (Earning Transactions) |

**Description & Scope:**
Admin can audit all student payments, inspect teacher wallets, approve/reject withdrawal requests, and issue manual wallet adjustments with audit logging.

**Acceptance Criteria:**
```gherkin
Given an admin
When they audit student payments
Then they can view all student_payments with filtering by student, status, date
And they can see payment amounts, gateways, and subscription links

Given an admin
When they inspect a teacher's wallet
Then they see wallet.balance, wallet.total_earning, and all teacher_transactions
And they can filter transactions by type, status, and date

Given an admin and a pending withdrawal request
When they approve it
Then teacher_transaction.status = 'completed'
And wallet.balance is decremented
And the action is logged in audit_logs

Given an admin and a pending withdrawal request
When they reject it
Then teacher_transaction.status = 'failed'
And wallet.balance is NOT decremented
And the action is logged in audit_logs

Given an admin
When they issue a manual wallet adjustment (bonus)
Then a teacher_transaction is created with type='bonus'
And wallet.balance is adjusted (credit or deduction)
And the action is logged in audit_logs with action_type='adjust'
```

**Test Scenarios:**
- Admin audits payments — all payments visible with filters
- Admin inspects wallet — balance, earnings, transactions visible
- Admin approves withdrawal — completed, balance decremented, audit logged
- Admin rejects withdrawal — failed, balance unchanged, audit logged
- Admin issues bonus — transaction created, balance adjusted, audit logged
- Non-admin — 403

**Decision Refs:** FR-10.4, A.5 (audit_logs), INV-W5, INV-W6

---

### Platform Analytics Dashboard

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 3 |
| **Story Points** | 5 |
| **Blocked By** | Admin CRUD: Users, Teachers, Students, Parents |

**Description & Scope:**
Real-time monitoring of all platform statistics, sessions, and operational reports. Admin dashboard shows key metrics: active users, sessions per day, revenue, teacher availability, subscription stats.

**Acceptance Criteria:**
```gherkin
Given an admin
When they access the analytics dashboard
Then they see:
  | Total active users (by role)
  | Sessions per day/week/month
  | Revenue (total and trend)
  | Active teachers (is_online=true)
  | Subscription statistics (active, expired, cancelled)
  | Average session rating
  | Platform health indicators

Given an admin
When they drill into a specific metric
Then they see detailed breakdowns and trends
```

**Test Scenarios:**
- Dashboard loads with real-time data
- Metrics are accurate (verified against database)
- Drill-down shows details
- Non-admin — 403

**Decision Refs:** FR-10.6

---

### Broadcast Notifications (System-Wide & Targeted)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 3 |
| **Story Points** | 3 |
| **Blocked By** | Real-Time Notification Engine (WebSocket) |

**Description & Scope:**
Admin can broadcast system-wide announcements or targeted notifications to specific cohorts (all teachers, all students, all parents, specific country, specific plan subscribers).

**Acceptance Criteria:**
```gherkin
Given an admin
When they broadcast a system-wide notification
Then a notification is created for ALL users with type='system_broadcast'
And the notification is pushed in real-time to all connected users

Given an admin
When they send a targeted notification to a cohort (e.g., all teachers)
Then notifications are created only for users in that cohort
And the notification is pushed in real-time to connected users in the cohort

Given an admin
When they send a targeted notification to specific plan subscribers
Then only users with active subscriptions to that plan receive the notification
```

**Test Scenarios:**
- System-wide broadcast — all users receive notification
- Targeted to teachers — only teachers receive
- Targeted to students — only students receive
- Targeted to parents — only parents receive
- Targeted to plan subscribers — only subscribers of that plan receive
- Non-admin — 403

**Decision Refs:** A.4 (notifications), FR-9.3

---

## Milestone 4 — Integration, Security & Launch Tickets

---

### Workflow Tests: Student Journey

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 4 |
| **Story Points** | 5 |
| **Blocked By** | All Milestone 1–3 tickets |

**Description & Scope:**
Chained workflow tests under `test/workflows/` (journey-test harness driving real backend services end-to-end in code) covering the complete student journey: registration → plan subscription → session booking → session completion → dual confirmation → parent notification.

**Acceptance Criteria:**
```gherkin
Given a new student created via entity-setup helpers within runInRollback
When the full journey is driven through services and the GraphQL API:
  | Register → Select recitation → Browse plans → Purchase plan → Balance credited
  | Browse teachers → Request session → Attend session → Teacher marks complete
  | Student confirms → Balance decremented → Teacher wallet credited
  | Parent receives notification → Parent views report
Then all steps succeed and data is consistent across all tables
```

**Test Scenarios:**
- Full student journey workflow — all steps pass at service/repository/GraphQL level
- Data consistency — balances, sessions, reports, wallets all correct
- Parent notification — emitted and persisted for retrieval
- Edge cases: insufficient balance, session cancellation, dispute

---

### Workflow Tests: Parent Journey

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 4 |
| **Story Points** | 5 |
| **Blocked By** | Parent Read-Only Monitoring Portal, Parent Session Completion Notification Display |

**Description & Scope:**
Chained workflow tests under `test/workflows/` (journey-test harness driving real backend services end-to-end in code) covering the complete parent journey: registration → search child by code → send link request → student confirms → monitor child → receive notifications.

**Acceptance Criteria:**
```gherkin
Given a new parent created via entity-setup helpers within runInRollback
When the full journey is driven through services and the GraphQL API:
  | Register → Get child's handshake code → Search child → Send link request
  | Student confirms → Parent views child's sessions, reports, homework, progress
  | Child's session completes → Parent receives notification → Parent views report
Then all steps succeed and parent sees correct read-only data
```

**Test Scenarios:**
- Full parent journey workflow — all steps pass at service/repository/GraphQL level
- Parent can only see linked children
- Parent cannot modify data (read-only enforced at service/GraphQL layer)
- Link request expiry — 7 days
- One parent per student enforced

---

### Workflow Tests: Subscription Lifecycle

| Field | Value |
|---|---|
| **Owner Stream** | Dev 1 |
| **Milestone** | 4 |
| **Story Points** | 3 |
| **Blocked By** | Admin Subscription Management (Extend/Renew/Cancel/Upgrade/Downgrade) |

**Description & Scope:**
Chained workflow tests under `test/workflows/` (journey-test harness driving real backend services end-to-end in code, e.g. `test/workflows/billing/subscription-purchase.journey.test.ts`) covering the complete subscription lifecycle: purchase → activation → balance crediting → validity window → expiry → renewal → upgrade/downgrade with proration.

**Acceptance Criteria:**
```gherkin
Given a student created via entity-setup helpers within runInRollback
When the subscription lifecycle is driven through services and the GraphQL API:
  | Purchase plan → Balance credited → Use sessions → Subscription expires
  | Admin renews → New balance credited → Admin upgrades → Prorated balance
  | Admin downgrades → Prorated balance → Admin cancels → Balance preserved
Then all steps succeed and balances are correct at each stage
```

**Test Scenarios:**
- Purchase → activation → balance credited (service-level assertions)
- Expiry → balance zeroed
- Renewal → new balance
- Upgrade → prorated balance
- Downgrade → prorated balance
- Cancel → balance preserved

---

### Security Hardening: Input Validation & SQL Injection Prevention

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 4 |
| **Story Points** | 5 |
| **Blocked By** | All Milestone 1–3 tickets |

**Description & Scope:**
Comprehensive security hardening: input validation on all endpoints, SQL injection prevention (parameterized queries), XSS prevention, CSRF protection, rate limiting, and security headers.

**Acceptance Criteria:**
```gherkin
Given all API endpoints
When input is validated
Then all inputs are sanitized and validated
And SQL injection attempts are prevented (parameterized queries)
And XSS attempts are prevented (output encoding)
And CSRF protection is in place
And rate limiting is enforced on auth endpoints
And security headers are set (CSP, X-Frame-Options, X-Content-Type-Options)

Given a malicious input
When it is submitted to any endpoint
Then it is rejected or sanitized
And no SQL injection or XSS is possible
```

**Test Scenarios:**
- SQL injection attempt — rejected
- XSS attempt — sanitized
- CSRF attack — prevented
- Rate limiting — auth endpoints limited
- Security headers — present in responses
- Input validation — all fields validated

---

### Audit Trail Completeness Verification

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 4 |
| **Story Points** | 3 |
| **Blocked By** | Immutable Audit Logging for All Admin Actions |

**Description & Scope:**
Verify that all admin actions are logged in the audit trail. Automated tests that perform every admin action and verify the corresponding audit_log record exists.

**Acceptance Criteria:**
```gherkin
Given every admin action
When it is performed
Then an audit_log record exists with correct actor_id, action_type, entity_type, entity_id, and details

Given the audit trail
When it is reviewed
Then it shows a complete chronological history of all administrative actions
And no actions are missing from the log
```

**Test Scenarios:**
- Create action — audit log exists
- Update action — audit log exists
- Delete action — audit log exists
- Override action — audit log exists
- Adjust action — audit log exists
- Suspend action — audit log exists
- Reactivate action — audit log exists
- No missing entries

---

### State Machine Invariant Verification Tests

| Field | Value |
|---|---|
| **Owner Stream** | Dev 2 |
| **Milestone** | 4 |
| **Story Points** | 5 |
| **Blocked By** | All Milestone 1–3 tickets |

**Description & Scope:**
Automated tests that verify all state machine invariants from `docs/specs/state-machine-invariants.md`. Tests cover all 10 state machines and 50+ invariants.

**Acceptance Criteria:**
```gherkin
Given all state machine invariants from state-machine-invariants.md
When the verification tests run
Then every invariant is tested and passes:
  | Session lifecycle (INV-S1 through INV-S8)
  | Teacher verification (INV-TV1 through INV-TV7)
  | Teacher availability (INV-A1 through INV-A4)
  | Subscription & balance (INV-B1 through INV-B6)
  | Wallet & transaction (INV-W1 through INV-W8)
  | Student account (INV-U1 through INV-U5)
  | Parent-child link (INV-P1 through INV-P4)
  | Payment (INV-PAY1 through INV-PAY5)
  | Homework & progress (INV-HW1 through INV-HW4, INV-PR1 through INV-PR3)
  | Evaluation (INV-E1 through INV-E6)
```

**Test Scenarios:**
- All 50+ invariants tested
- Invalid transitions rejected
- Check constraints enforced
- Immutability verified
- Uniqueness constraints verified

---

### Load Testing & Performance Optimization

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 4 |
| **Story Points** | 8 |
| **Blocked By** | All Milestone 1–3 tickets |

**Description & Scope:**
Load testing with target concurrency (100+ concurrent sessions). Performance optimization: database query optimization, index verification, N+1 query elimination, caching strategy.

**Acceptance Criteria:**
```gherkin
Given the platform under load
When 100+ concurrent users are active
Then all API endpoints respond within 500ms (95th percentile)
And WebSocket connections are stable
And database queries are optimized (no full table scans)
And N+1 queries are eliminated
And indexes are verified on all foreign keys and frequently queried columns

Given the matching algorithm
When 100+ teachers are available
Then the filter/sort pipeline completes within 200ms
And results are paginated
```

**Test Scenarios:**
- 100 concurrent session requests — all succeed
- 100 concurrent WebSocket connections — stable
- Matching algorithm with 100+ teachers — < 200ms
- API response times — < 500ms (95th percentile)
- Database query analysis — no full table scans
- Index verification — all FKs indexed

---

### Disaster Recovery & Backup Verification

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 4 |
| **Story Points** | 5 |
| **Blocked By** | None — can start immediately |

**Description & Scope:**
Disaster recovery plan documentation and testing. Database backup and restore verification. Define RPO (Recovery Point Objective) and RTO (Recovery Time Objective).

**Acceptance Criteria:**
```gherkin
Given the production database
When a backup is performed
Then the backup is complete and consistent
And the backup can be restored to a staging environment
And all data is verified after restore

Given a disaster scenario
When the recovery plan is executed
Then the platform is restored within the defined RTO
And data loss is within the defined RPO
And the disaster recovery plan is documented
```

**Test Scenarios:**
- Backup — complete and consistent
- Restore — all data verified
- RTO — platform restored within target time
- RPO — data loss within target
- Recovery plan — documented and tested

---

### Financial Safety Verification (Double-Spend, Escrow Integrity)

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 4 |
| **Story Points** | 5 |
| **Blocked By** | Fee Escrow: Hold at Request, Decrement at Completion, Teacher Wallet Crediting (Earning Transactions) |

**Description & Scope:**
Financial safety verification: double-spend prevention, escrow integrity, financial immutability, and wallet balance consistency. Automated tests that attempt to exploit financial edge cases.

**Acceptance Criteria:**
```gherkin
Given a student with balance_hifz=1
When they attempt to request two sessions simultaneously
Then only one session is created (double-spend prevented)
And the balance is held for only one session

Given a session with fee_held=true
When the session is cancelled
Then the held funds are released (no decrement)
And no wallet transaction is created

Given a completed earning transaction
When any attempt is made to modify it
Then the attempt is rejected (immutable)

Given a teacher's wallet
When the balance is checked
Then wallet.balance = sum of all completed earnings - sum of all completed withdrawals
And the balance is non-negative
```

**Test Scenarios:**
- Double-spend attempt — prevented (only one session created)
- Escrow cancellation — funds released, no wallet credit
- Financial immutability — transactions cannot be modified
- Wallet consistency — balance = earnings - withdrawals
- Negative balance — prevented (check constraint)
- Concurrent session requests — only one succeeds

---

### Production Launch Checklist Execution

| Field | Value |
|---|---|
| **Owner Stream** | Dev 3 |
| **Milestone** | 4 |
| **Story Points** | 5 |
| **Blocked By** | All Milestone 4 tickets |

**Description & Scope:**
Execute the production launch checklist from `docs/planning/PRODUCTION_READINESS.md`. Final verification before opening the platform to real Shuyukh and students.

**Acceptance Criteria:**
```gherkin
Given the production launch checklist
When it is executed
Then every item is verified and signed off:
  | Data integrity & governance
  | Financial & escrow safeguards
  | Real-time reliability
  | Security hardening
  | Audit trail completeness
  | Performance & load testing
  | Disaster recovery
  | All 33 decisions verified
And the platform is ready for production launch
```

**Test Scenarios:**
- All checklist items verified
- All 33 decisions verified in production context
- All state machine invariants pass
- All financial safety checks pass
- All security checks pass
- All performance targets met
- Disaster recovery tested
- Launch approved

---

## Ticket Summary

| Stream | Milestone 0 | Milestone 1 | Milestone 2 | Milestone 3 | Milestone 4 | Total |
|---|---|---|---|---|---|---|
| Dev 1 | 4 tickets | 5 tickets | 3 tickets | 5 tickets | 3 tickets | 20 tickets |
| Dev 2 | 3 tickets | 7 tickets | 5 tickets | 4 tickets | 3 tickets | 22 tickets |
| Dev 3 | 3 tickets | 4 tickets | 8 tickets | 8 tickets | 4 tickets | 27 tickets |
| **Total** | **10** | **16** | **16** | **17** | **10** | **69 tickets** |

### Story Point Summary

| Stream | Milestone 0 | Milestone 1 | Milestone 2 | Milestone 3 | Milestone 4 | Total SP |
|---|---|---|---|---|---|---|
| Dev 1 | 15 | 21 | 11 | 21 | 13 | 81 |
| Dev 2 | 11 | 27 | 19 | 14 | 13 | 84 |
| Dev 3 | 11 | 15 | 39 | 39 | 23 | 127 |
| **Total** | **37** | **63** | **69** | **74** | **49** | **292 SP** |

### Decision Coverage

All 33 resolved decisions are covered by tickets:

| Decision | Primary Ticket(s) |
|---|---|
| A.1 (parents table) | User Registration with Role-Specific Child Table Creation |
| A.2 (parent_id FK) | Parent-Child Link Request Workflow (7-Day Expiry) |
| A.3 (handshake_code) | User Registration with Role-Specific Child Table Creation, Student Handshake Code Generation |
| A.4 (notifications) | Real-Time Notification Engine (WebSocket), Session Request Notification to Teacher, Parent Session Completion Notification Display, Broadcast Notifications (System-Wide & Targeted) |
| A.5 (audit_logs) | Immutable Audit Logging for All Admin Actions, Admin-Ordered Re-Evaluation (Teacher Wallet Deduction), Direct Student Onboarding with Offline Payment |
| A.6 (teacher.subjects) | On-Demand Matching Algorithm (Filter/Sort Pipeline) |
| A.7 (governance on users) | User Registration with Role-Specific Child Table Creation, Role-Based Authorization Middleware, Account Soft-Delete Governance (users.is_deleted) |
| A.8 (session_type) | Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled), 5-Session Evaluation Loop Booking |
| A.9 (subscription status) | Subscription Purchase via Payment Gateway, Subscription Validity Window & Expiry |
| A.10 (session_intent) | Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled), 5-Session Evaluation Loop Booking |
| B.1 (80% threshold) | Evaluation Rubric Scoring (≥80% Threshold) |
| B.2 (24h timeout) | Dual-Confirmation Completion Handshake (24h Timeout), Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled) |
| B.3 (platform-set fees) | Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled), Fee Escrow: Hold at Request, Decrement at Completion |
| B.4 (escrow hold-at-request) | Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled), Fee Escrow: Hold at Request, Decrement at Completion |
| B.5 (re-eval paid by teacher) | Admin-Ordered Re-Evaluation (Teacher Wallet Deduction) |
| B.6 (applicants table) | Teacher Applicant Registration & Applicants Table, Failed Applicant → Student Record Conversion |
| B.7 (teacher after verification) | Evaluation Rubric Scoring (≥80% Threshold), Failed Applicant → Student Record Conversion |
| B.8/C.2 (user_id generic) | Subscription Purchase via Payment Gateway, Verification Plan Purchase (5 Sessions) |
| B.9 (offline payment) | Direct Student Onboarding with Offline Payment |
| B.10 (on-demand model) | On-Demand Matching Algorithm (Filter/Sort Pipeline) |
| B.11 (Surah/Juz enum) | Session Report Submission with Homework (Jadid & Madi), Surah/Juz Enum Homework Tracking |
| B.12 (one parent per student) | Parent-Child Link Request Workflow (7-Day Expiry) |
| B.13 (parent multiple children) | Parent-Child Link Request Workflow (7-Day Expiry) |
| B.14 (7-day link expiry) | Parent-Child Link Request Workflow (7-Day Expiry) |
| B.15 (15-min inactivity) | 15-Minute Inactivity Auto-Offline |
| B.16 (request_preference) | Teacher Availability Toggle (Available/Unavailable), Session Request Notification to Teacher |
| B.17 (prorated plan changes) | Admin Subscription Management (Extend/Renew/Cancel/Upgrade/Downgrade) |
| B.18 (admin arbitration) | Dual-Confirmation Completion Handshake (24h Timeout), Dispute Resolution with Admin Arbitration |
| C.1 (parent role) | User Registration with Role-Specific Child Table Creation, Role-Based Authorization Middleware |
| C.3 (evaluated_id/evaluator_id) | Evaluation Rubric Scoring (≥80% Threshold), Student Evaluation Submission (Teacher Rating) |
| C.4 (reports.teacher_id removed) | Session Report & Homework Infrastructure |
| C.5 (recitation 1:1 session) | Recitation Record per Session (1:1) |
