# Surah/Juz Vocabulary — The 144-Member Mushaf Canon

This document is the canonical reference for the `SurahJuzRef` homework vocabulary — the closed
set of values a homework assignment may reference (114 surahs + 30 juz). It exists so the next
ticket that touches the vocabulary (a read-surface label adoption, a new mirror, a test with
hostile fixtures) starts from proven rails instead of re-deriving the mirror map, the naming
rules, and the parity guards. The Quranic canon is immutable, so this vocabulary never needs a
regeneration workflow — but its five hand-maintained mirrors must stay in lockstep, and every
near-collision trap that bit during the 35 → 144 expansion is recorded here.

## Why

Homework is assigned against the mushaf: the jadid track points at a surah or juz being
memorized, the madi track at one being revised. That pointer is a **closed PostgreSQL enum**
(`surah_juz_ref`), not free text — an enum value is a data contract, so inventing a spelling is
not a typo, it is a wire/schema drift. The vocabulary grew from the five initially-shipped
surahs to the **full canon (114 surahs + 30 juz = 144 members)**, and the growth made one thing
structural: 109 new identifiers land in five mirrors at once, and a free-form per-implementer
naming convention would have produced near-collisions against the hostile fixtures the test
suites already pin (`surah_an_nuh`, `surah_al_furqan`). The canon table and its naming rules are
therefore authoritative, and drift between mirrors is machine-enforced to fail the suite rather
than reviewed by eye.

## Pattern — five mirrors, one dataset, parity-enforced

The vocabulary lives in five places. The **TS enum is canonical**; every other mirror derives
from or is pinned against it. Each mirror has a named guard that fails the suite on drift:

| # | Mirror | File | Ordering | Parity guard |
|---|---|---|---|---|
| 1 | TS enum (canonical) | `backend/enum/shared/surah-juz-ref.enum.ts` | mushaf order (surahs 1–114, then `juz_1`–`juz_30`) | `isSurahJuzRef` guard + pre-allocated membership set (both iterate `Object.values`, so they auto-grow); frozen-member suite `backend/enum/shared/surah-juz-ref.enum.test.ts` |
| 2 | pgEnum | `backend/db/schema/enums.ts` (`surahJuzRef`) | same order as the TS enum | the enum suite's `surah_juz_ref pgEnum ↔ SurahJuzRef mirror parity` describe (order-sensitive, byte-identical, 144/144); DB-side backstop `backend/db/test/repo/classes/home-work.repository.test.ts` (out-of-enum insert → 22P02) |
| 3 | GraphQL SDL (generated) | `frontend/graphql/generated/schema.graphql` | alphabetical (codegen artifact) | `backend/graphql/test/session-sdl.test.ts` — the enum occurs EXACTLY once and carries member/value parity with the TS enum |
| 4 | Codegen enum (generated) | `frontend/graphql/generated/gql/graphql.ts` | alphabetical (codegen artifact); wire values are the TS enum's KEYS (PascalCase wire names) | `frontend/views/teacher/sessions/sessionReportConversions.test.ts` — full round-trip + the order-insensitive `backend ↔ codegen SurahJuzRef key parity` describe |
| 5 | Locale labels | `shared/locale/en/sessions/labels.ts` + `shared/locale/ar/sessions/labels.ts` (module-scope `SURAH_JUZ_LABELS` records, unexported; typed by `shared/locale/types/sessions/labels.ts`) | mushaf order (literal list — `shared/` must never import from `@/backend/**`) | literal-list parity belt `shared/locale/sessions-namespace.parity.test.ts` (144 refs written out) + backend-side conformance suite `backend/enum/shared/surah-juz-ref.locale-conformance.test.ts` (script, prefix, and label-totality per member, derived from `Object.values(SurahJuzRef)`) |

