# State Machine Invariant Verification — Reference Documentation

**Domain:** Testing infrastructure — state-machine invariants across sessions, verification, availability, billing, wallet, account governance, parents, payments, homework, progress, evaluations, and the plan catalog
**Lifecycle Status:** Active

---

## 1. Why — A Census-Enforced Invariant Registry

Kottaby documents its state-machine invariants canonically in
`docs/specs/state-machine-invariants.md` — 67 `INV-*` invariant IDs across 12 state machines.
A doc claim of "every invariant is tested" is cheap; this system makes it a **CI-enforced
bijection** between three surfaces:

1. **The canonical doc** — `docs/specs/state-machine-invariants.md` (the 67-ID source of truth).
2. **The census catalog module** — `backend/db/test/logic/invariants/invariant-census.catalog.ts`
   (typed data, one row per invariant, binding each row to its named test(s)).
3. **The named tests themselves** — the files the census binds, spread across the repo's four
   test layers (db repo/logic, services, journeys, wire).

The co-located **drift oracle**
(`backend/db/test/logic/invariants/invariant-census-drift.test.ts`) walks every row and every
binding in a pure file-scan (zero DB, order-of-milliseconds) and fails CI on any drift in either
direction. The oracle is the sibling of the financial-safety verification suite documented in
`docs/billing/financial-safety-verification.md` — that doc owns the adversarial financial probes;
this doc owns the doc↔census↔test bijection that makes *any* invariant's proof non-removable.

Key properties of the shipped system:

- **Every one of the 67 documented invariants is bound to at least one named test** whose file
  exists on disk and whose title is greppable in that file's content.
- **A binding is the final home.** Renaming or deleting a bound test fails CI until the census
  row is updated in the same change — a proof can never silently disappear.
- **An unbound doc row fails CI.** Adding an invariant to the doc without a census row (or vice
  versa) breaks the bijection tests.
- **Red is the mechanism, not a bug.** A census row whose named test has not landed yet keeps the
  oracle red by design (see §4) — the row can never silently lose its planned proof.

---

## 2. The Census — The 67-Row Registry

### 2.1 Census model

The census catalog module exports the row types every consumer programs against:

| Export | Meaning |
|---|---|
| `InvariantMachine` | The 12 machine keys: `S`, `TV`, `A`, `B`, `W`, `U`, `P`, `PAY`, `HW`, `PR`, `E`, `PC` |
| `InvariantVerdict` | `COVERED` / `PARTIAL` / `GAP` — the coverage verdict at census-authoring time |
| `InvariantDisposition` | `VERIFY-BY-REFERENCE` / `EXTEND` / `NEW-PROBE` / `PIN-APP-LAYER+DOC-DRIFT` |
| `InvariantCensusBinding` | `{ testPath, testName, tier? }` — one named test (see §2.3) |
| `InvariantCensusEntry` | One invariant row: `id`, `machine`, `docLine`, `statement`, `enforcementTier`, `verdict`, `disposition`, optional `docDrift` / `ledgerRef` / `notes`, and `bindings` (≥1) |
| `INVARIANT_CENSUS` | The registry grouped by machine key |
| `CENSUS_ROWS` | The flat view — exactly 67 rows |
| `CENSUS_DOC_PATH` | `"docs/specs/state-machine-invariants.md"` — what the oracle parses |

The module is a plain `.catalog.ts` file — **not** a `*.test.ts` — so the db test runner glob
never executes it as a test; it is data consumed by the drift oracle.

### 2.2 Registry totals (pinned by the oracle)

| Metric | Value |
|---|---|
| Total rows | 67 |
| Machine keys | 12 — S 8 · TV 7 · A 4 · B 8 · W 8 · U 5 · P 4 · PAY 7 · HW 4 · PR 3 · E 6 · PC 3 |
| Verdicts | 45 COVERED · 18 PARTIAL · 4 GAP (INV-TV7, INV-U1, INV-PAY1, INV-E6) |
| Dispositions | 32 VERIFY-BY-REFERENCE · 24 EXTEND · 5 NEW-PROBE · 6 PIN-APP-LAYER+DOC-DRIFT |
| `docDrift` rows | 16 — the rows whose shipped semantics differ from the doc wording (annotated on the doc, never silently rewritten) |
| `ledgerRef` rows | 7 — the 6 PIN rows plus INV-TV7 (a NEW-PROBE row that also carries a hardening-ticket pointer) |

### 2.3 Row and binding contract

- **`id`** — the doc's `INV-<MACHINE><n>` token. The oracle extracts every `INV-[A-Z]+\d+` token
  from the doc and asserts **set-equality in both directions**: a doc ID missing from the census
  fails; a census ID missing from the doc fails.
