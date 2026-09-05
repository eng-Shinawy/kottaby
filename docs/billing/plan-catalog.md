# Plan Catalog Reference Documentation

**Domain:** Billing & Subscriptions  
**Target Ticket:** DEV1-005: Plan Catalog CRUD (Admin Only)  
**Lifecycle Status:** Active  

---

## 1. Overview & Architecture

The Plan Catalog defines the purchasable lesson packages and verification plans available in Kottaby.

### Key Invariants

1. **INV-PC1 (Active Visibility & Purchase Gate):**
   - Deactivated plans (`isActive = false`) NEVER appear in the public student/parent/teacher catalog (`planCatalog` query).
   - Only active plans can be purchased (enforced at purchase time in `DEV1-006`).
2. **INV-PC2 (Forward-Only Lifecycle & Historical Immutability):**
   - Plan deactivation or forward-only price/session edits NEVER alter or invalidate existing subscriptions or credited balances.
3. **INV-PC3 (No Hard Deletion):**
   - Plan rows are never deleted from PostgreSQL (`DELETE` is prohibited). Deactivation sets `is_active = false` and `deactivated_at = NOW()`.

---

## 2. Data Model & Schema

Table: `plans` (PostgreSQL / Drizzle ORM)

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `serial` | No | Auto-inc | Primary key |
| `title` | `varchar(255)` | No | — | Plan display title (e.g. "Hifz Jadid") |
| `session_count` | `integer` | No | — | Number of lesson sessions included (`> 0`) |
| `price` | `numeric(10, 2)` | No | — | Cost in specified currency (`>= 0.00`) |
| `currency` | `varchar(10)` | No | `'EGP'` | Standard ISO currency code |
| `interval_days` | `integer` | No | `30` | Subscription validity duration (`> 0`) |
| `is_active` | `boolean` | No | `true` | Active status indicator |
| `deactivated_at` | `timestamp with time zone` | Yes | `null` | Timestamp when plan was deactivated |
| `created_at` | `timestamp with time zone` | No | `NOW()` | Creation timestamp |
| `updated_at` | `timestamp with time zone` | No | `NOW()` | Last modification timestamp |

---

## 3. State Transitions & Concurrency Safety

### Guarded Atomic Transitions (Decision D2)

Plan activation and deactivation use single-predicate guarded atomic SQL updates:

```sql
UPDATE plans
SET is_active = $1, deactivated_at = $2, updated_at = NOW()
WHERE id = $3 AND is_active = $4
RETURNING *;
```

- If target state matches current state (or record does not exist), 0 rows are updated, and the service returns a domain error (`PLAN_ALREADY_ACTIVE`, `PLAN_ALREADY_INACTIVE`, or `PLAN_NOT_FOUND`).
- Eliminates race conditions and TOCTOU concurrency bugs.

---

## 4. GraphQL Operations & Security

### Queries

- `planCatalog(includeInactive: Boolean)`:
  - Non-admin callers (students, parents, teachers) can only query active plans (`isActive = true`).
  - Admins can query active or all plans by passing `includeInactive: true`.
- `adminPlans(includeInactive: Boolean)`:
  - Restricted to Admins only (`authScopes: { role: [UserRole.Admin] }`).

### Mutations

- `createPlan(input: CreatePlanInput!)`: Admin only.
- `updatePlan(id: ID!, input: UpdatePlanInput!)`: Admin only (whitelisted fields: `title`, `sessionCount`, `price`, `currency`, `intervalDays`).
- `setPlanActiveStatus(id: ID!, isActive: Boolean!)`: Admin only.

---

## 5. Downstream Consumption Guidelines

- **DEV1-006 (Subscription Checkout):**
  - Always re-validate `plan.isActive === true` inside checkout transactions before charging or provisioning subscriptions.
- **DEV2-005 (Teacher Verification):**
  - Look up verification plan by title: `"New Teacher Verification & Evaluation Plan"` (`sessionCount = 5`).
- **DEV1-009 (Ledger & Invoicing):**
  - Compose `PlanRepository.findById(id, tx)` directly within billing transactions.
---

## 6. Security Rulings (post-implementation review)

These rulings were recorded during the DEV1-005 implementation review and are
binding for all downstream tickets touching this surface.

### REQ-030 — scope-auth shape (SECURITY)

The REQ-030 spec text literally prescribed `authScopes: { authenticated: true, role: [UserRole.Admin] }`.
That literal shape is **UNSAFE** with the pothos scope-auth plugin's default
strategy (`"any"` = OR across scope keys): the composite reads
`authenticated OR admin`, so **any authenticated account (student, parent,
teacher) passes the `authenticated` key and may create/update/flip plans**.
An E2E probe confirmed a STUDENT token successfully calling `createPlan`
under the literal shape.

**Ruling:** admin plan surfaces use `authScopes: { role: [UserRole.Admin] }`
ONLY. The `role` scope already fails closed for anonymous callers (the
builder's role scope throws the localized `UnauthorizedError` -> 401) and
requires the exact admin role for everyone else (403 otherwise). The literal
composite shape must not be reintroduced.

**Platform suggestion (pending DEV2-002 owner ack):** set
`scopeAuth.defaultStrategy: "all"` builder-wide so a future composite scope
fails closed by default instead of open.

### REQ-050 — error-code taxonomy

Plan domain failures use the fixed `PLAN_*` codes carried by the shared
errors namespace (`PLAN_NOT_FOUND`, `PLAN_ALREADY_ACTIVE`,
`PLAN_ALREADY_INACTIVE`, `PLAN_TITLE_*`, `PLAN_PRICE_INVALID`,
`PLAN_CURRENCY_INVALID`, `PLAN_INTERVAL_DAYS_INVALID`, `PLAN_PATCH_EMPTY`).
Ad-hoc per-row "custom codes" outside this taxonomy are forbidden — they
would bypass the code->label parity tests and the client error map.

### REQ-060 — timestamps serialize as strings

`deactivatedAt` / `createdAt` / `updatedAt` are exposed as ISO-8601 **String**
GraphQL fields (resolved via `.toISOString()`), not a `DateTime` scalar —
matching the wire contract consumed by the locale-aware formatting layer.

### Field bounds (defense in depth)

`sessionCount >= 1`, `intervalDays >= 1` and `price` as a non-negative decimal
with at most 2 fraction digits are enforced by DB CHECK constraints AND by
service-layer validation. Client-side bounds (form dialogs) exist for UX only
and are never trusted by the server.

### Localized 401 boundary

The builder's scope layer now resolves `UnauthorizedError` messages from the
`errors` locale namespace (`unauthorized` label) instead of a hardcoded
string — 401 copy follows the caller's locale like every other domain
message.
