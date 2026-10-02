# Task 15 — Outcome: GraphQL wire test (auth domain)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 15 — GraphQL wire test — `frontend/graphql/test/auth/auth.test.ts` (REQ-6.3, REQ-9.1, REQ-9.3, REQ-9.4)
> **Date:** 2026-09-30 · **Worktree:** `/home/z/feat-wt` (branch `feat/no-phone-input-component`) · **Pipeline:** 15.QL → 15.TE → 15.SEC → 15.SR → 15.IV — all executed
> **Scope discipline:** verification/completion of the prior attempt's authored wire-test file — **zero production/SDL changes**, zero new documents, no codegen, no schema regen (D7).

## 1. Summary

The prior Task-15 attempt authored a complete 579-line extension of the auth wire suite and
exhausted its budget before verification. This completion run audited the file in full against
the binding task block, the helper/document/locale sources it consumes, and the sibling house
patterns — **found ZERO file defects** — then unblocked the test harness at the environment
level and ran all mandated gates green:

| Gate | Result |
|---|---|
| `bun run test:graphql frontend/graphql/test/auth/auth.test.ts` (mandated harness, file filter) | **✅ ALL TESTS PASSED — 24 pass / 0 fail, 95 expect() calls, 14.81 s** |
| 15.QL `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` | **exit 0** (tsgo stage vacuous — see §3; real type evidence = scoped tsgo 0 + negative control) |
| Scoped tsgo (outcome/3 §3 fallback) | **exit 0, ZERO diagnostics** over the full import closure |

## 2. What the prior attempt authored vs what this run did

**Authored (kept as-is, verified):** the 10 pre-existing auth tests preserved + a new
`phone validation surfaced at the wire` describe (10 tests) + a `phone schema surface` describe
(4 tests). House patterns honored: `setupTestServerLifecycle()` + `testClient` from
`@/test/helpers`; reused sharedDocuments (`auth.documents`, `admin/users.documents`) with NO
new documents; generated enums; typed builders passing ALL input fields (rule 11) —
`RegisterUserInput` 8/8, `AdminCreateUserInput` 7/7, `AdminUpdateUserInput` 5/5; tracked
`createdUserIds` cleanup via `deleteUsersByIds` + `countUsersByIds` zero-probe; structural
narrowing of `extensions.fields[]` mirroring the admin-users suite precedent.

**Verified before running (no edits needed):** `@/test/helpers` barrel exports; document
variable shapes vs generated types; locale keys (`authEn.phoneInvalid/phoneRequired`,
`errorsEn.validation`); `x-app-locale` is a real server header (`gqlContextFactory.ts`);
`expectMutationError` → `CombinedGraphQLErrors` contract; `insertAdminUserWithChildRow` →
`Promise<number>`; `describeGraphqlSuite` skip semantics. The `TEST_SERVER_EXTERNAL`
conditional is idempotent when unset (this run) and calls `setupTestServerLifecycle()` exactly
like sibling suites — left as-authored, documented.

**This run (no test-file edits; environment + verification only):**
- First harness run died after 180 s — `logs/next-dev-server-3066.log` shows a **Turbopack
  panic**: `Symlink [project]/node_modules is invalid, it points out of the filesystem root`
  (feat-wt's `node_modules` was a symlink → `/home/z/my-project/node_modules`, outside the
  Turbopack project root). Fixed in the sandbox only: replaced the symlink with a **hardlink
  copy** (`cp -al`, zero extra disk, no git write, no tracked path affected).
- A webpack fallback server (`next dev --webpack`) was tried first and abandoned: webpack
  fails `instrumentation.ts:35` — `Module not found` for the `callback-channel.factory`
  dynamic import (module exists; Turbopack-only resolution). Recorded, not chased.

## 3. Verification results

### 15.TE — mandated runner

`bun run test:graphql frontend/graphql/test/auth/auth.test.ts` (positional file filter through
`run-server-tests.ts`, which spawns + tears down its own dev server):

```
✅ ALL TESTS PASSED
• Test Files:  1 passed / 1 total (100%)
• Total Tests: 24 passed (0 failed)
• Assertions:  95 expect() calls
• Total Time:  14.81s (from runner start to teardown)
• Server Log:  logs/next-dev-server-3066.log
```

Coverage matrix (all green): registration `12345`→`PHONE_INVALID`, `""`/whitespace→
`PHONE_REQUIRED`, 17-char→`PHONE_TOO_LONG`, 16-char ceiling→registers successfully; admin
create (admin token via `insertAdminUserWithChildRow` + real login) invalid→`PHONE_INVALID`;
admin update 17-char→`PHONE_TOO_LONG`; unauthenticated admin create/update→`UNAUTHORIZED`;
student-token admin create→`FORBIDDEN`; top-level `error.message` mirrors `fields[0].message`
on every rejection; SDL surface ×4 (`phone` stays `String!` on `RegisterUserInput` +
`AdminCreateUserInput`, `String` on `User` + `AdminUserDetail`, no `Phone` type — asserted
against the live in-process `graphQLSchema`, gateway-suite precedent). The two outcome/14 §4
baseline failures (getStats seedless DB; chaos race) are `test:services` items, not in this
suite — not chased.

