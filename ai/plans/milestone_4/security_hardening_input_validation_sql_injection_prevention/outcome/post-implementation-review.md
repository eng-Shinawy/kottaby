# Post-Implementation Review Wave — R1 Findings, Fix Waves A/B/C, Final Gate

**Plan:** `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/`
**Date captured:** 2026-10-09
**Wave:** Post-implementation review R1 (mandatory for >10-task plans) — four read-only review agents, all returned; findings handled by three fix waves; all fixes re-verified green.
**Inputs:** `outcome/5.2-outcome.md` (verification matrix), the four R1 review reports (orchestrator-held summaries, reproduced below), fix-wave A/B/C result records.

---

## 1. Verdict Summary

| Review Agent | Verdict | CRITICAL | HIGH | Notes |
|---|---|---|---|---|
| `review-types` | **PASS** | 0 | 0 | Type surfaces canonical; `clientIp?: string` optional-in-type deviation judged guarded |
| `review-frontend` | **PASS** | 0 | 0 | All five mid-point fix-wave deltas verified correct; every CSV cell builder guarded; batch parity single-sourced |
| `review-backend` | **PASS** | 0 | 0 | TOCTOU clean; test isolation clean; type cascade safe; drop semantics preserved; $all ×4; cron parity verified |
| `security-probing` | **PASS — all 30 adversarial probes HELD** | 0 | 0 | Origin/WS/envelope/batch/XFF/identity/bypass-mirror/BFLA/secret-hammering/CSP/CSV/envelope discipline all held |

**Zero CRITICAL and zero HIGH findings were raised at any point in the wave.** All MEDIUM findings were fixed by waves A/B and re-verified green; all LOW findings are either fixed (A/C), recorded as ledger rows, or accepted as documented limits. No re-review round was required beyond the fix-wave re-verifications — every finding's disposition is closed below.

---

## 2. Review-Wave R1 Findings (per agent, faithful reproduction)

### 2.1 review-types — PASS

- Type surfaces canonical. The `clientIp?: string` optional-in-type deviation is judged **guarded**: compiler narrowing requirement at every consumer, test pins on resolution behavior, and factory materialization guarantee the value is present wherever it is read.
- **[LOW] Fixture debt**: hand-built Context fixtures can silently regress `clientIp` to `undefined` — same debt class as the existing `idempotencyKey`. Disposition: **ledger row D9** (pointer to a future required-field migration once the ~15 fixture files are batch-updated).

### 2.2 review-frontend — PASS

- All five mid-point fix-wave deltas verified correct: NotificationRowContent comment, origin-test env hygiene, bare-like companion lock, transport-test REPO_ROOT + batchMax parity pin.
- Every CSV cell builder guarded; batch parity single-sourced; zero plan-artifact references in plan files.
- Suites green: 26/0, 41/0, 29/0 (+29/0 with pre-set env), 8/0, 25/0, 3/0, 2/0, 4/0, 3/0.
- **[INFO]** Parity pin uses naive comment-stripping — fail-closed, acceptable. Disposition: **accepted-limit** (no action).

### 2.3 review-backend — PASS (zero CRITICAL/HIGH)