**Parity-test compensation (the one non-obvious rule):** the backend enum is mushaf-ordered
while the SDL/codegen blocks are alphabetical, so any cross-mirror comparison must be
**order-insensitive on keys** and order-sensitive only WITHIN a mirror. A naive order-sensitive
compare across mirrors fails both before and after any expansion. The two key-parity describes
above pin both directions; keep them that way.

**The wire path (how mirrors 1 and 4 coexist):** form state carries the backend enum; the
submit payload's `surahJuz` is the codegen enum's key. The translation is the module-scope,
membership-guarded `CODEGEN_WIRE_BY_REF` lookup in
`frontend/views/teacher/sessions/sessionReportConversions.ts` — cast-free, fail-closed (an
unmapped value throws; it is never silently passed through). GraphQL denies non-member values
on both closed channels pre-resolver (variable-coercion → `BAD_USER_INPUT`; document-literal →
`GRAPHQL_VALIDATION_FAILED`).

## Rules

- **Naming (the canon is the speller):** a member is `Surah<Pascal>` / `surah_<snake>` of the
  transliterated name, with sun-letter assimilation preserved in the article — the
  transliteration scheme carries `An-`, `Ash-`, `Aṣ-`, `Aḍ-`, `Aṭ-`, `Adh-`, `Az-`, `Ar-`,
  `As-`, `At-`; identifiers and DB values are ASCII spellings of it (`surah_an_nas`,
  `surah_ash_shuara`, `surah_as_saffat`), and the diacritics surface in the display labels
  (`Surah Aṣ-Ṣāffāt`). The frozen specials: #3 `SurahAalImran`/`surah_aal_imran`,
  #20 `SurahTaHa`/`surah_ta_ha`, #36 `SurahYaSin`/`surah_ya_sin`, #38 `SurahSad`/`surah_sad`,
  #50 `SurahQaf`/`surah_qaf`, and **#71 `SurahNuh`/`surah_nuh`** (NOT `surah_an_nuh` — see the
  fixture rules below). DB values are the snake refs; codegen wire values are the PascalCase
  keys themselves.
- **Labels:** EN = `Surah <Transliterated Name>` in the established glyph style — hyphen after
  the article (`Surah Al-…`), `ʿ` for ʿayn, `ʾ` for hamza, macrons `ā ī ū`, dot-below emphatics
  `ḥ ṣ ṭ ḍ` (e.g. `Al-Ḥijr`, `Aṣ-Ṣāffāt`, `Aḍ-Ḍuḥā`, `An-Nisāʾ`). AR = `"سورة " + canonical
  name`; juz = `"Juz N"` / `"الجزء " + Arabic-Indic digits` (`١`–`٣٠`). The picker's two group
  headings are the flat contract keys `surahJuzSurahGroupLabel` ("Surahs" / "السور") and
  `surahJuzJuzGroupLabel` ("Juzs" / "الأجزاء") on the sessions labels — the Autocomplete buckets
  by `option.startsWith("juz_")` over the closed vocabulary (no enum switch).
- **Fixture near-collision rules (audit every hostile string against the full canon):**
  - `surah_al_furqan` is **VALID** (surah 25) — a suite that treats it as an invalid probe
    breaks the moment the canon is complete.
  - `surah_an_nuh` is **INVALID and must stay invalid** — the journey suite pins it as a hostile
    payload precisely because #71 ships as `surah_nuh`. Never "fix" the spelling of the
    fixture; it is a deliberate near-miss.
  - The standing invalid probes are `juz_31` (beyond the canon), `juz_0`, `page_1`, and the
    case/whitespace variants (`JUZ_1`, `" juz_1"`, `"surah_an_nuh"`). Nothing rides the label
    fallback and nothing is case-forgiven: a value is a member or it is denied.
- **Labels are total.** The `?? ref` fallback on the locale leaves is a fail-visible debugging
  aid, never an absorption path: the conformance suite asserts every real member resolves a
  label different from the raw ref in both locales, so a missing entry fails instead of
  silently rendering the key.