- **`bindings[].testPath`** — a **repo-root-relative POSIX path** of the bound test file. The
  oracle resolves it against the repo root and asserts the file exists on disk. Path-escape
  (`../`) and absolute paths are rejected as unsafe and never read.
- **`bindings[].testName`** — a **verbatim title fragment** of a `test(...)` / `describe(...)`
  inside that file. The oracle asserts the fragment is greppable in the file's content
  (`content.includes(testName)`). Bindings deliberately carry title *fragments*, never
  `path:line` cites — lines drift, titles are the contract.
- **`enforcementTier` / `tier`** — free-text tier labels (DB CHECK, TRIGGER, SCHEMA, STATIC,
  REPO, SVC, JRN, SDL, wire, route) describing where enforcement lives.
- **`docDrift`** — present on exactly the 16 rows with doc-vs-shipped drift; carries the drift
  text that the doc's amendment annotations (`✅ AMENDED` / `✅ IMPLEMENTED` /
  `KNOWN-UNIMPLEMENTED` glyphs) record. Tests always pin **shipped** semantics, never doc
  wording; the doc is annotated, never silently rewritten.
- **`ledgerRef`** — a `D-4xx` ID that must appear as a live row in the deferred-items ledger
  (the verification program's hardening-ticket pointers). The oracle rejects a dead pointer.
- **`docLine`** — metadata only (the statement row's line at authoring time). The oracle
  deliberately does **not** assert it — doc annotations reflow lines; the bijection is ID-set
  based.

### 2.4 Dispositions — what each row's verification strategy means

| Disposition | Count | Meaning |
|---|---|---|
| `VERIFY-BY-REFERENCE` | 32 | An existing named test already proves the invariant; the census binds it. Sibling suites are cited, never forked — **no assertion may exist in two files**. |
| `EXTEND` | 24 | An existing suite gains the named assertion(s); the census binds the extension. |
| `NEW-PROBE` | 5 | A new test file / journey / wire suite is authored for the row. |
| `PIN-APP-LAYER+DOC-DRIFT` | 6 | No DB-level enforcement exists (or the shipped semantics differ from the doc); tests pin the app-layer behavior that IS shipped, and the `ledgerRef` points at the future schema-hardening ticket. See §5. |

### 2.5 The 67-row registry (condensed)

Legend: **V** = verdict (C = COVERED, P = PARTIAL, G = GAP) · **D** = disposition
(VBR = VERIFY-BY-REFERENCE, EXT = EXTEND, NEW = NEW-PROBE, PIN = PIN-APP-LAYER+DOC-DRIFT).
`†` marks a `docDrift` row.

**S — Session lifecycle (8)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-S1 | `completed` is terminal — no transition back to started/scheduled | SVC matrix · REPO · JRN | C | VBR |
| INV-S2 | `cancelled` is terminal — no transition to any other state | SVC · REPO · JRN | C | EXT |
| INV-S3 | Earning ledger row only on completed AND student confirm (dual confirmation) | SVC · REPO | C | VBR |
| INV-S4 | A session row requires both parties (NOT NULL) | SCHEMA | C | VBR |
| INV-S5 | Booking requires a certified Sheikh at creation time | SVC · REPO | C | VBR |
| INV-S6 | In-session lock: `is_online = false` while a session is started | SVC · REPO · JRN | C | VBR |
| INV-S7 | Reports only submit for completed sessions | SVC | C | VBR |
| INV-S8 | Homework only via session-report submission (single composition) | SVC · SCHEMA | P | EXT |

Two documented off-matrix amendments exist (`sweepExpiredCompletedOnce` completed→cancelled;
`openPostConfirmationDisputeOnce` completed→disputed) and are whitelisted, never defects.

**TV — Teacher verification (7)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-TV1 | Certification requires 5 passing sessions with distinct certified Shuyukh, or admin cold-start | SVC · REPO · JRN | C | VBR |
| INV-TV2 | The 5 evaluators are distinct per cycle | SVC · REPO · JRN | C | VBR |
| INV-TV3 | Cooldown must fully expire before re-purchase | SVC | C | VBR |
| INV-TV4 † | Tajweed cooldown 30 days / Hifz 90 days (pinned constants; state on `applicants.cooldown_until`) | SVC · REPO · JRN | C | EXT |
| INV-TV5 | Admin override can supersede aggregation in any direction | SVC · JRN | C | VBR |
| INV-TV6 | Converted failed applicants retain student privileges during cooldown | SVC · JRN | C | VBR |
| INV-TV7 † | `teacher_verification.tajweed_level`/`hifz_level` — schema contract only; no producer exists | SCHEMA only | G | NEW |

**A — Teacher availability (4)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-A1 | Only certified teachers can set status Available | SVC · REPO · JRN · wire | C | EXT |
| INV-A2 | `is_online = false` while in an active session — no writer can bypass | SVC · REPO · JRN · wire | C | EXT |
| INV-A3 † | In-session teachers hidden from the student browse directory (`browseAvailableTeachers`) | REPO compose-rule · JRN · wire | C | NEW |
| INV-A4 † | Post-session restore is marker-gated (never activity-conditioned); sweep re-offlines stale teachers | REPO marker · JRN | C | EXT |

**B — Student balance & subscription (8)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-B1 | Balance lanes are non-negative (DB CHECKs) | DB CHECK | C | VBR |
| INV-B2 | Plan session count credited immediately on activation | SVC · REPO | C | VBR |
| INV-B3 | Unused sessions expire at window end; trial lane exempt | SVC · REPO · JRN · cron | C | EXT |
| INV-B4 | Zero balance ⇒ booking denied; trial lane extends eligibility | SVC · JRN | C | VBR |
| INV-B5 † | Lane segregation; the reviews lane is credit-only (no decrement surface exists) | REPO frozen map | P | PIN |
| INV-B6 | Admin can extend validity windows | SVC · JRN | C | VBR |
| INV-B7 | Trial granted at most once (`trial_granted_at` arbiter) | REPO · SVC | C | VBR |
| INV-B8 | Trial lane debited before any paid intent lane | SVC · JRN | C | EXT |

**W — Wallet & teacher ledger (8)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-W1 | `wallet.balance >= 0` (DB CHECK) | DB CHECK · REPO | C | VBR |
| INV-W2 | `wallet.total_earning >= 0` (DB CHECK) | DB CHECK | C | VBR |
| INV-W3 | Exactly one wallet per teacher (unique) | DB UNIQUE · REPO | P | EXT |
| INV-W4 | Earning row only on dual confirmation | SVC · JRN | C | EXT |
| INV-W5 | Withdrawal pending → completed/failed; guarded settlement + amended immutability trigger | REPO · SVC · TRIGGER · JRN | P | EXT |
| INV-W6 | Financial records immutable; corrections via adjustment rows only | TRIGGER · REPO · JRN | C | VBR |
| INV-W7 † | Earning rows linked to a session (signature-level; no DB CHECK exists) | REPO signature | P | PIN |
| INV-W8 † | `teacher_transaction.amount > 0` (shipped CHECK is stricter than the doc's `>= 0`) | DB CHECK | C | VBR |

**U — User account governance (5)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-U1 | Soft-deleted student's history (sessions/reports/payments) preserved | REPO guarded-UPDATE · FK | G | NEW |
| INV-U2 † | Suspended students cannot book — even a LAPSED suspension (raw-boolean guard, stricter than login) | SVC | C | EXT |
| INV-U3 | Blocked students cannot access the platform (login/refresh) | SVC | P | EXT |
| INV-U4 † | No user/student/teacher record can be hard-deleted (grep-lock + FK restrict) | STATIC grep-lock · FK | C | PIN |
| INV-U5 | Balance lanes preserved across every governance transition | REPO (SET clauses exclude lanes) | P | NEW |

**P — Parent–child link (4)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-P1 | Monitoring requires the child's explicit link confirmation | REPO · SVC · JRN · chaos | C | VBR |
| INV-P2 | Parent access is strictly read-only (SDL mutation freeze) | SDL · SVC · JRN | C | VBR |
| INV-P3 | Parent notified on completion — the producer is REPORT SUBMISSION, not the completed flip | SVC · JRN | C | EXT |
| INV-P4 † | Link model: `students.parent_id` FK + `handshake_code` | SCHEMA · REPO | C | VBR |

**PAY — Payments (7)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-PAY1 † | `student_payments.amount > 0` (shipped CHECK is stricter than the doc's `>= 0`) | DB CHECK | G | EXT |
| INV-PAY2 | Payment records immutable (guarded pending→paid/failed is the single exception) | TRIGGER | C | VBR |
| INV-PAY3 | Subscription activated only on paid status | SVC | C | VBR |
| INV-PAY4 † | `payment_gateway` NOT NULL pgEnum — 9 shipped values | SCHEMA pgEnum | P | EXT |
| INV-PAY5 | Admin offline onboarding bypasses the ledger; audit on subscription columns | SVC | C | VBR |
| INV-PAY6 | Exactly one pending→paid activation per subscription (guarded UPDATE arbiter) | REPO · SVC · JRN · route | C | VBR |
| INV-PAY7 | Amount/currency-mismatched callbacks quarantined: zero mutation, bounded log, 200 processed:false | SVC · route · JRN | C | VBR |

**HW — Homework (4)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-HW1 | Homework linked to exactly one session (NOT NULL + FK cascade) | SCHEMA | P | EXT |
| INV-HW2 | Grades 0–100 (DB CHECKs) | DB CHECK · SVC guard | P | EXT |
| INV-HW3 | First session: assignment only, no prior homework to grade | SVC composition | C | VBR |
| INV-HW4 | Subsequent sessions grade the previous session's homework | SVC · REPO · JRN | C | EXT |

**PR — Progress & lessons (3)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-PR1 | Progress links student (and optionally lesson) via FKs | SCHEMA | P | EXT |
| INV-PR2 | Progress increments on completed Tajweed sessions | SVC · JRN | C | VBR |
| INV-PR3 † | Lessons belong to plans — enforced at the service write surface; `plan_id` nullable by design | SVC gate | P | EXT |

**E — Evaluations (6)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-E1 | `evaluations.score` 0–100 (DB CHECK) | DB CHECK · SVC guard | P | EXT |
| INV-E2 † | Evaluations soft-deletable, never hard-deleted (surface absence only) | REPO read-exclusion | P | PIN |
| INV-E3 | Evaluated + evaluator user links; optional session (set-null survival) | SCHEMA | P | EXT |
| INV-E4 | Teacher evaluations update `average_rating` (0–5 clamp) | SVC · REPO · JRN · wire | C | VBR |
| INV-E5 | Student evaluation aggregates via the academic-tracking composite | SVC (academic tracking) | P | EXT |
| INV-E6 † | Permanent retention for disputes/re-evaluations (no guard; set-null survival is the testable core) | set-null design + U4 transitivity | G | PIN |

**PC — Plan catalog (3)**

| ID | Invariant (abridged) | Tier | V | D |
|---|---|---|---|---|
| INV-PC1 | Deactivated plans never in the public catalog; not purchasable | REPO · SVC · SDL | C | VBR |
| INV-PC2 | Deactivation/edits never alter existing subscriptions or credited balances | SVC zero-coupling | P | NEW |
| INV-PC3 † | Plan rows never hard-deleted (writer absence; subscriptions restrict-FK backstop) | SDL · writer-absence | P | PIN |

**Shared homes (one test, two rows — never fork):** the static `sessionId.notNull` pin is bound
by both INV-S8 and INV-HW1; the committed set-null survival pin is bound by both INV-E3 and
INV-E6; the wallet CHECK-probe test is bound by INV-W1/W2/W8; the `markPaidOnce` transition test
is bound by INV-PAY2/PAY6.

---

## 3. The Drift Oracle — Mechanics

`backend/db/test/logic/invariants/invariant-census-drift.test.ts` — a pure file-scan, zero-DB
oracle (87 tests) with five tiers:

1. **Doc extraction** — read `CENSUS_DOC_PATH`, extract every `INV-[A-Z]+\d+` token into a set,
   with a corpus-sanity floor (≥ 60 unique IDs): a broken scanner can never fake green.
2. **Both-direction bijection** — doc ID set vs census ID set, sorted diffs in both directions.
3. **Completeness oracle** — pinned totals: exactly 67 rows, all 12 machine keys, the per-machine
   split, verdict tallies (45/18/4), disposition tallies (32/24/5/6), the 16 `docDrift` rows, ≥1
   binding per row, every row under its declared machine key.
4. **Binding resolution** — for every row × every binding: `testPath` exists on disk AND
   `testName` greppable in that file. Each failure carries a one-line human diagnosis
   (`missing-file` / `name-not-found` / `unsafe-path`).
5. **Negative self-tests** — permanent, passing *because detection fires*: an injected fake doc
   ID produces exactly `missingFromCensus: ["INV-ZZ9"]`; a phantom census ID produces
   `missingFromDoc`; a phantom citation on an existing file produces `name-not-found`; a
   nonexistent file produces `missing-file`; `../`-escapes and absolute paths produce
   `unsafe-path` (never read); a dead ledger pointer (`D-999`) is rejected while live PIN refs
   are accepted.

Run it:

```bash
bun run test/scripts/run-test.ts backend/db/test/logic/invariants/invariant-census-drift.test.ts
```

### The red-on-drift proof

Redness is not assumed — it is proven two ways:

- **In-file negative self-tests** (tier 5 above) run in every execution.
- **Out-of-band injection**: a fake census row (`INV-ZZ9`) whose binding points at a real file
  with a phantom citation turns the oracle red on 9 tests — the bijection both ways, every
  pinned total, and the binding-resolution diagnosis naming the exact phantom string — and
  reverting the injection restores full green byte-identically. The oracle demonstrably cannot
  silently absorb a fake invariant row or a dead citation.

### Red-by-design: planned bindings

A census row may legitimately be authored *before* its test exists (the binding carries the
planned `testName`). The oracle is **unconditionally red** on such rows — there is no skip list,
no pending flag, and no weakening. This is the anti-drift mechanism: the moment a planned
binding is missing after its owning change was supposed to land, CI is red.

**How a planned binding turns green:** land the test with the census binding's exact `testName`
(or a title containing it — substring match) at the bound `testPath`, **or** update the census
row's binding to the final landed name in the same change. The binding is the final home.

**When reality proves a planned name false, the binding follows reality.** Precedent (proven
twice against the live test DB): a referenced-row DELETE under an `ON DELETE RESTRICT` foreign
key raises SQLSTATE **23001 `restrict_violation`** — not 23503 `foreign_key_violation` (which
fires for plain FK mismatches on insert/update). Two planned binding titles asserted "raises
23503" and were corrected to the landed titles asserting 23001
(`subscriptions_plan_id_plans_id_fkey` on INV-PC3; `session_student_id_users_id_fkey` on the
INV-U4 backstop — the sessions FK also re-points at `users.id`, not `students.id`). Tests pin
shipped semantics, never doc wording.

---

## 4. The PIN-APP-LAYER Doctrine

Six rows carry the `PIN-APP-LAYER+DOC-DRIFT` disposition: the invariant as documented has **no
DB-level enforcement** (or its enforcement is deliberately elsewhere). The honest coverage is a
test that pins the app-layer behavior that actually ships, plus a `ledgerRef` pointing at the
deferred-items ledger's future hardening ticket. A fabricated DB-tier rejection probe for these
rows would pass today and is **forbidden** — it would prove nothing.

| Row | What is actually enforced | Test pin (binding home) | Ledger pointer |
|---|---|---|---|
| INV-B5 | Lane segregation implemented for trial/hifz/tajweed only — `HeldBalanceLane` has no `Reviews` member and no decrement writer exists; the reviews lane is credit-only | Enum-vocabulary + frozen-map absence pin in `backend/db/repo/students/__tests__/student-lane-debit.test.ts` | D-406 |
| INV-W7 | Earning rows carry a session link via the `creditEarningOnce` **required signature** — the column is a plain nullable FK, no CHECK exists | Signature pin in `backend/db/test/repo/billing/wallet.repository.test.ts` | D-402 |
| INV-U4 | No `prevent_users_delete` trigger — the repo-wide **grep-lock** (`backend/graphql/test/inv-u4-grep-lock.test.ts`) is THE enforcement, with FK ON DELETE RESTRICT as the runtime backstop; an unreferenced-user raw DELETE succeeds (documented accepted boundary) | Grep-lock + savepoint-bracketed referenced-DELETE (23001) probe in `backend/db/test/logic/students/student_status_history.test.ts` | D-404 |
| INV-E2 | No `prevent_evaluations_delete` trigger — "not hard-deleted" holds only by writer-surface absence (the repository exposes no delete method; teardowns hard-delete successfully) | Surface-absence source pins in `backend/db/test/repo/teachers/evaluation.repository.test.ts` | D-403 |
| INV-E6 | No retention guard — the testable core is set-null survival (a session hard-delete leaves the evaluation row with `session_id` null) | The committed set-null survival pin (shared home with INV-E3) | D-403 |
| INV-PC3 | No `prevent_plans_delete` trigger — `PlanRepository` exposes no delete method; only the subscriptions restrict-FK backstops referenced plans; unreferenced DELETE succeeds (documented accepted boundary) | Namespace/source pins + restrict-FK probe in `backend/db/test/logic/invariants/plan-catalog-invariants.test.ts` | D-405 |

Two further hardening pointers complete the doctrine's ticket trail:

- **INV-TV7 → D-401** — `teacher_verification` has no runtime producer; weakness levels actually
  live in `evaluations.weakness_area`. The row's coverage is the honest schema-contract probe
  (nullable varchar(50) columns, teacher FK, round-trip), and the doc carries a
  `KNOWN-UNIMPLEMENTED` annotation.
- **Session-status trigger option → D-408** — `session.status` has **no DB trigger**; terminality
  (INV-S1/S2) is enforced by guarded-UPDATE predicates plus the application-side transition
  matrix only. The journey sweep cells in
  `test/workflows/sessions/session-state-machine.journey.test.ts` pin that shipped tier at the
  service level (every off-matrix transition denied with zero writes). A DB-trigger hardening
  of session terminality remains an open, deliberately-not-built option recorded in the ledger.
- **Duplicate-earning unique index → D-407** — no unique index exists per (session, earning); the
  shipped no-credit-without-confirm proof is compositional: the arbitration-Complete oracle in
  `backend/services/classes/session-lifecycle.service.test.ts` (wallet never ensured,
  `confirmedByStudentAt` null, zero session-linked ledger rows).

PIN-row tests are green *documented-reality* pins. The absence they document is carried by the
census `docDrift` field, the doc's amendment annotations, and the ledger's future-ticket pointers
— never by weakening an assertion.

---

## 5. Probe Recipes — The Shared Probe Helper

`backend/db/test/logic/invariants/invariant-probe.helpers.ts` is the ONE canonical
savepoint/constraint/trigger scaffold for DB-tier invariant probes. Consumers import
`runInRollback` / `expectRepoError` from `@/backend/db/test/test-utils` directly (no re-export
shims).

### 5.1 API

```ts
export async function probeInsideSavepoint(
  tx: DBTransaction,
  label: string,
  probe: () => Promise<unknown>
): Promise<Error>;

export function expectCheckViolation(error: Error, constraintName: string): void;   // 23514
export function expectUniqueViolation(error: Error, constraintName: string): void;  // 23505
export function expectFkViolation(error: Error, constraintName: string): void;       // 23503
export function expectNotNullViolation(error: Error, columnFragment: string): void;  // 23502
export function expectEnumViolation(error: Error, enumFragment: string): void;        // 22P02
export function expectTriggerRaise(error: Error, raiseText: string): void;           // exact RAISE text
```

- `probeInsideSavepoint` opens `savepoint inv_<sanitized label>`, runs the probe under
  try/catch, and executes `rollback to savepoint` in a `finally` — **the savepoint is rolled
  back also when the probe succeeds**, so probe writes never leak into the outer `runInRollback`
  transaction and a failed statement leaves it fully queryable for read-back assertions.
- It **throws** when the probe resolves without failing — a probe that violates nothing is a
  broken probe, not a green test.
- The label is sanitized to a SQL identifier (savepoint names are identifiers, not bind
  parameters).
- The named-constraint expectors assert THREE things: the SQLSTATE in the cause chain,
  `constraintNameOf(error) === constraintName`, and the name present in the joined cause-chain
  text — so an aborted-transaction `25P02` error can never satisfy them.
- `expectTriggerRaise` matches the raised text only (immutability triggers use custom
  SQLSTATEs); assert the exact DDL RAISE substring.

### 5.2 Canonical CHECK-probe pattern

```ts
import { runInRollback } from "@/backend/db/test/test-utils";
import { probeInsideSavepoint, expectCheckViolation } from
  "@/backend/db/test/logic/invariants/invariant-probe.helpers";

await runInRollback(async tx => {
  const fixture = await createTestWallet(tx, teacherId, { balance: "10.00" });
  const error = await probeInsideSavepoint(tx, "wallet balance probe", () =>
    tx.update(wallet).set({ balance: "-1.00" }).where(eq(wallet.id, fixture.id))
  );
  expectCheckViolation(error, "wallet_balance_check");
  const [after] = await tx.select().from(wallet).where(eq(wallet.id, fixture.id)).limit(1);
  expect(after.balance).toBe("10.00"); // outer tx still queryable — row byte-identical
});
```

### 5.3 Usage rules (load-bearing)

1. **Succeed-then-rollback legs must NOT use `probeInsideSavepoint`.** The helper throws on a
   resolving probe. Legs that legitimately succeed and then roll back (an unreferenced-plan
   DELETE, a legal `lesson_id = NULL` row, an orphan-detector insert that must land to prove the
   sweep counts it) run plain statements inside `runInRollback` — or on committed fixtures when
   the behavior is only observable post-commit (set-null survival).
2. **RESTRICT deletes raise 23001, not 23503.** `expectFkViolation` (23503-hardcoded) fits
   insert/update-side FK violations. A referenced-row DELETE under `ON DELETE RESTRICT` raises
   SQLSTATE 23001 (`restrict_violation`) — compose `hasPostgresErrorCode(error, "23001")` +
   `constraintNameOf` directly (the shared helper currently has no 23001 expector).
3. **Verify the live constraint name from the error.** Drizzle generates single-column FK names
   as `{table}_{column}_{referencedTable}_{referencedColumn}_fkey`; hand-abbreviated names from
   docs or research notes are not always the generated ones.
4. **Every statement inside the probe body uses the same `tx`** — mixing `tx` and `db`
   deadlocks.
5. **Never `expect(...).rejects.toThrow()` inside `runInRollback`** — it deadlocks. All
   negative legs are try/catch-based (the probe helper, or `expectRepoError`).
6. **Trigger-arm isolation discipline**: a single-guard IF raises on the FIRST failed arm. To
   prove a *named* frozen-column arm, the probe must present an otherwise-valid settlement shape
   with only that column tampered (the `wallet.repository.admin.test.ts` settlement pattern) —
   a bare column rewrite would raise via the status arm and prove nothing about the named column.
7. **Trigger tiers are pglite-gated** (`describeTriggerTier` / `isPgliteProvider()`): probes must
   never fail because of a runtime capability gap; on PGlite the tier skips loudly, on real
   PostgreSQL it runs. CHECK/enum probes stay ungated — no trigger is involved.
8. **Closed-set pgEnum pin idiom**: `select unnest(enum_range(null::<enum>))::text` compared
   with `toEqual(Object.values(<TsEnum>))` — order-sensitive, so a reordered, added, dropped, or
   renamed value on either the pgEnum or the TS side fails.
9. **Orphan ids are computed, not guessed**: `coalesce(max(id), 0)::int + 1_000_000` inside the
   caller's transaction, so probes can never collide with a parallel worker's committed row.

---

## 6. Test-Runner Discipline

- **DB-tier and service-tier files** run through the log-capture runner — never raw `bun test` on
  `backend/db/test/**` or `test/workflows/**`:

  ```bash
  bun run test/scripts/run-test.ts <test-path>
  ```

  The runner pins `DATABASE_URL` to the test DB (`--env-file=.env.test`) and captures per-file
  logs. Bare `bun -e` probes read the DEV database — residue probes must use
  `bun --env-file=.env.test`.
- **Wire tier** runs per-file via
  `bun run test/scripts/run-test.ts backend/graphql/test/<suite>.test.ts` — **never**
  `bun run test:graphql`, whose glob only discovers `frontend/graphql/test/**` and never
  executes `backend/graphql/test/**`.
- **Journey tier** (`test/workflows/`): committed fixtures with registry-tracked teardown, NO
  `runInRollback` (services own their top-level transactions — an outer rollback wrapper
  deadlocks or misses committed rows), honest roles (never monkey-patched authorization), denial
  assertions via try/catch + translated substrings from `getServerTranslations("en")`, spied
  notification dispatch, per-run UUID prefixes, and a Mermaid diagram section per journey in the
  domain's `DIAGRAMS.md` validated with `bun run validate:mermaid`. Full conventions:
  `docs/testing/workflow-journey-tests.md`.
- **Immutable-ledger teardown**: append-only tables (`student_payments`, `teacher_transaction`,
  `audit_logs`) are never hard-deleted by tracking — committed-fixture cleanup sweeps them under
  `withImmutabilityTriggersSuspended([...])` / `withAuditDeleteTriggersSuspended`, re-probing
  zero after each sweep, before the tracked registry teardown.

---

## 7. How to Add an Invariant

One rule keeps the oracle honest: **the registry, the doc, and the test land in the same change
— CI stays red until the binding passes.**

1. **Doc row** — add the invariant statement with a unique `INV-<MACHINE><n>` token to
   `docs/specs/state-machine-invariants.md`.
2. **Census row** — add an `InvariantCensusEntry` under the machine key with at least one
   binding (`testPath` + `testName`). Choose the disposition honestly:
   - an existing test already proves it → `VERIFY-BY-REFERENCE` (cite, never fork);
   - an existing suite should gain the assertion → `EXTEND`;
   - a new file/journey is needed → `NEW-PROBE`;
   - no DB-level enforcement exists → `PIN-APP-LAYER+DOC-DRIFT` with a `ledgerRef` (open the
     ledger row) and a `docDrift` annotation on the doc row.
3. **Update the pinned totals in the oracle** in the same change — the completeness tier
   hard-asserts 67 rows, the per-machine split, and the verdict/disposition tallies; a
   legitimate new row must move those `EXPECTED_*` constants or CI fails (by design — stale pins
   are how counts rot).
4. **Land the test under the binding name** — the row's oracle test flips green automatically on
   the next run (substring grep). If reality proves the planned `testName` false while landing
   (see the 23001/23503 precedent), update the binding to the final landed name in the same
   change.
5. **Never delete a binding without replacing it**, and never rename a bound test title without
   updating its census row — the oracle greps the exact substrings.

Renaming/removing a test without touching the census gives an immediate, diagnosable CI failure
naming the row and the exact missing fragment. That is the system working.

---

## 8. Known Environmental Hazards

Pre-existing, diagnosed, and ledgered — none is an enforcement defect; all have future-ticket
pointers. Attribution discipline: verify against a per-file isolation run before blaming a
suite.

| ID | Hazard | Symptom | Handling |
|---|---|---|---|
| **D-413** | The two `audit_logs` immutability triggers are persistently **DISABLED** (`pg_trigger.tgenabled = 'D'`) in the shared migrate-provisioned `kottaby_test` DB — a stale leak from an interrupted trigger-suspension sweep; the shipped DDL installs them enabled (dev DB verified) | 3 audit_logs-tier reds in `backend/db/test/logic/billing/financial-immutability.test.ts` | Probe `pg_trigger.tgenabled` first (`'D'` = this leak). Do NOT re-enable mid-flight — sibling suites hold live suspension windows against the same DB, and an ENABLE racing their teardown would corrupt their sweeps. Future ticket: crash-safe re-enable or a provisioning health-check that fails fast on disabled immutability triggers |
| **D-414** | DEV `.env` `ADMIN_EMAIL`/`ADMIN_PASSWORD` leak into every `bun run`-mediated test process; the test DB's seeded admin carries the fallback password, so seeded-admin logins fail UNAUTHORIZED locally | 4 wire-tier seeded-admin login reds | Environmental (CI resolves the fallback credential correctly). Future ticket: extend the runner's dev-leak strip list AND define the pair in `.env.test` (or re-seed) — either half alone breaks the suites differently |
| **D-415** | `closePool()` in the `afterAll` of `backend/graphql/test/admin-session-governance.mutation.test.ts` (and `.query.test.ts`) ends the process-wide shared pg pool mid-`bun test` — every DB-touching wire file scheduled after it dies with `Cannot use a pool after calling end on the pool` | 63 positional wire-tier reds | The victim suites are individually green (isolation-proved). Future ticket: remove/condition the two `closePool()` calls or give those suites a dedicated pool |

**Stale-fixture sweep lessons** (one-token fixes that revived whole suites):

- **Country values on registration/admin create paths must be ISO 3166-1 alpha-2** —
  `"EG"`, never `"Egypt"`; the `validateCreateInput` gate rejects display names with
  `COUNTRY_CODE_INVALID`. Direct-write fixtures carrying a display name alongside a valid
  `countryCode` are inert and stay as-is.
- **Phone values must satisfy the shared E.164 bound (16 chars)** — a committed
  `"+[PHONE_REDACTED]"` literal (17 chars — a log-redaction artifact that leaked into a source
  file) failed the bound. Audit `[X_REDACTED]` placeholders in test/source trees: they belong
  in logs only.
- **Fixtures drift against shipped validators silently** — when a whole suite fails at
  `beforeAll`/step-2 with a generic `ValidationError`, probe the validator directly with the
  fixture's exact values before re-authoring anything.
- **`session.student_id` references `users.id`** (re-pointed away from `students.id`) with
  constraint `session_student_id_users_id_fkey` — session fixtures and residue queries key on
  the user id.

---

## 9. Anti-Patterns (what NOT to do)

- **Never weaken an assertion to force the oracle green.** A red row means the named test has not
  landed (or the binding is stale) — land the test or update the binding.
- **Never re-author a sibling-owned test.** Verify-by-reference rows cite their proof homes;
  no assertion may exist in two files.
- **Never fabricate a DB-tier rejection probe for a PIN row.** No guard exists there by design —
  the honest pin is the app-layer surface plus the ledger pointer.
- **Never `expect(...).rejects.toThrow()` inside `runInRollback`** (deadlocks) and never
  `getServerTranslations` inside DB-tier tests.
- **Never trust app-level "no setter" as enforcement by itself** — the DB trigger/CHECK is the
  guarantee where one exists; the API-surface pin is supplementary evidence (PIN rows are the
  documented exception where nothing DB-level exists).
- **Never hardcode English denial sentences** — assert translated substrings at the tier that
  owns the copy.
- **Never query seed data** — fixtures are self-provisioned via `entity-setup.ts` helpers
  (verify signatures before use).
- **Never use `path:line` cites as binding contracts** — titles are the contract; lines drift.