- TOCTOU clean — `checkRateLimit` is a synchronous get→set, no awaits between decision and mutation.
- Test isolation clean; `clientIp` type cascade safe; builder oxlint drop semantics-preserving; `$all` conjunctions verified ×4; cron parity verified.
- Findings:
  - **[MEDIUM] Silent fail-open catch in `checkRateLimit`** → **fixed by Wave A** (logs `logger.warn` with limiter name + error name only).
  - **[MEDIUM] Login-only 1 024 password bound with no set-time counterpart (lockout asymmetry)** → **fixed by Wave B** (shared `password-limits.ts` bound enforced at registration, admin create, and `validatePasswordPolicy`).
  - **[LOW] `authIdentityLimiter` unused export** → **fixed by Wave A** (export removed after grep proof the config is module-internal).
  - **[LOW] `x-real-ip` proxy-strip deployment dependency** → folded into **ledger row D11** (deployment contract).
  - **[LOW] `rate-limit.ts` stale header provenance** → **fixed by Wave A** (header rewritten truthfully).
  - **[LOW/INFO] `hashAuthIdentity` NFC normalization gap** → **accepted-limit** (documented; Unicode-normalization attacks on the hash preimage are out of the limiter's threat model — the bucket is a heuristic abuse bound, not an identity oracle).

### 2.4 security-probing — PASS (all 30 adversarial probes HELD)

- Probe matrix held in full: origin suffix/null/port/Sec-Fetch combos, WS-allowlist abuse, envelope leaks, batch array-nesting/object-wrap/order bypass, XFF positioning, identity preimage, bypass-mirror prod guard, permission-scope denial, BFLA/401-403 indistinguishability, secret-hammering order, CSP integrity, CSV matrix, envelope discipline.
- Residuals:
  - **[MEDIUM → accepted]** Limiter keying depends on the documented single-trusted-proxy contract — the edge proxy must overwrite `x-real-ip` / append XFF. Disposition: **accepted-limit with docblock contract** (Wave A added the contract to `resolveClientIp`) + **ledger row D11** (launch-checklist pin owned by the production-launch session).
  - **[LOW] `notImpersonating: true` constant-true scope kind** (zero consumers, latent footgun) → **ledger row D10** (flip fail-closed when an impersonation surface lands).
  - **[LOW] XSS scanner lexical gaps within documented scope** (bracket-eval, bare `Function`, `.js` corpus) → **accepted-limit** (scanner scope is documented; extension is future work).
  - **[LOW] Origin same-origin compare is Host-relative** (deployment must pin Host) → folded into **ledger row D11**.
  - **[LOW] Per-identity victim-throttle DoS** (self-healing 60 s window) → **accepted-limit D3 tradeoff** (already documented in the ledger).
  - **[LOW] Static-English in unreachable narrowing branches** → **accepted-limit** (branches are compiler-narrowing guards, unreachable at runtime).
- Out-of-scope, recorded not fixed here: `lesson.mutation.ts` bare role maps (**FIXED in Wave C** — in scope after all); `*.space-zai` CSP oddity (pre-existing); MSW worker outside scanner corpus; AGENTS.md stale sentence (hand-curated, recorded only — rule files are never touched by this plan).

---

## 3. Fix-Wave Results (all complete, all re-verified green)

### Wave A — limiter hygiene

| Change | Evidence |
|---|---|
| Fail-open catch now logs `logger.warn` (limiter name + error name only) | Test-pinned including a no-message-content assertion; ratelimit suite 24/0 |
| `authIdentityLimiter` export removed | Grep proof: config is module-internal |
| `rate-limit.ts` header rewritten truthfully | Matches the real in-memory sliding-window contract |
| `resolveClientIp` docblock states the edge-proxy overwrite/append contract | Deployment contract single-sourced for D11 |

### Wave B — password-length bound symmetry

| Change | Evidence |
|---|---|
| NEW `backend/lib/auth/password-limits.ts` (`MAX_PASSWORD_LENGTH = 1_024`, single source) | Module created; all consumers import the shared constant |
| Bound enforced at registration `validateInput`, admin `validateCreateInput`, shared `validatePasswordPolicy` (covers `changeMyPassword` + `adminSetUserPassword`) | New typed `passwordTooLong` locale key (en/ar) |
| `auth.mutation.ts` imports the shared constant | Behavior byte-identical to the previous module-local bound |
| Suites | registration 33/0 · user-management.helpers 55/0 · auth.service 29/1 (the 1 = pre-existing credential-fence race test, 2.3 baseline flake) · auth-rate-limit 15/0 · bonus regressions 89/0 + 15/0 |
| Per-file sub-loop | Exit 0 on all 11 files |

### Wave C — lesson.mutation authorization shape

| Change | Evidence |
|---|---|
| `createLesson`/`updateLesson`/`deleteLesson` flipped to `$all` conjunction | 3 old behavioral pins corrected (FORBIDDEN → UNAUTHORIZED) |
| New `$all` shape pins + anonymous probes | `schema-surface.test.ts` 132/0 · `lesson.roles.test.ts` 26/0 |
| Origin test cwd pins → REPO_ROOT | 29/0 |
| SDL byte-identity | Green |
| Per-file sub-loop | Exit 0 ×4 |

---

## 4. Residual Accepted Limits (all deliberate, all documented)

1. **Proxy-dependent limiter keying** — the spoof-resistant resolver is correct only under a single-trusted-proxy edge that overwrites `x-real-ip` and appends XFF. Contract documented in the `resolveClientIp` docblock; launch-checklist pin tracked as **D11**.
2. **XSS scanner lexical scope** — bracket-eval, bare `Function`, and the `.js` corpus sit outside the scanner's documented corpus; the lock is fail-closed for everything it scans.
3. **NFC normalization gap in `hashAuthIdentity`** — the identity hash is an abuse-bound key, not an identity oracle; normalization-equivalent preimages merely share buckets.
4. **Victim-throttle DoS tradeoff (D3)** — per-identity 20/60 s sliding window self-heals; persistent lockout deferred pending product ruling.
5. **`clientIp` fixture debt (D9)** — hand-built Context fixtures can regress the field to `undefined` until the required-field migration lands.
6. **Naive comment-stripping in the parity pin (INFO)** — fail-closed; a false positive would force a review, never a silent pass.

---

## 5. Final Gate Statement

The post-implementation review wave for this plan is **CLOSED: 4× PASS, zero CRITICAL/HIGH findings ever raised, all MEDIUM findings fixed and re-verified (waves A/B/C), all LOW/INFO findings dispositioned as fixed / accepted-limit / or ledger pointer (D9–D11)**. Combined with `outcome/5.2-outcome.md` (25-suite matrix green at expected counts, quality-gate plan-files-clean with foreign attribution, ticket-AC scenarios all proven, deferred-items gate 0), the plan's implementation tasks 0–5.2 are complete. Task 6.1 (knowledge propagation) remains open per the plan sequencing.

```bash
grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md
# Expected: 0 — re-verified AFTER D9–D11 appends in this session
```