- **Mirrors move together or not at all.** Adding a member means touching ALL hand-maintained
  surfaces in one landing — TS enum, pgEnum (+ migration), both locale label records, and the
  parity belt's literal 144-ref list — then regenerating the SDL + codegen
  (`bun run generate:gqlSchema` then `bun codegen`). The conformance suite auto-grows via
  `Object.values(SurahJuzRef)` and fails if the leaves lag; the parity belt fails if its
  literal list lags.

## What NOT to Do

- **Never invent a spelling.** The canon (the TS enum) is the only speller; near-misses like
  `surah_an_nuh`, `SurahAlFurqanTypo`, or `juz_99` are invalid by design and are pinned as
  hostile fixtures across the service, wire, and journey suites.
- **Never grow the vocabulary.** The mushaf canon is closed — there is no 115th surah and no
  31st juz. If a ticket appears to need a new member, the ticket is wrong (and no generator
  script exists for the dataset on purpose).
- **Never add a sixth mirror or copy the list into new code.** Backend code derives members
  from `Object.values(SurahJuzRef)`; the shared locale layer is the ONE sanctioned literal copy
  (it must never import from `@/backend/**`); everything else reads an existing mirror.
- **Never rename, renumber, or re-order existing members.** Stored rows, the wire contract,
  committed migrations, and frozen pins byte-identify the shipped members; a rename is a data
  migration + wire break, not a refactor.
- **Never make a cross-mirror comparison order-sensitive.** Mushaf order (enum, pgEnum, label
  list) and alphabetical order (SDL, codegen) are both correct; only within-mirror order is
  pinned.
- **Never hand-type new label entries.** The label records were generated from the canon table
  and value-verified; hand-typed transliterations are how the glyph style (`ʿ ʾ`, macrons,
  dot-below emphatics) decays.
- **Never let a user-supplied string become a stored value.** Free text can never enter through
  the picker (it only emits closed-list members), and the form-state guard
  (`isSurahJuzRef`) plus the fail-closed conversion drop anything else before the wire.

## Rollout

The 35 → 144 expansion shipped as one atomic landing (ticket kottaby/kottaby#300):

- **Migration:** `backend/drizzle/20261006205033_keen_madame_masque/migration.sql` — 109
  idempotent `DO $$ … ALTER TYPE "surah_juz_ref" ADD VALUE '<value>' $$` statements in mushaf
  order, following the repo's `backend/drizzle/20260907182455_ancient_scarecrow/` precedent.
  Schema changes apply via `bun run db push`; the committed migration is produced by the
  dbActions generate flow (`bun run db` → Generate Drizzle Schema). `db reset` /
  `db cleanGenerate` are disabled by repo policy.
- **Additive-only.** `ADD VALUE` is catalog-only with a brief lock — no table rewrite, no
  column change, no data backfill, and existing rows are untouched.
- **Ship migration + code together.** No stored row can reference a new member until the new
  code accepts it (the value can only enter through the closed channels above), so old readers
  never see an unknown value mid-deploy.
- **Verification rails at ship time:** enum suite 25/0 (144 frozen + pgEnum mirror parity);
  locale parity belt 47/0 + backend conformance 4/0 (both locales, all 144); conversions
  round-trip + key parity 25/0; `bun run test:graphql` 350/0 (SDL parity pin + dual-channel
  wire denials); service guards 47/0 (every member accepted, near-misses denied); journey 15/0
  (far-vocabulary member end-to-end); repo 22P02 backstop 21/0.

## Related Documents

- `docs/sessions/session-report-homework.md` — the canonical session-report/homework surface
  this vocabulary feeds (write gate, atomic co-creation, consumer guidance incl. the Surah/Juz
  UI row).
- `docs/specs/open-decisions-and-gaps.md` — decision B.11 (enum representation for homework;
  runtime status of the 144-member rollout).
- `docs/planning/PRODUCTION_READINESS.md` — readiness row 8.21 (surah_juz_ref enum + columns
  verified).
- `backend/enum/AGENTS.md` — layer rules for the canonical enum module.