### 15.QL — sub-loop + honest tsgo evidence

`bun run scripts/health/sub-loop.ts frontend/graphql/test/auth/auth.test.ts --lifecycle
duplicates` → **exit 0** (oxlint ✅, biome ✅, lint:type-aware ✅, duplicates skipped — file
outside jscpd scan scope, per script).

**HONESTY (A2 recurrence in this window):** dmesg records a tsgo OOM kill at uptime 10059 s
(`anon-rss ~2.5 GB`) INSIDE this sub-loop window → the sub-loop's "✅ tsgo passed" line is the
documented **vacuous false-pass**. Real type evidence per outcome/3 §3 scoped fallback:
temp tsconfig OUTSIDE the repo (`extends` root, `incremental: false`, `typeRoots` pinned into
repo `node_modules/@types`, `include` overridden) → `tsgo -p --noEmit` → **exit 0, ZERO
diagnostics** over the full import closure. **Negative control** (scratch probe mis-typing
`validatePhoneField`'s return AND argument) → **TS2322 + TS2345, exit 1** ⇒ the gate engages
and the `@/` alias resolves. Scratch files deleted.

**NEW scoped-tsgo pitfall (alongside Task 13's `frontend/providers/theme/types.ts` rule):**
scoped configs MUST also include `frontend/types/apollo-client.d.ts` (the Apollo
`DeclareDefaultOptions` augmentation) — otherwise `test/helpers/graphql-test-helpers.ts`
emits 3 false TS2322 `errorPolicy` diagnostics that do not exist in the real project graph.

### 15.SEC — Security & Tenancy Audit: PASS

- **BFLA at the wire:** anonymous → `UNAUTHORIZED` on both admin mutations (asserted to
  precede the phone gate — the hostile phone never surfaces as a validation payload);
  student-token → `FORBIDDEN`. Admin identity minted through the real public `login` path.
- **REQ-9.3 (no-echo):** every hostile probe asserts `message` EQUALS the exact localized
  template (`authEn.phoneInvalid` / `authEn.phoneRequired` / `errorsEn.validation`) AND
  `not.toContain(submitted value)` on both the field entry and the top-level message.
- **REQ-9.4:** the only channel asserted is `extensions.fields[]` `{ field, code, message }`;
  the schema-surface tests pin that no new SDL type/enum exposed the internal codes.
- **REQ-9.1:** hostile payloads are submitted straight over the wire to the server gate — the
  trust boundary — with zero client-side pre-filtering.

### 15.SR — Semantic Review: PASS

- ✅ `testClient` only (no raw fetch, no string queries); `errorPolicy: "all"` result.error
  assertions; optional chaining + null guards per test/AGENTS rules.
- ✅ Documents REUSED from `sharedDocuments/` (id-first selections owned by those files, per
  sharedDocuments/AGENTS.md header) — NO new documents, NO codegen, NO manual
  `schema.graphql` edit (D7).
- ✅ No hooks at all ⇒ no `useLazyQuery` possible.
- ✅ No `console.*`, no `oxlint-disable`, no `any`-casts (structural narrowing), no new deps.
- ✅ `git status` shows ONLY `frontend/graphql/test/auth/auth.test.ts` modified for this task.

### 15.IV — Instruction Verification: PASS

Read in full: root `AGENTS.md`, `frontend/AGENTS.md`, `frontend/graphql/AGENTS.md`,
`frontend/graphql/test/AGENTS.md`, `backend/graphql/AGENTS.md`,
`.agents/instructions/frontend.instructions.md`, `.agents/instructions/tests.instructions.md`.
Validated: bun:test only; mandated runners; no raw `bun test`; integration tests touch the API
surface only (fixture/cleanup helpers enter via `@/test/helpers`, `graphQLSchema` in-process
per the documented `gateway/` precedent); the "getServerTranslations hangs" rule not implicated
(the file sources static `authEn`/`errorsEn` bundles, never `getServerTranslations`).

## 4. Carry-forward

- **Environment (Task 16 / orchestrator):** feat-wt `node_modules` is now a hardlink copy of
  my-project's — Turbopack boots and `test:graphql` works. If it ever regresses to the
  out-of-root symlink, `bun run test:graphql` cannot run in this sandbox (panic evidence:
  `logs/next-dev-server-3066.log`). A webpack-mode fallback is NOT viable
  (instrumentation.ts dynamic-import unresolved under webpack).
- **Task 16 final gate:** can expect the auth wire suite at 24/24 green; scoped-tsgo configs
  must include `frontend/providers/theme/types.ts` AND `frontend/types/apollo-client.d.ts`;
  the two test:services baseline failures (outcome/14 §4) remain Task 16's disposition.
- **In-file note:** the `TEST_SERVER_EXTERNAL=1` warm-server branch is the memory-constrained
  adaptation for this sandbox; CI (env unset) keeps the standard boot lifecycle.

## 5. Progress tracking

- [x] 15. GraphQL wire test — flipped ONLY the `- [ ] 15.` line in `tasks.md`; no other
  checkbox touched.
